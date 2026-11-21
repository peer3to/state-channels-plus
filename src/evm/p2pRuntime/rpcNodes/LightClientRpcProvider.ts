import type { LightClient } from "./lightClient/LightClient";
import type { LightClientChain } from "./lightClient/LightClientChain";
import type {
    LightClientCounters,
    PushedBlockTiming,
    PushedStateCounters
} from "./lightClient/LightClientCounters";
import {
    LightClientSubscriptions,
    SUBSCRIPTION_RETRY_DELAY_MS
} from "./lightClient/LightClientSubscriptions";
import { NotLocalError } from "./lightClient/LightClientUnavailableError";
import { LIGHT_CLIENT_METHODS } from "./lightClient/lightClientWire";
import { parseLocalRead, type LocalRead } from "./lightClient/LocalReadParser";
import StorageProofError from "./lightClient/proof/StorageProofError";
import MultiRpcProvider from "./MultiRpcProvider";
import { isMethodNotServed } from "./RpcNodeProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import type { ChannelId } from "@/types/types";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    hexlify,
    isHexString,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult,
    zeroPadValue
} from "ethers";

export type {
    LightClientCounters,
    PushedBlockTiming,
    PushedStateCounters
} from "./lightClient/LightClientCounters";

/** The log topic an indexed `channelId` is. */
function channelTopic(channelId: ChannelId): string {
    return zeroPadValue(hexlify(channelId), 32);
}

/**
 * {@link MultiRpcProvider} that answers `eth_call`, `eth_getStorageAt`,
 * `eth_getCode`, `eth_getBalance` and `eth_getTransactionCount` at the latest
 * block from state the nodes prove, instead of trusting their answers, when
 * the nodes list the light client endpoints. Everything else goes to the
 * nodes as before, and so does every read the light client cannot answer: a
 * read at another block or a pending one, a call with a gas limit or a fee
 * field, and any read while the nodes serve no light client endpoints or a
 * proof fails. Such a fallback keeps the peer working; a failure is logged as
 * an error and counted, because the light client is relied on.
 *
 * For the channel the runtime follows, the nodes push the channel's partition
 * of the contract's state with its proof at every block, and the light client
 * reads it without a request.
 */
export default class LightClientRpcProvider extends MultiRpcProvider {
    readonly lightClientCounters: LightClientCounters = {
        fromPushedState: 0,
        withFallbackRead: 0,
        leftToNodes: 0,
        failed: 0,
        unsupported: 0
    };
    readonly pushedStateCounters: PushedStateCounters = {
        acceptedBlocks: 0,
        refusedBlocks: 0,
        resubscriptions: 0
    };
    /** The stages of the last accepted pushed blocks, oldest first, at most 1024. */
    readonly pushedBlockTimings: PushedBlockTiming[] = [];
    private readonly chain: LightClientChain;
    private readonly subscriptions: LightClientSubscriptions;
    /**
     * Started by the first read it may answer or the first channel followed,
     * so that a provider that does neither loads no EVM.
     */
    private lightClient?: Promise<LightClient>;
    /** The light client once started, for the pushes that arrive meanwhile. */
    private startedLightClient?: LightClient;
    /** Whether each node lists the light client endpoints, once it answered. */
    private readonly endpointsListed = new Map<
        RpcNodeProvider,
        Promise<boolean>
    >();
    /** The start of the subscriptions, once a channel is followed; unset again after it failed. */
    private subscriptionsStart?: Promise<void>;
    /** The pending retry of a failed start of the subscriptions. */
    private subscriptionsStartRetry?: ReturnType<typeof setTimeout>;
    /**
     * The highest block number seen in the nodes' new heads and in the
     * receipts and block numbers the nodes answered: no read is answered at
     * an earlier block.
     */
    private highestSeenBlock?: number;

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        chain: LightClientChain
    ) {
        super(nodes, logger);
        this.chain = chain;
        // a light client that did not start follows nothing
        this.subscriptions = new LightClientSubscriptions(nodes, this.logger, {
            subscribed: (key, contract, node) =>
                this.startedLightClient?.subscribed(key, contract, node),
            unsubscribed: (key) => this.startedLightClient?.unsubscribed(key),
            pushed: (key, message, receivedAt) =>
                this.startedLightClient?.pushed(key, message, receivedAt) ??
                true,
            resubscribed: () => this.pushedStateCounters.resubscriptions++
        });
    }

    // Overrides MultiRpcProvider.followChannel: the nodes push the channel's
    // partition of the contract's state from now on. A failure is logged and
    // never reaches the runtime, which works without the light client.
    override followChannel(contract: string, channelId: ChannelId): void {
        try {
            this.subscriptions.follow(
                contract.toLowerCase(),
                channelTopic(channelId)
            );
            this.startSubscriptions();
        } catch (error) {
            this.logger.error("Light client could not follow the channel", {
                contract,
                error
            });
        }
    }

    // Overrides MultiRpcProvider.unfollowChannel: ends what followChannel
    // began, and like it never throws.
    override unfollowChannel(contract: string, channelId: ChannelId): void {
        try {
            this.subscriptions.unfollow(
                contract.toLowerCase(),
                channelTopic(channelId)
            );
        } catch (error) {
            this.logger.error("Light client could not unfollow the channel", {
                contract,
                error
            });
        }
    }

    // Overrides MultiRpcProvider.destroy: also ends the subscriptions, and
    // logs the counts once, so that every runtime's reach the log pipeline.
    override destroy(): void {
        if (!this.destroyed)
            this.logger.info("Light client counts", {
                ...this.lightClientCounters,
                ...this.pushedStateCounters
            });
        clearTimeout(this.subscriptionsStartRetry);
        this.subscriptions.close();
        super.destroy();
    }

    // Overrides MultiRpcProvider.answer: reads the light client can answer
    // are answered from proven state, everything else goes to the nodes.
    protected override async answer(
        request: JsonRpcPayload
    ): Promise<JsonRpcResult | JsonRpcError> {
        const read = parseLocalRead(request);
        const answer = read && (await this.answerLocally(request, read));
        if (answer) return answer;
        const forwarded = await this.forward(request);
        this.noteSeenBlock(request.method, forwarded.result);
        return forwarded;
    }

    /** Raises {@link highestSeenBlock} by a receipt or a block number a node answered. */
    private noteSeenBlock(method: string, result: unknown): void {
        const blockNumber =
            method === "eth_getTransactionReceipt"
                ? (result as { blockNumber?: unknown } | null)?.blockNumber
                : method === "eth_blockNumber"
                  ? result
                  : undefined;
        if (typeof blockNumber === "string" && isHexString(blockNumber))
            this.raiseSeenBlock(Number(blockNumber));
    }

    private raiseSeenBlock(blockNumber: number): void {
        if (blockNumber > (this.highestSeenBlock ?? -1))
            this.highestSeenBlock = blockNumber;
    }

    /** The light client's answer to `request`, or undefined when the nodes answer it. */
    private async answerLocally(
        request: JsonRpcPayload,
        read: LocalRead
    ): Promise<JsonRpcResult | JsonRpcError | undefined> {
        try {
            const node = this.servingNode();
            if (!node || !(await this.hasEndpoints(node))) {
                this.lightClientCounters.unsupported++;
                return undefined;
            }
            // a node that serves the endpoints now pushes what is followed
            this.startSubscriptions();
            return {
                id: request.id,
                ...(await read(await this.getLightClient()))
            } as JsonRpcResult | JsonRpcError;
        } catch (error) {
            // closed while the read ran: the read fails as a plain one would
            if (this.isClosed) throw error;
            if (error instanceof NotLocalError) {
                this.lightClientCounters.leftToNodes++;
            } else {
                this.lightClientCounters.failed++;
                this.logger.error(
                    "Light client failed a read; asking the nodes",
                    {
                        ...LoggerUtils.getChainReadMetadata(request),
                        reason:
                            error instanceof StorageProofError
                                ? "proof rejected"
                                : "read failed",
                        error
                    }
                );
            }
            return undefined;
        }
    }

    private getLightClient(): Promise<LightClient> {
        // a failed start is not kept: the next read starts it again
        this.lightClient ??= this.startLightClient().catch((error) => {
            this.lightClient = undefined;
            throw error;
        });
        return this.lightClient;
    }

    private async startLightClient(): Promise<LightClient> {
        // Loaded here, not at import: the light client brings the EVM's
        // module graph, which only a provider that answers reads pays for.
        const { LightClient } = await import("./lightClient/LightClient");
        this.startedLightClient = new LightClient({
            reader: this.chain.createReader((method, params) =>
                this.requestNode(method, params)
            ),
            createPartition: () => this.chain.createPartition(),
            servingNode: () => this.servingNode(),
            chainPrecompiles: this.chain.chainPrecompiles,
            hardfork: this.chain.hardfork,
            ethereumPrecompiles: this.chain.ethereumPrecompiles,
            getChainId: async () => (await this.getNetwork()).chainId,
            blockFloor: () => this.highestSeenBlock,
            pushWaitMs: this.chain.blockTimeMs,
            counters: this.lightClientCounters,
            pushedState: this.pushedStateCounters,
            pushedBlockTimings: this.pushedBlockTimings,
            logger: this.logger
        });
        // the nodes' new heads come over their sockets, without polling
        void this.on("block", (blockNumber: number) =>
            this.raiseSeenBlock(blockNumber)
        );
        return this.startedLightClient;
    }

    /**
     * Starts the subscriptions once the serving node lists the light client
     * endpoints and the light client runs, so that it takes the first push.
     * Without the endpoints they stay off until the next channel is followed.
     * A failed start is logged and tried again.
     */
    private startSubscriptions(): void {
        this.subscriptionsStart ??= (async () => {
            const node = this.servingNode();
            // awaited even without a node, so that the reset follows the assignment
            const isServed = await (node ? this.hasEndpoints(node) : false);
            if (!isServed) {
                this.subscriptionsStart = undefined;
                return;
            }
            await this.getLightClient();
            this.subscriptions.start();
        })().catch((error: unknown) => {
            this.subscriptionsStart = undefined;
            if (this.isClosed) return;
            this.logger.error(
                "Light client could not start following; trying again",
                { error }
            );
            this.subscriptionsStartRetry = setTimeout(() => {
                if (!this.isClosed) this.startSubscriptions();
            }, SUBSCRIPTION_RETRY_DELAY_MS);
        });
    }

    /** Whether `node` lists the light client endpoints; it is asked once. */
    private hasEndpoints(node: RpcNodeProvider): Promise<boolean> {
        let listed = this.endpointsListed.get(node);
        if (!listed) {
            // an unanswered question is not kept: the next read asks again
            listed = this.askForEndpoints(node).catch((error) => {
                this.endpointsListed.delete(node);
                throw error;
            });
            this.endpointsListed.set(node, listed);
        }
        return listed;
    }

    private async askForEndpoints(node: RpcNodeProvider): Promise<boolean> {
        const sent = await node
            .trySendOnCurrentSocket("rpc_methods", [])
            .catch((error: unknown) => {
                // a node without the Substrate RPC does not serve rpc_methods
                if (isMethodNotServed(error)) return { result: undefined };
                throw error;
            });
        if (!sent)
            throw new Error(
                "The RPC node's socket ended before it listed its methods"
            );
        const listed = (sent.result as { methods?: unknown } | null)?.methods;
        const methods: unknown[] = Array.isArray(listed) ? listed : [];
        const hasEndpoints =
            methods.includes(LIGHT_CLIENT_METHODS.subscribe) &&
            methods.includes(LIGHT_CLIENT_METHODS.unsubscribe);
        // the light client is optional: without the endpoints it is off
        if (!hasEndpoints)
            this.logger.info(
                "RPC node doesn't support LC endpoints; it answers the chain reads itself",
                LoggerUtils.getRpcNodeMetadata(node.url)
            );
        return hasEndpoints;
    }
}
