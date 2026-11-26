import type { LightClient } from "./lightClient/LightClient";
import type { LightClientChain } from "./lightClient/LightClientChain";
import type {
    LightClientCounters,
    PushedBlockTiming,
    PushedStateCounters,
    ReadComparisonCounters
} from "./lightClient/LightClientCounters";
import { LightClientSubscriptions } from "./lightClient/LightClientSubscriptions";
import { NotLocalError } from "./lightClient/LightClientUnavailableError";
import { LIGHT_CLIENT_METHODS } from "./lightClient/lightClientWire";
import {
    paramsAtBlock,
    parseLocalRead,
    type LocalAnswer,
    type LocalRead
} from "./lightClient/LocalReadParser";
import type { ProvenBlock } from "./lightClient/proof/AProvenStateReader";
import StorageProofError from "./lightClient/proof/StorageProofError";
import MultiRpcProvider from "./MultiRpcProvider";
import { isMethodNotServed, NodeSocketSubscriptions } from "./RpcNodeProvider";
import type RpcNodeProvider from "./RpcNodeProvider";
import type { ChannelId } from "@/types/types";
import { indexedTopic } from "@/utils/bytes32";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { Logger } from "@/utils/logging/Logger";
import {
    isError,
    isHexString,
    type JsonRpcError,
    type JsonRpcPayload,
    type JsonRpcResult
} from "ethers";

export type {
    LightClientCounters,
    PushedBlockTiming,
    PushedStateCounters,
    ReadComparisonCounters
} from "./lightClient/LightClientCounters";

/** Which light client endpoints a node lists. */
type ListedEndpoints = {
    /** The subscription endpoints: the light client is on. */
    subscriptions: boolean;
    /** The watch of keys a read proves. */
    watch: boolean;
};

/** A read's answer reduced to what must match: its return data, revert data or failure. */
type ComparedAnswer =
    | { result: unknown }
    | { revert: string }
    | { failure: string };

/** The node's answer to a compared read, or undefined when it gave none at that block. */
function comparedAnswerOf(error: unknown): ComparedAnswer | undefined {
    if (!isError(error, "CALL_EXCEPTION")) return undefined;
    return typeof error.data === "string"
        ? { revert: error.data }
        : { failure: error.shortMessage };
}

function isSameAnswer(local: ComparedAnswer, node: ComparedAnswer): boolean {
    const normalized = (answer: ComparedAnswer) =>
        JSON.stringify(answer).toLowerCase();
    return normalized(local) === normalized(node);
}

/** The block numbers a node's answer to `request` shows it has seen. */
function seenBlockNumbers(request: JsonRpcPayload, result: unknown): unknown[] {
    const field = (value: unknown, name: string): unknown =>
        typeof value === "object" && value !== null
            ? (value as Record<string, unknown>)[name]
            : undefined;
    switch (request.method) {
        case "eth_blockNumber":
            return [result];
        case "eth_getTransactionReceipt":
            return [field(result, "blockNumber")];
        case "eth_getBlockByNumber":
            // a pending block is not mined, so it shows no block the node has
            return Array.isArray(request.params) &&
                request.params[0] === "pending"
                ? []
                : [field(result, "number")];
        case "eth_getLogs":
            return Array.isArray(result)
                ? result.map((log) => field(log, "blockNumber"))
                : [];
        default:
            return [];
    }
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
    /** How the compared reads matched; counted only with `comparesReads`. */
    readonly readComparisons: ReadComparisonCounters = {
        matched: 0,
        differed: 0,
        notCompared: 0
    };
    /** Whether each read answered locally is also asked of the node, for tests. */
    private readonly comparesReads: boolean;
    /** Whether missing state is proven key by key as a read reaches it, for benchmarks. */
    private readonly fetchesEachMiss: boolean;
    private readonly chain: LightClientChain;
    private readonly subscriptions: LightClientSubscriptions;
    /**
     * Started by the first read it may answer or the first channel followed,
     * so that a provider that does neither loads no EVM.
     */
    private lightClient?: Promise<LightClient>;
    /** The light client once started, for the pushes that arrive meanwhile. */
    private startedLightClient?: LightClient;
    /** Which light client endpoints each node lists, once it answered. */
    private readonly endpointsListed = new Map<
        RpcNodeProvider,
        Promise<ListedEndpoints>
    >();
    /** The start of the subscriptions, once a channel is followed; unset again after it failed. */
    private subscriptionsStart?: Promise<void>;
    /** The pending retry of a failed start of the subscriptions. */
    private subscriptionsStartRetry?: ReturnType<typeof setTimeout>;
    /**
     * Per node, the highest block number in its own new heads, the logs it
     * delivered, and the receipts, blocks, logs and block numbers it
     * answered: no read is answered at an earlier block than the serving
     * node's. Another node's blocks never
     * raise it, so a node ahead of the serving one, or one that names a block
     * that does not exist, cannot keep reads off the pushed state.
     */
    private readonly highestSeenBlocks = new Map<RpcNodeProvider, number>();
    /** The node sockets whose new heads raise {@link highestSeenBlocks}. */
    private readonly headSockets = new NodeSocketSubscriptions();
    /** Stop watching each node's new sockets. */
    private readonly unwatchNodes: (() => void)[] = [];

    constructor(
        nodes: readonly RpcNodeProvider[],
        logger: Logger,
        chain: LightClientChain,
        {
            comparesReads = false,
            fetchesEachMiss = false
        }: { comparesReads?: boolean; fetchesEachMiss?: boolean } = {}
    ) {
        super(nodes, logger);
        this.chain = chain;
        this.comparesReads = comparesReads;
        this.fetchesEachMiss = fetchesEachMiss;
        // a node on a new socket may be another node behind the same URL: it is asked again
        for (const node of nodes)
            this.unwatchNodes.push(
                node.watchSockets((_, reopened) => {
                    if (reopened) this.endpointsListed.delete(node);
                })
            );
        // a light client that did not start follows nothing
        this.subscriptions = new LightClientSubscriptions(
            nodes,
            this.logger,
            chain.blockTimeMs,
            {
                subscribed: (key, contract, node) =>
                    this.startedLightClient?.subscribed(key, contract, node),
                unsubscribed: (key) =>
                    this.startedLightClient?.unsubscribed(key),
                pushed: (key, message, receivedAt) =>
                    this.startedLightClient?.pushed(key, message, receivedAt) ??
                    true,
                resubscribed: () => this.pushedStateCounters.resubscriptions++,
                servesWatch: (node) => this.servesWatch(node)
            }
        );
    }

    // Overrides MultiRpcProvider.followChannel: the nodes push the channel's
    // partition of the contract's state from now on. A failure is logged and
    // never reaches the runtime, which works without the light client.
    override followChannel(contract: string, channelId: ChannelId): void {
        try {
            this.subscriptions.follow(
                contract.toLowerCase(),
                indexedTopic(channelId)
            );
            this.startSubscriptions();
        } catch (error) {
            this.logger.error("Light client could not follow the channel", {
                contract,
                error
            });
        }
    }

    // Overrides MultiRpcProvider.followContract: the nodes keep the contract's
    // subscription from now on, and with it the keys its reads had proven.
    // Like followChannel it never throws.
    override followContract(contract: string): void {
        try {
            this.subscriptions.followContract(contract.toLowerCase());
            this.startSubscriptions();
        } catch (error) {
            this.logger.error("Light client could not follow the contract", {
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
                indexedTopic(channelId)
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
                ...this.pushedStateCounters,
                ...(this.comparesReads && {
                    comparedReads: this.readComparisons
                })
            });
        clearTimeout(this.subscriptionsStartRetry);
        this.subscriptions.close();
        for (const unwatch of this.unwatchNodes.splice(0)) unwatch();
        void this.headSockets.clear();
        super.destroy();
    }

    // Overrides MultiRpcProvider.answersFromProvenState: true while the
    // serving node lists the light client endpoints. A node that has not
    // answered the question yet counts as without them, so a caller keeps
    // its checks instead of failing; a failed question is warned about.
    override async answersFromProvenState(): Promise<boolean> {
        const node = this.servingNode();
        if (!node) return false;
        return await this.hasEndpoints(node).catch((error: unknown) => {
            this.logger.warn(
                "RPC node did not say whether it serves the light client; chain reads keep their local checks",
                { ...LoggerUtils.getRpcNodeMetadata(node.url), error }
            );
            return false;
        });
    }

    // Overrides MultiRpcProvider.noteDeliveredLog: a log a node delivered
    // raises the block it was seen at.
    protected override noteDeliveredLog(
        node: RpcNodeProvider,
        blockNumber: number
    ): void {
        this.raiseSeenBlock(node, blockNumber);
    }

    // Overrides MultiRpcProvider.answer: reads the light client can answer
    // are answered from proven state, everything else goes to the nodes.
    protected override async answer(
        request: JsonRpcPayload
    ): Promise<JsonRpcResult | JsonRpcError> {
        const read = parseLocalRead(request);
        const answer = read && (await this.answerLocally(request, read));
        if (answer) return answer;
        const { answer: forwarded, answeredBy } = await this.forward(request);
        this.noteSeenBlock(answeredBy, request, forwarded.result);
        return forwarded;
    }

    /** Raises the block `node` was seen at by a receipt, block, logs or block number it answered. */
    private noteSeenBlock(
        node: RpcNodeProvider,
        request: JsonRpcPayload,
        result: unknown
    ): void {
        for (const blockNumber of seenBlockNumbers(request, result))
            if (typeof blockNumber === "string" && isHexString(blockNumber))
                this.raiseSeenBlock(node, Number(blockNumber));
    }

    private raiseSeenBlock(node: RpcNodeProvider, blockNumber: number): void {
        if (blockNumber > (this.highestSeenBlocks.get(node) ?? -1))
            this.highestSeenBlocks.set(node, blockNumber);
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
            const { value: answer, block } = await read(
                await this.getLightClient()
            );
            if (this.comparesReads)
                await this.compareWithNode(node, request, answer, block);
            return { id: request.id, ...answer };
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

    /**
     * Asks `node` the read `request` at `block`, which proved `answer`, and
     * counts whether it answers alike; a different answer is logged as an error.
     */
    private async compareWithNode(
        node: RpcNodeProvider,
        request: JsonRpcPayload,
        answer: LocalAnswer,
        block: ProvenBlock
    ): Promise<void> {
        let nodeAnswer: ComparedAnswer | undefined;
        let failure: unknown;
        try {
            const sent = await node.trySendOnCurrentSocket(
                request.method,
                paramsAtBlock(request, block.ethereumBlockHash)
            );
            nodeAnswer = sent && { result: sent.result };
        } catch (error) {
            nodeAnswer = comparedAnswerOf(error);
            failure = error;
        }
        // a call at a block the node no longer has fails without being compared
        if (
            nodeAnswer &&
            "failure" in nodeAnswer &&
            !(await this.knowsBlock(node, block))
        )
            nodeAnswer = undefined;
        if (!nodeAnswer) {
            // no answer, or the node's socket ended before it answered
            this.readComparisons.notCompared++;
            this.logger.warn("RPC node did not answer a compared read", {
                ...LoggerUtils.getChainReadMetadata(request),
                block: block.number,
                ...(failure !== undefined && { error: failure })
            });
            return;
        }
        const localAnswer: ComparedAnswer =
            "result" in answer
                ? { result: answer.result }
                : { revert: String(answer.error.data) };
        if (isSameAnswer(localAnswer, nodeAnswer)) {
            this.readComparisons.matched++;
            return;
        }
        this.readComparisons.differed++;
        this.logger.error(
            "Light client answered a read otherwise than the RPC node at the same block",
            {
                ...LoggerUtils.getChainReadMetadata(request),
                block: block.number,
                local: localAnswer,
                node: nodeAnswer
            }
        );
    }

    /** Whether `node` still has `block`; false when it does not answer. */
    private async knowsBlock(
        node: RpcNodeProvider,
        block: ProvenBlock
    ): Promise<boolean> {
        const sent = await node
            .trySendOnCurrentSocket("eth_getBlockByHash", [
                block.ethereumBlockHash,
                false
            ])
            .catch(() => undefined);
        return sent?.result !== undefined && sent.result !== null;
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
            reader: this.chain.createReader(
                (method, params) => this.requestNode(method, params),
                async (keys, block) => {
                    const node = this.servingNode();
                    if (!node || !(await this.servesWatch(node)))
                        return undefined;
                    return await this.subscriptions.watchKeys(
                        node,
                        keys,
                        block
                    );
                }
            ),
            createPartition: () => this.chain.createPartition(),
            servingNode: () => this.servingNode(),
            chainPrecompiles: this.chain.chainPrecompiles,
            hardfork: this.chain.hardfork,
            ethereumPrecompiles: this.chain.ethereumPrecompiles,
            getChainId: async () => (await this.getNetwork()).chainId,
            blockFloor: () => {
                const node = this.servingNode();
                return node && this.highestSeenBlocks.get(node);
            },
            pushWaitMs: this.chain.blockTimeMs,
            fetchesEachMiss: this.fetchesEachMiss,
            counters: this.lightClientCounters,
            pushedState: this.pushedStateCounters,
            pushedBlockTimings: this.pushedBlockTimings,
            logger: this.logger
        });
        // each node's new heads come over its sockets, without polling
        for (const node of this.nodes)
            this.unwatchNodes.push(
                node.watchSockets((socket) => {
                    void this.headSockets.add(
                        socket,
                        "block",
                        (blockNumber: number) =>
                            this.raiseSeenBlock(node, blockNumber)
                    );
                })
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
            }, this.chain.blockTimeMs);
        });
    }

    /** Whether `node` lists the light client endpoints; it is asked once. */
    private async hasEndpoints(node: RpcNodeProvider): Promise<boolean> {
        return (await this.listedEndpoints(node)).subscriptions;
    }

    /** Whether `node` lists the light client endpoints and the watch of keys. */
    private async servesWatch(node: RpcNodeProvider): Promise<boolean> {
        const listed = await this.listedEndpoints(node);
        return listed.subscriptions && listed.watch;
    }

    /** Which light client endpoints `node` lists; it is asked once. */
    private listedEndpoints(node: RpcNodeProvider): Promise<ListedEndpoints> {
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

    private async askForEndpoints(
        node: RpcNodeProvider
    ): Promise<ListedEndpoints> {
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
        const { result } = sent;
        const listed =
            typeof result === "object" && result !== null && "methods" in result
                ? result.methods
                : undefined;
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
        return {
            subscriptions: hasEndpoints,
            watch: methods.includes(LIGHT_CLIENT_METHODS.watch)
        };
    }
}
