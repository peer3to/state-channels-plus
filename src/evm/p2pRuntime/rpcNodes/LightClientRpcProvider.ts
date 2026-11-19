import type { LightClient } from "./lightClient/LightClient";
import type { LightClientChain } from "./lightClient/LightClientChain";
import { LightClientSubscriptions } from "./lightClient/LightClientSubscriptions";
import { NotLocalError } from "./lightClient/LightClientUnavailableError";
import { LIGHT_CLIENT_METHODS } from "./lightClient/lightClientWire";
import { parseLocalRead } from "./lightClient/LocalReadParser";
import StorageProofError from "./lightClient/proof/StorageProofError";
import type { PushedStateCounters } from "./lightClient/PushedStateCounters";
import MultiRpcProvider from "./MultiRpcProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import type { ChannelId } from "@/types/types";
import type { Logger } from "@/utils/logging/Logger";
import {
    hexlify,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult,
    zeroPadValue
} from "ethers";

/** How the reads the light client may answer were answered, since the provider started. */
export type LightClientCounters = {
    /** Answered from state a node proved. */
    answeredLocally: number;
    /** Left to the nodes by design: the call would run differently here. */
    leftToNodes: number;
    /** Answered by the nodes because the light client failed; each is logged as an error. */
    failed: number;
    /** Answered by the nodes because they serve no light client endpoints. */
    unsupported: number;
};

/** The log topic an indexed `channelId` is. */
function channelTopic(channelId: ChannelId): string {
    return zeroPadValue(hexlify(channelId), 32);
}

/**
 * {@link MultiRpcProvider} that answers `eth_call`, `eth_getStorageAt`,
 * `eth_getCode`, `eth_getBalance` and the latest `eth_getTransactionCount`
 * at the latest block from state the nodes prove, instead of trusting their
 * answers. Everything else goes to the nodes as before, and so does every
 * read the light client cannot answer: a read at an older block, a pending
 * nonce, a call with a gas limit, and any read while the nodes serve no light
 * client endpoints or a proof fails. Such a fallback keeps the peer working;
 * a failure is logged as an error and counted, because the light client is
 * relied on.
 *
 * The storage of the contract of a channel the runtime follows is kept
 * across blocks: the provider subscribes to the blocks the nodes push for
 * it, and the light client carries the storage with their proven writes.
 */
export default class LightClientRpcProvider extends MultiRpcProvider {
    readonly lightClientCounters: LightClientCounters = {
        answeredLocally: 0,
        leftToNodes: 0,
        failed: 0,
        unsupported: 0
    };
    readonly pushedStateCounters: PushedStateCounters = {
        acceptedBlocks: 0,
        refusedBlocks: 0,
        reproofs: 0,
        changedUnpushed: 0
    };
    private readonly chain: LightClientChain;
    private readonly reproofIntervalBlocks: number;
    private readonly subscriptions: LightClientSubscriptions;
    /**
     * Started by the first read it may answer or the first channel followed,
     * so that a provider that does neither loads no EVM.
     */
    private lightClient?: Promise<LightClient>;
    /** Whether the nodes list the light client endpoints, once asked. */
    private endpointsListed?: Promise<boolean>;
    /** The follow and unfollow calls, one after another. */
    private following: Promise<void> = Promise.resolve();

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        chain: LightClientChain,
        reproofIntervalBlocks: number
    ) {
        super(nodes, logger);
        this.chain = chain;
        this.reproofIntervalBlocks = reproofIntervalBlocks;
        this.subscriptions = new LightClientSubscriptions(
            nodes,
            this.logger,
            (address, block) =>
                // a light client that did not start follows nothing
                void this.lightClient?.then(
                    (lightClient) => lightClient.pushed(address, block),
                    () => undefined
                )
        );
    }

    // Overrides MultiRpcProvider.followChannel: the nodes push the blocks of
    // the channel's contract from now on, and the light client keeps the
    // contract's storage across blocks with them.
    override followChannel(contract: string, channelId: ChannelId): void {
        this.changeFollowing(async () => {
            if (!(await this.hasEndpoints())) return;
            const address = contract.toLowerCase();
            (await this.getLightClient()).follow(address);
            this.subscriptions.follow(address, channelTopic(channelId));
        });
    }

    // Overrides MultiRpcProvider.unfollowChannel: ends what followChannel
    // began, once no channel of the contract is followed.
    override unfollowChannel(contract: string, channelId: ChannelId): void {
        this.changeFollowing(async () => {
            const address = contract.toLowerCase();
            if (this.subscriptions.unfollow(address, channelTopic(channelId)))
                (await this.lightClient)?.unfollow(address);
        });
    }

    // Overrides MultiRpcProvider.destroy: also ends the subscriptions.
    override destroy(): void {
        this.subscriptions.close();
        super.destroy();
    }

    // Overrides MultiRpcProvider.answer: reads the light client can answer
    // are answered from proven state, everything else goes to the nodes.
    protected override async answer(
        request: JsonRpcPayload
    ): Promise<JsonRpcResult | JsonRpcError> {
        const read = parseLocalRead(request);
        if (!read) return this.forward(request);
        if (!(await this.hasEndpoints())) {
            this.lightClientCounters.unsupported++;
            return this.forward(request);
        }
        try {
            const answer = {
                id: request.id,
                ...(await read(await this.getLightClient()))
            } as JsonRpcResult | JsonRpcError;
            this.lightClientCounters.answeredLocally++;
            return answer;
        } catch (error) {
            if (error instanceof NotLocalError) {
                this.lightClientCounters.leftToNodes++;
            } else {
                this.lightClientCounters.failed++;
                this.logger.error(
                    "Light client failed a read; asking the nodes",
                    {
                        method: request.method,
                        reason:
                            error instanceof StorageProofError
                                ? "proof rejected"
                                : "read failed",
                        error
                    }
                );
            }
        }
        return this.forward(request);
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
        return new LightClient({
            reader: this.chain.createReader((method, params) =>
                this.requestNode(method, params)
            ),
            chainPrecompiles: this.chain.chainPrecompiles,
            getChainId: async () => (await this.getNetwork()).chainId,
            reproofIntervalBlocks: this.reproofIntervalBlocks,
            counters: this.pushedStateCounters,
            logger: this.logger
        });
    }

    private changeFollowing(change: () => Promise<void>): void {
        this.following = this.following
            .then(change)
            .catch((error: unknown) =>
                this.logger.error(
                    "Light client could not change what it follows",
                    { error }
                )
            );
    }

    private hasEndpoints(): Promise<boolean> {
        this.endpointsListed ??= this.askForEndpoints();
        return this.endpointsListed;
    }

    private async askForEndpoints(): Promise<boolean> {
        // a node without the Substrate RPC rejects rpc_methods
        const listed = await this.requestNode("rpc_methods", []).then(
            (answer) => (answer as { methods?: unknown } | null)?.methods,
            () => undefined
        );
        const methods: unknown[] = Array.isArray(listed) ? listed : [];
        const hasEndpoints =
            methods.includes(LIGHT_CLIENT_METHODS.subscribe) &&
            methods.includes(LIGHT_CLIENT_METHODS.unsubscribe);
        if (!hasEndpoints)
            this.logger.error(
                "RPC node doesn't support LC endpoints; it answers the chain reads itself"
            );
        return hasEndpoints;
    }
}
