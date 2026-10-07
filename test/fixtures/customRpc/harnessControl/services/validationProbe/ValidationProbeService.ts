// @spec-test-coverage-ignore: host-side validation probes
import { recordValidationBoundary } from "./RecordingValidationStrategy";
import ValidationProbeRpcMethods from "./ValidationProbeRpcMethods";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import Clock from "@/Clock";
import MultiRpcProvider from "@/evm/p2pRuntime/rpcNodes/MultiRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { Block, StateSnapshot } from "@/models";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type AValidationStrategy from "@/stateManager/validationStrategy/AValidationStrategy";
import DisputeValidationStrategy from "@/stateManager/validationStrategy/DisputeValidationStrategy";
import { BlockOrigin, getSourcePeers } from "@/storage/QueueStorage";
import type {
    BlockPredecessor,
    QueuedBlockEntry
} from "@/storage/QueueStorage";
import type NetworkTransport from "@/transport/NetworkTransport";
import { BlockValidationResult } from "@/types";
import type { Address, ForkId, Hash, Timestamp } from "@/types/types";
import { Codec, Mutex, Type } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import * as factory from "@test/factory";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ethers, id, Log, type WebSocketProvider } from "ethers";

/** The bound of the wait for logs a catch-up scheduled; the drain is local. */
const CATCH_UP_DRAIN_TIMEOUT_MS = 30_000;

export type ConcurrentCalldataRecoveryProbe = {
    queryCount: number;
    firstFound: boolean;
    secondFound: boolean;
    retryFound: boolean;
};

export type ReductionChallengeProbe = {
    /** Recorded challenge sends - a real one would derail the session. */
    challengeCalls: number;
    /** The verdict: true = do not challenge. Null when the call threw. */
    isValid: boolean | null;
    threw: string | null;
};

export type InboundRunRecoveryProbe = {
    /** Provider getLogs calls the recovery made (0 when storage sufficed). */
    queryCount: number;
    /** Each attempt's `fromBlock`, in attempt order. */
    queriedFromBlocks: (number | null)[];
    /** The event-sync watermark when the call started. */
    cursorAtCall: number | null;
    /** The `toBlock` every attempt queried up to. */
    toBlock: number | null;
    /** InboundMessagesProcessed logs the recovery dispatched. */
    scheduledLogCount: number;
    /** Blocks returned, or null when the gap survived recovery. */
    blockCount: number | null;
    /** Whether the peer held the requested head before the call. */
    heldBefore: boolean;
    heldAfter: boolean;
    /** Set only if the recovery threw - its contract says it never does. */
    threw: string | null;
};

/**
 * How the newest InboundMessagesProcessed log is delivered again: the same
 * log (a second node's stream), the log re-mined in another block after a
 * reorg, or that re-mined log removed by a further reorg.
 */
export type InboundLogRedelivery =
    | "duplicate"
    | "reorged"
    | "removed"
    // the re-mined log, streamed once its block is the completed watermark
    | "reorgedAtWatermark";

/** A chain log's fields, as they cross the control RPC. */
export type ChainLogFields = {
    address: string;
    topics: string[];
    data: string;
    blockNumber: number;
    blockHash: string;
    transactionHash: string;
    index: number;
    transactionIndex: number;
};

/** One log delivered again through the scheduler, and what it caused. */
export type StreamedLogDeliveryProbe = {
    handlerCalls: number;
    logBlockNumber: number;
    /** The completed-block watermark when the log was delivered. */
    watermark: number | null;
};

export type BlockCalldataRecoveryProbe = {
    /** Whether the recovery ended with the calldata in local storage. */
    recoveredCalldata: boolean;
    /** Whether the recovery dispatched a calldata log for validation. */
    validationScheduled: boolean;
    /** Provider getLogs calls the recovery made. */
    queryCount: number;
    /** Set only if the recovery threw - its contract says it never does. */
    threw: string | null;
};

export type DisputeStrategyResultMatrix = Record<string, string>;

export type MissingParticipantSnapshotsProbe = {
    earlyAuthorResult: string;
    signatureUnionResult: string;
    proofStored: boolean;
};

export type IsDisputedForkProbe = {
    disputed: boolean;
    onChainQueries: number;
};

export type BlockProbeOptions = {
    strategy?: "active" | "dispute" | "spectating" | "calldata";
    encodedDispute?: string;
    /** Supplier of this copy, recorded in the per-source contribution map. */
    senderAddress?: Address;
};

export type BlockValidationProbeOptions = BlockProbeOptions & {
    /**
     * Drive this one deviation hook instead of validateBlockConfirmation -
     * for branches the pipeline can't reach: an unknown-fork entry is never
     * handed to `validateBlockConfirmation` because
     * `BlockQueueManager.scheduleQueueExecution` and `tryExecuteFromQueue`
     * both return early on a non-current fork, so the missing-genesis branch
     * is only reachable by calling the hook.
     */
    hook?:
        | "blockAuthorIsNotParticipant"
        | "wrongGenesisDetected"
        | "invalidStateTransitionDetected"
        | "objectiveInvalidTimestampDetected"
        | "forgedInboundMessageBlockDetected"
        | "blockForkIsDisputed";
    /**
     * "validate" (default) runs validateBlockConfirmation only; "full" runs
     * the whole onBlockConfirmation pipeline (assembly, hash compare, VM
     * restore) under the same record-only side-effect wrappers.
     */
    pipeline?: "validate" | "full";
};

export type BlockValidationProbe = {
    result: number;
    resultName: string;
    /** Which strategy implementation ran (live, spectating, dispute, ...). */
    strategyName: string;
    disputedForkIds: string[];
    disconnectedAddresses: string[];
    firedHooks: string[];
    restoreQueuedEntryCalled: boolean;
    abortCalled: boolean;
    signerAddress: string;
    fraudProofType: string | null;
    /** Source attribution the entry carried into validation. */
    sourcePeers: string[];
    /** How many times validation asked EventSyncService to recover calldata. */
    calldataRecoveryQueries: number;
    subjectiveWarningCount: number;
};

export type BlockIngestProbe = BlockValidationProbe & {
    /** onBlockConfirmation's return value; null when it threw. */
    keepConnection: boolean | null;
    /** The error onBlockConfirmation threw; null when it returned. */
    threw: string | null;
};

export type DisputeStructIngestProbe = {
    /** onBlockConfirmationStruct's return value; null when it threw. */
    accepted: boolean | null;
    /** The error onBlockConfirmationStruct threw; null when it returned. */
    threw: string | null;
};

/**
 * One in-flight runBlockValidation/runBlockIngest call: the decoded block and
 * entry, the chosen strategy (`instrumentedStrategy` is the same strategy
 * wrapped to log fired deviation hooks into `recorded`), the side effects the
 * record-only stubs captured, and `restore()` to put the patched live methods
 * back.
 */
type RecordedValidationRun = {
    block: Block;
    entry: QueuedBlockEntry;
    strategy: AValidationStrategy;
    instrumentedStrategy: AValidationStrategy;
    recorded: {
        disputedForkIds: string[];
        disconnectedAddresses: string[];
        firedHooks: string[];
        restoreQueuedEntryCalled: boolean;
        abortCalled: boolean;
        calldataRecoveryQueries: number;
        subjectiveWarningCount: number;
        lastHookResult: BlockValidationResult | undefined;
    };
    restore: () => void;
};
export class ValidationProbeService extends ANetworkRpcService<
    ValidationProbeRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    /**
     * Serializes runBlockValidation/runBlockIngest's record-only
     * patch/restore region. The
     * patch replaces shared live methods (dispute, disconnect, restore), so two
     * overlapping probes would restore each other's replacements.
     */
    private readonly blockValidationProbeMutex = new Mutex();
    /** Releases of the watermark holds taken through holdEventWatermark; the index is the hold's id. */
    private readonly watermarkReleases: (() => void)[] = [];

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessValidationProbeService"
            })
        );
    }
    get sm() {
        return this.p2pManager.stateManager;
    }

    /**
     * Single owner of dispute-strategy construction for the stub probes, so
     * constructor inputs can't drift between them. The probes replay `block`
     * as the last milestone's block at index 0 from the chain's anchor (a
     * replay that establishes faults), judged from its replay predecessor.
     */
    public createDisputeValidationStrategy(
        dispute: DisputeStruct,
        block?: Block,
        predecessor = this.getReplayPredecessor(block)
    ): DisputeValidationStrategy {
        return new DisputeValidationStrategy(
            this.sm.storage,
            dispute,
            0,
            predecessor,
            this.sm.disputeValidationService,
            true,
            this.sm.logger
        );
    }

    /**
     * What dispute replay judges `block` from: the stored block before it
     * (none at height 0), that block's snapshot (the fork genesis at height 0)
     * and its state. Without `block`, or for a block whose predecessor this
     * peer does not hold, the peer's latest stored point.
     */
    public getReplayPredecessor(block?: Block): BlockPredecessor {
        const storage = this.sm.storage;
        const held = block
            ? storage.getPreviousBlockAndSnapshot(block.coordinates)
            : {};
        const latest = storage.blocks.getLatestBlock(this.sm.forkId);
        const { block: previous, snapshot } = held.snapshot
            ? held
            : {
                  block: latest,
                  snapshot: storage.getStateSnapshot({
                      forkId: this.sm.forkId,
                      height: latest ? latest.height : -1
                  })
              };
        const state =
            snapshot &&
            storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            );
        if (!snapshot || !state)
            throw new Error(
                `getReplayPredecessor: no stored state to judge the block at height ${block?.height} from`
            );
        return { block: previous, snapshot, state };
    }

    /**
     * Run `isDisputedFork` while counting the local-diamond queries, so a test
     * can prove which of the two sources decided. `markLocallyDisputed`
     * records the local marker first, as disputing the fork would.
     */
    public async probeIsDisputedFork(
        forkId: ForkId,
        markLocallyDisputed: boolean
    ): Promise<IsDisputedForkProbe> {
        if (markLocallyDisputed) {
            this.sm.storage.disputes.storeDisputedFork(forkId, true);
        }
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;
        const original = localDiamond.isForkDisputed;
        let onChainQueries = 0;
        localDiamond.isForkDisputed = ((
            ...args: Parameters<typeof original>
        ) => {
            onChainQueries += 1;
            return original(...args);
        }) as typeof localDiamond.isForkDisputed;
        try {
            const disputed = await this.sm.validationService.isDisputedFork(
                forkId,
                this.sm.channelId
            );
            return { disputed, onChainQueries };
        } finally {
            localDiamond.isForkDisputed = original;
        }
    }

    /**
     * Store a block straight into block storage, bypassing validation. Used to
     * build a dispute-replay chain that is deliberately incomplete: a stored
     * parent whose snapshot (or whose snapshot's state) is absent.
     */
    public storeBlockFixture(encodedBlockConfirmation: string): {
        hash: string;
    } {
        const block = Block.fromBlockConfirmation(
            Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation)
        );
        this.sm.storage.blocks.storeBlock(block);
        return { hash: String(block.hash) };
    }

    /**
     * Store a state snapshot straight into snapshot storage, so a fixture
     * parent can point at a snapshot whose state machine state is missing.
     */
    public storeStateSnapshotFixture(encodedSnapshot: string): {
        hash: string;
    } {
        const snapshot = StateSnapshot.from(
            Codec.decode(encodedSnapshot, Type.StateSnapshot)
        );
        this.sm.storage.stateSnapshots.storeStateSnapshot(snapshot);
        return { hash: String(snapshot.hash) };
    }

    /**
     * Store on-chain calldata for a block at a chosen timestamp - the state a
     * real `postBlockCalldata` + recovery leaves behind, without needing the
     * chain to mine at that exact second.
     */
    public stageBlockCalldata(
        encodedSignedBlock: string,
        onChainTimestamp: Timestamp
    ): void {
        this.sm.storage.blockCalldata.storeBlockCalldata({
            signedBlock: Codec.decode(encodedSignedBlock, Type.SignedBlock),
            onChainTimestamp
        });
    }

    /**
     * Post a block's calldata on-chain the way the chain-fallback path does.
     * Returns the chain block number the post landed in.
     */
    public async postBlockCalldataOnChain(
        encodedSignedBlock: string
    ): Promise<{ blockNumber: number; onChainTimestamp: Timestamp }> {
        const tx = await this.sm.stateChannelManagerContract.postBlockCalldata(
            Codec.decode(encodedSignedBlock, Type.SignedBlock),
            Clock.getTimeInSeconds() + 1000
        );
        const receipt = await tx.wait();
        if (!receipt) throw new Error("postBlockCalldata produced no receipt");
        const chainBlock = await receipt.getBlock();
        return {
            blockNumber: receipt.blockNumber,
            onChainTimestamp: chainBlock.timestamp
        };
    }

    /**
     * Wait until every contract event this peer scheduled has settled. Answers
     * `true`, so the caller awaits the drain.
     */
    public async drainScheduledEvents(): Promise<boolean> {
        await this.sm.eventSyncService.waitForScheduled(
            CATCH_UP_DRAIN_TIMEOUT_MS
        );
        return true;
    }

    /**
     * Deliver the channel's newest InboundMessagesProcessed log again through
     * the real scheduler. Record-only: the handler records each call instead
     * of applying a second copy to the live session.
     */
    public async probeInboundLogRedelivery(
        redelivery: InboundLogRedelivery
    ): Promise<StreamedLogDeliveryProbe> {
        const sm = this.sm;
        if (redelivery === "reorgedAtWatermark")
            await sm.eventSyncService.waitForScheduled(
                CATCH_UP_DRAIN_TIMEOUT_MS
            );
        const contract = sm.stateChannelManagerContract;
        const logs = await contract.queryFilter(
            contract.filters.InboundMessagesProcessed(sm.channelId)
        );
        const log = logs.at(-1);
        if (!log) throw new Error("Expected an InboundMessagesProcessed log");
        const delivered =
            redelivery === "duplicate"
                ? log
                : new Log(
                      {
                          transactionHash: log.transactionHash,
                          blockHash: id(`reorged:${log.blockHash}`),
                          blockNumber: log.blockNumber,
                          removed: redelivery === "removed",
                          address: log.address,
                          data: log.data,
                          topics: log.topics,
                          index: log.index,
                          transactionIndex: log.transactionIndex
                      },
                      log.provider
                  );
        const eventHandler = sm.eventHandler;
        const original = eventHandler.onInboundMessagesProcessed;
        let handlerCalls = 0;
        eventHandler.onInboundMessagesProcessed = async () => {
            handlerCalls += 1;
        };
        const watermark =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;
        try {
            if (redelivery === "reorgedAtWatermark")
                await sm.eventSyncService.scheduleStreamedLog(
                    delivered,
                    sm.channelId
                );
            else await sm.eventSyncService.scheduleLog(delivered, sm.channelId);
            return {
                handlerCalls,
                logBlockNumber: log.blockNumber,
                watermark
            };
        } finally {
            eventHandler.onInboundMessagesProcessed = original;
        }
    }

    /**
     * Run the reconnect catch-up from this peer's first RPC node and wait for
     * the logs it scheduled. Answers whether the read succeeded; dispatches
     * are observed through the peer's forwarded event-handler spies.
     */
    public async runCatchUpFromFirstNode(): Promise<boolean> {
        const sm = this.sm;
        const provider = sm.stateChannelManagerContract.runner?.provider;
        if (!(provider instanceof MultiRpcProvider))
            throw new Error("Expected the runtime RPC node provider");
        const resumeFrom = await sm.eventSyncService.catchUpLogs(
            provider.nodes[0],
            sm.channelId,
            0
        );
        await sm.eventSyncService.waitForScheduled(CATCH_UP_DRAIN_TIMEOUT_MS);
        return resumeFrom === undefined;
    }

    /**
     * Run one reconnect catch-up for this peer's channel through a separate
     * RPC node at `nodeUrl`, from `resumeFrom` when given, and wait for the
     * logs it scheduled. Answers the block to resume from, or null once
     * caught up.
     */
    public async runCatchUpThroughNode(
        nodeUrl: string,
        resumeFrom?: number
    ): Promise<number | null> {
        const sm = this.sm;
        const node = new RpcNodeProvider(nodeUrl, sm.logger);
        try {
            if (await node.firstAttempt)
                throw new Error("Expected the catch-up node to connect");
            const nextResumeFrom = await sm.eventSyncService.catchUpLogs(
                node,
                sm.channelId,
                0,
                resumeFrom
            );
            await sm.eventSyncService.waitForScheduled(
                CATCH_UP_DRAIN_TIMEOUT_MS
            );
            return nextResumeFrom ?? null;
        } finally {
            node.destroy();
        }
    }

    /**
     * Schedule `fields`' log the way a recovery query does, wait for it to
     * complete, and answer the channel's watermark afterwards.
     */
    public async scheduleLogAsRecovery(
        fields: ChainLogFields
    ): Promise<number | null> {
        const sm = this.sm;
        const provider = sm.stateChannelManagerContract.runner?.provider;
        if (!provider) throw new Error("Expected the runtime chain provider");
        const log = new Log({ ...fields, removed: false }, provider);
        await sm.eventSyncService.scheduleLog(log, sm.channelId);
        return this.getEventWatermark();
    }

    /**
     * Hold the channel's completed-block watermark the way a reconnect
     * catch-up does, and answer the hold's id for releaseEventWatermark.
     */
    public holdEventWatermark(): number {
        const sm = this.sm;
        this.watermarkReleases.push(
            sm.eventSyncService.holdWatermark(sm.channelId, 0)
        );
        return this.watermarkReleases.length - 1;
    }

    /** Run the release of hold `holdId`, and answer the watermark afterwards. */
    public releaseEventWatermark(holdId: number): number | null {
        const release = this.watermarkReleases[holdId];
        if (!release) throw new Error(`No watermark hold ${holdId}`);
        release();
        return this.getEventWatermark();
    }

    /** The channel's completed-block watermark, or null before one exists. */
    public getEventWatermark(): number | null {
        return (
            this.sm.storage.eventSync.getLatestProcessedBlock(
                this.sm.channelId
            ) ?? null
        );
    }

    /**
     * Listeners of the channel's subscription filter on each RPC node's open
     * socket, in node order; null for a node with no open socket.
     */
    public async getChannelSubscriptionCounts(): Promise<(number | null)[]> {
        const sm = this.sm;
        const provider = sm.stateChannelManagerContract.runner?.provider;
        if (!(provider instanceof MultiRpcProvider))
            throw new Error("Expected the runtime RPC node provider");
        const filter = sm.eventSyncService.getSubscriptionFilter(sm.channelId);
        return Promise.all(
            provider.nodes.map((node) => {
                let socket: WebSocketProvider | undefined;
                node.watchSockets((open) => {
                    socket = open;
                })();
                return socket ? socket.listenerCount(filter) : null;
            })
        );
    }

    /** Clear the channel's event listener, as a failed open attempt does. */
    public async clearChannelListener(): Promise<boolean> {
        await this.sm.stateChannelEventListener.clearChannelId();
        return true;
    }

    /** Select the channel on the event listener again. */
    public async restoreChannelListener(): Promise<boolean> {
        await this.sm.stateChannelEventListener.setChannelId(this.sm.channelId);
        return true;
    }

    /**
     * Deliver the channel's ChannelOpened log again the way a lagging RPC
     * node's stream would, once every scheduled log has completed. Record-only:
     * the handler records a call instead of opening the channel twice.
     */
    public async probeStreamedLogBelowWatermark(): Promise<StreamedLogDeliveryProbe> {
        const sm = this.sm;
        await sm.eventSyncService.waitForScheduled(CATCH_UP_DRAIN_TIMEOUT_MS);
        const contract = sm.stateChannelManagerContract;
        const logs = await contract.queryFilter(
            contract.filters.ChannelOpened(sm.channelId)
        );
        const log = logs.at(-1);
        if (!log) throw new Error("Expected the channel's opening log");
        const watermark =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;
        const eventHandler = sm.eventHandler;
        const original = eventHandler.onChannelOpened;
        let handlerCalls = 0;
        eventHandler.onChannelOpened = async () => {
            handlerCalls += 1;
        };
        try {
            await sm.eventSyncService.scheduleStreamedLog(log, sm.channelId);
            return { handlerCalls, logBlockNumber: log.blockNumber, watermark };
        } finally {
            eventHandler.onChannelOpened = original;
        }
    }

    /**
     * Run the real `loadSynchronizedInboundRun` for `upperBlockHash`, bounded
     * below by this peer's fork-genesis inbound head, recording the chain
     * queries it makes (count and each query's span) and how many logs it
     * dispatched.
     */
    public async probeInboundRunRecovery(
        upperBlockHash: Hash,
        options?: { failChainQueries?: boolean }
    ): Promise<InboundRunRecoveryProbe> {
        const sm = this.sm;
        const genesis = sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
            sm.forkId
        );
        if (!genesis) throw new Error("Expected a genesis snapshot");
        const held = () =>
            Boolean(sm.storage.inboundMessages.getMessageBlock(upperBlockHash));
        const heldBefore = held();
        const cursorAtCall =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;

        if (options?.failChainQueries)
            this.p2pManager.localRpc.stub.failChainLogQueries();
        else this.p2pManager.localRpc.stub.countChainLogQueries();
        // count-and-forward: the driver's dispatch count is what proves an
        // already-applied log is not re-dispatched
        const eventSyncService = sm.eventSyncService;
        const originalScheduleLog =
            eventSyncService.scheduleLog.bind(eventSyncService);
        let scheduledLogCount = 0;
        eventSyncService.scheduleLog = ((log, scheduledChannelId) => {
            const parsed = sm.stateChannelManagerContract.interface.parseLog({
                topics: log.topics,
                data: log.data
            });
            if (parsed?.name === "InboundMessagesProcessed") {
                scheduledLogCount += 1;
            }
            return originalScheduleLog(log, scheduledChannelId);
        }) as typeof eventSyncService.scheduleLog;

        try {
            const run = await sm.eventSyncService.loadSynchronizedInboundRun(
                upperBlockHash,
                genesis.latestInboundMessageBlockHash,
                genesis.timestamp
            );
            return {
                ...this.p2pManager.localRpc.stub.describeChainLogQueries(),
                cursorAtCall,
                scheduledLogCount,
                blockCount: run ? run.length : null,
                heldBefore,
                heldAfter: held(),
                threw: null
            };
        } catch (error) {
            return {
                ...this.p2pManager.localRpc.stub.describeChainLogQueries(),
                cursorAtCall,
                scheduledLogCount,
                blockCount: null,
                heldBefore,
                heldAfter: held(),
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            eventSyncService.scheduleLog = originalScheduleLog;
            this.p2pManager.localRpc.stub.restoreChainLogQueries();
        }
    }

    /**
     * Lose a subscribed `BlockCalldataPosted` delivery for one of this peer's
     * own blocks, then run the real calldata recovery for that block. With
     * `failChainQueries` the recovery query is blinded, so the contained
     * failure path runs instead.
     */
    public async probeBlockCalldataRecovery(options?: {
        failChainQueries?: boolean;
    }): Promise<BlockCalldataRecoveryProbe> {
        const sm = this.sm;
        const forkId = sm.forkId;
        const block = await this.findOwnBlockWithoutPostedCalldata(forkId);

        this.p2pManager.localRpc.stub.holdCalldataPostedEvents();
        if (options?.failChainQueries)
            this.p2pManager.localRpc.stub.failChainLogQueries();
        else this.p2pManager.localRpc.stub.countChainLogQueries();

        try {
            await this.postBlockCalldataOnChain(
                Codec.encode(block.signedBlock, Type.SignedBlock) as string
            );
            // premise - the subscribed delivery really was lost
            await this.p2pManager.localRpc.stub.waitForHeldCalldataPostedEvent();
            const recovery =
                await sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    forkId,
                    block.height,
                    block.author
                );
            return {
                recoveredCalldata: recovery.blockCalldata !== undefined,
                validationScheduled: recovery.validationScheduled,
                queryCount:
                    this.p2pManager.localRpc.stub.chainLogQueries.length,
                threw: null
            };
        } catch (error) {
            return {
                recoveredCalldata: false,
                validationScheduled: false,
                queryCount:
                    this.p2pManager.localRpc.stub.chainLogQueries.length,
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            this.p2pManager.localRpc.stub.restoreChainLogQueries();
            this.p2pManager.localRpc.stub.restoreCalldataPostedEvents();
        }
    }

    /**
     * The newest block this peer authored whose on-chain calldata slot is
     * still free - only its author may post it, and only once.
     */
    private async findOwnBlockWithoutPostedCalldata(forkId: ForkId) {
        const latest = this.sm.storage.blocks.getLatestBlock(forkId);
        if (!latest) throw new Error("Expected a block on the current fork");
        for (let height = Number(latest.height); height >= 0; height--) {
            const block = this.sm.storage.blocks.getBlock(forkId, height);
            if (!block || block.author !== this.sm.signerAddress) continue;
            const commitment =
                await this.sm.stateChannelManagerContract.getBlockCallDataCommitment(
                    this.sm.channelId,
                    forkId,
                    height,
                    block.author
                );
            if (!commitment.found) return block;
        }
        throw new Error("Expected an own block with a free calldata slot");
    }

    /**
     * Run the real `validateDisputeReductionAndChallenge` against a claimed
     * `reducedForkId`, recording the challenge send instead of making it - a
     * real challenge transaction would derail the session.
     */
    public async probeDisputeReductionChallenge(
        reducedForkId: ForkId
    ): Promise<ReductionChallengeProbe> {
        const contract = this.sm.stateChannelManagerContract;
        const original = contract.challengeDisputeReduction;
        let challengeCalls = 0;
        contract.challengeDisputeReduction =
            this.p2pManager.localRpc.stub.asRecordingContractMethod(
                original,
                async () => {
                    challengeCalls += 1;
                    return { wait: async () => null };
                }
            );
        try {
            const isValid = await this.sm.eventHandler[
                "validateDisputeReductionAndChallenge"
            ](this.sm.forkId, reducedForkId);
            return { challengeCalls, isValid, threw: null };
        } catch (error) {
            return {
                challengeCalls,
                isValid: null,
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            contract.challengeDisputeReduction = original;
        }
    }

    public async probeConcurrentCalldataRecovery(): Promise<ConcurrentCalldataRecoveryProbe> {
        const contract = this.sm.stateChannelManagerContract;
        const original = contract.getBlockCallDataCommitment;
        let queryCount = 0;
        let release: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        contract.getBlockCallDataCommitment = (async (...parameters) => {
            queryCount += 1;
            await held;
            return original(...parameters);
        }) as typeof contract.getBlockCallDataCommitment;
        try {
            const first =
                this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            const second =
                this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            release?.();
            const [firstResult, secondResult] = await Promise.all([
                first,
                second
            ]);
            const retryResult =
                await this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            return {
                queryCount,
                firstFound: firstResult.blockCalldata !== undefined,
                secondFound: secondResult.blockCalldata !== undefined,
                retryFound: retryResult.blockCalldata !== undefined
            };
        } finally {
            contract.getBlockCallDataCommitment = original;
        }
    }

    public async probeDisputeStrategyResultMatrix(): Promise<DisputeStrategyResultMatrix> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const strategy = this.createDisputeValidationStrategy(dispute);
        const matrix: DisputeStrategyResultMatrix = {};
        for (const result of [
            BlockValidationResult.SUCCESS,
            BlockValidationResult.NOT_READY,
            BlockValidationResult.DISCONNECT,
            BlockValidationResult.DISPUTE,
            BlockValidationResult.BROADCAST,
            BlockValidationResult.NOT_ENOUGH_TIME,
            BlockValidationResult.DUPLICATE
        ]) {
            const name = BlockValidationResult[result];
            try {
                matrix[name] = String(
                    await strategy.interpretFinalValidationResult(result)
                );
            } catch {
                matrix[name] = "throw";
            }
        }
        return matrix;
    }

    public async probeReplayCommitCache(source: Address) {
        const sm = this.sm;
        await sm.mutex.lock({ taskName: "probeReplayCommitCache" });
        try {
            const block = sm.storage.blocks.getBlock(sm.forkId, 0);
            if (!block) throw new Error("Expected historical block zero");
            const snapshot = sm.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            )!;
            const encodedState =
                sm.storage.stateMachineStates.getStateMachineState(
                    snapshot.stateMachineStateHash
                )!;
            const before =
                sm.membershipService.getCachedSourceEligibility(source);
            const heightBefore = sm.storage.blocks.getNextBlockHeight(
                sm.forkId
            );
            const { dispute } = await sm.disputeManager.constructDispute(
                sm.forkId
            );
            let committed = false;
            await sm.blockCommitService.success(
                block,
                snapshot,
                encodedState,
                () => {},
                { joined: new Set(), left: new Set() },
                {
                    strategy: this.createDisputeValidationStrategy(
                        dispute,
                        block
                    ),
                    onBlockCommitted: () => {
                        committed = true;
                    }
                }
            );
            return {
                before,
                after: sm.membershipService.getCachedSourceEligibility(source),
                heightBefore,
                heightAfter: sm.storage.blocks.getNextBlockHeight(sm.forkId),
                historicalParticipants: snapshot.snapshotData.participants,
                committed
            };
        } finally {
            sm.mutex.unlock();
        }
    }

    public async commitPreparedSnapshot(
        encodedBlockConfirmation: string,
        encodedSnapshot: string,
        encodedState: string
    ) {
        const sm = this.sm;
        return sm.withMutex(
            async () => {
                const block = Block.fromBlockConfirmation(
                    Codec.decode(
                        encodedBlockConfirmation,
                        Type.BlockConfirmation
                    )
                );
                const snapshot = StateSnapshot.from(
                    Codec.decode(encodedSnapshot, Type.StateSnapshot)
                );
                const previous =
                    sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                        block.coordinates
                    );
                const joined = new Set(
                    snapshot.snapshotData.participants.filter(
                        (address) =>
                            !previous.snapshotData.participants.includes(
                                address
                            )
                    )
                );
                const left = new Set(
                    previous.snapshotData.participants.filter(
                        (address) =>
                            !snapshot.snapshotData.participants.includes(
                                address
                            )
                    )
                );
                await sm.diamondStateMachine.setState(encodedState);
                let callbackCalled = false;
                await sm.blockCommitService.success(
                    block,
                    snapshot,
                    encodedState,
                    () => {
                        callbackCalled = true;
                    },
                    { joined, left }
                );
                const stored = sm.storage.blocks.getBlock(block.hash)!;
                return {
                    callbackCalled,
                    status: sm.status,
                    height: stored.height,
                    hash: stored.hash,
                    snapshotHash:
                        sm.storage.stateSnapshots.getStateSnapshotByHash(
                            snapshot.hash
                        )?.hash,
                    encodedState: String(
                        await sm.diamondStateMachine.getState()
                    ),
                    signedBySelf:
                        stored.confirmationSignatures.size > 0 &&
                        [...stored.confirmationSignatures].some(
                            (signature) =>
                                stored.signatureToAddress(signature) ===
                                sm.signerAddress
                        ),
                    eligibility:
                        sm.membershipService.getCachedSourceEligibility(
                            sm.signerAddress
                        )
                };
            },
            { taskName: "commitPreparedSnapshot" }
        );
    }

    public async normalizeConfirmationCopies(
        copies: { encodedBlockConfirmation: string; source?: Address }[],
        strategyName: "live" | "spectating" | "dispute" | "calldata"
    ) {
        const sm = this.sm;
        const decoded = copies.map((copy) => ({
            block: Block.fromBlockConfirmation(
                Codec.decode(
                    copy.encodedBlockConfirmation,
                    Type.BlockConfirmation
                )
            ),
            source: copy.source
        }));
        if (!decoded.length) throw new Error("Expected a confirmation copy");
        let entry: QueuedBlockEntry;
        if (decoded[0].source) {
            for (const copy of decoded) {
                if (!copy.source)
                    throw new Error("Cannot mix sourced and proof copies");
                sm.storage.queues.queueBlock(copy.block, {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: copy.source
                });
            }
            entry = sm.storage.queues.removeBlock(decoded[0].block.hash)!;
        } else
            entry = sm.storage.queues.createEntry(decoded[0].block, {
                origin: BlockOrigin.PROOF
            });

        let strategy: AValidationStrategy = sm.blockValidationStrategy;
        if (strategyName === "spectating")
            strategy = sm.spectatingValidationStrategy;
        if (strategyName === "calldata")
            strategy = sm.calldataCommittedStrategy;
        if (strategyName === "dispute") {
            const { dispute } = await sm.disputeManager.constructDispute(
                sm.forkId
            );
            strategy = this.createDisputeValidationStrategy(
                dispute,
                entry.block
            );
        }
        let result: string;
        try {
            result =
                BlockValidationResult[
                    await sm.validationService.normalizeConfirmationSignatures(
                        entry,
                        strategy
                    )
                ];
        } catch (error) {
            result = `throw: ${error instanceof Error ? error.message : String(error)}`;
        }
        return {
            result,
            signatures: [...entry.block.confirmationSignatures].map(String),
            sources: [...entry.sourcesToSignatures].map(([source, values]) => ({
                source,
                charged: values.size,
                blacklisted: sm.p2pManager.isBlacklisted(source)
            })),
            authorBlacklisted: sm.p2pManager.isBlacklisted(entry.block.author)
        };
    }

    public async probeMissingParticipantSnapshots(): Promise<MissingParticipantSnapshotsProbe> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const latestBlock = this.sm.storage.blocks.getLatestBlock(
            this.sm.forkId
        );
        if (!latestBlock) throw new Error("Expected a latest block");
        const block = await Block.fromBlockStruct(
            {
                ...latestBlock.blockStruct,
                stateSnapshotHash: id("missing-participant-snapshot")
            },
            this.sm.signer
        );
        const strategy = this.createDisputeValidationStrategy(dispute, block);
        const entry = this.sm.storage.queues.createEntry(block, {
            origin: BlockOrigin.PROOF
        });

        const earlyAuthorResult =
            await strategy.blockAuthorIsNotParticipant(entry);
        const signatureUnionResult =
            await strategy.notAllSingersAreParticipants(
                entry,
                new Set([block.originalSignature])
            );
        return {
            earlyAuthorResult: BlockValidationResult[earlyAuthorResult],
            signatureUnionResult: BlockValidationResult[signatureUnionResult],
            proofStored:
                this.sm.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                ) !== undefined
        };
    }

    /**
     * White-box: run `tryMergeStoredBlockConfirmation` against the entry built
     * from the confirmation, under the peer's live, spectating, calldata, or a
     * fabricated dispute strategy. Returns the merge result and the persisted
     * signature set for the block's hash.
     */
    public async runStoredBlockMerge(
        encodedBlockConfirmation: string,
        options?: {
            strategy?: "active" | "dispute" | "spectating" | "calldata";
        }
    ): Promise<{
        result: number | null;
        persistedSignatures: string[] | null;
    }> {
        const sm = this.sm;
        const blockConfirmation = Codec.decode(
            encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const block = Block.fromBlockConfirmation(blockConfirmation);
        const entry = sm.storage.queues.createEntry(block, {
            origin: BlockOrigin.PROOF
        });

        let strategy: AValidationStrategy;
        switch (options?.strategy) {
            case "dispute":
                strategy = this.createDisputeValidationStrategy(
                    factory.dispute(),
                    block
                );
                break;
            case "spectating":
                strategy = sm.spectatingValidationStrategy;
                break;
            case "calldata":
                strategy = sm.calldataCommittedStrategy;
                break;
            default:
                strategy = sm.blockValidationStrategy;
        }
        const result =
            await sm.storedBlockMergeService.tryMergeStoredBlockConfirmation(
                entry,
                strategy
            );
        const persisted = sm.storage.blocks.getBlock(block.hash);
        return {
            result: result === undefined ? null : Number(result),
            persistedSignatures: persisted
                ? Array.from(persisted.confirmationSignatures).map(String)
                : null
        };
    }

    public async runBlockValidation(
        encodedBlockConfirmation: string,
        options?: BlockValidationProbeOptions
    ): Promise<BlockValidationProbe> {
        await this.blockValidationProbeMutex.lock({
            taskName: "stub-run-block-validation"
        });
        try {
            const run = this.startRecordedValidation(
                encodedBlockConfirmation,
                options
            );
            try {
                let result: BlockValidationResult;
                const hook = options?.hook;
                if (
                    hook === "invalidStateTransitionDetected" ||
                    hook === "objectiveInvalidTimestampDetected"
                ) {
                    result = await run.instrumentedStrategy[hook](run.block);
                } else if (hook === "forgedInboundMessageBlockDetected") {
                    // This hook consumes an already classified message block; the observer only aborts.
                    const inbound = factory.messageBlock();
                    result =
                        await run.instrumentedStrategy.forgedInboundMessageBlockDetected(
                            run.block,
                            inbound
                        );
                } else if (hook) {
                    result = await run.instrumentedStrategy[hook](run.entry);
                } else {
                    result =
                        await this.sm.validationService.validateBlockConfirmation(
                            run.entry,
                            run.instrumentedStrategy
                        );
                }
                return this.buildValidationProbe(run, result);
            } finally {
                run.restore();
            }
        } finally {
            this.blockValidationProbeMutex.unlock();
        }
    }

    /**
     * White-box: run the whole onBlockConfirmation pipeline (assembly, hash
     * compare, VM restore) under the same record-only side-effect wrappers as
     * `runBlockValidation`. `result` is the last deviation-hook verdict, or
     * SUCCESS when none fired.
     */
    public async runBlockIngest(
        encodedBlockConfirmation: string,
        options?: BlockProbeOptions
    ): Promise<BlockIngestProbe> {
        await this.blockValidationProbeMutex.lock({
            taskName: "stub-run-block-ingest"
        });
        try {
            const run = this.startRecordedValidation(
                encodedBlockConfirmation,
                options
            );
            try {
                let keepConnection: boolean | null = null;
                let threw: string | null = null;
                try {
                    keepConnection =
                        await this.sm.blockIngestService.onBlockConfirmation(
                            run.entry,
                            { validationStrategy: run.instrumentedStrategy }
                        );
                } catch (error) {
                    threw = errorMessage(error);
                }
                const result =
                    run.recorded.lastHookResult ??
                    BlockValidationResult.SUCCESS;
                return {
                    ...this.buildValidationProbe(run, result),
                    keepConnection,
                    threw
                };
            } finally {
                run.restore();
            }
        } finally {
            this.blockValidationProbeMutex.unlock();
        }
    }

    /**
     * Replay one confirmation as the dispute audit does: the struct caller
     * `onBlockConfirmationStruct` with a real DisputeValidationStrategy for
     * `dispute` at last-milestone block index 0 and its replay predecessor. The strategy's side effect (a
     * stored dispute fraud proof) stays real.
     */
    public async runBlockConfirmationStructUnderDispute(
        encodedBlockConfirmation: string,
        encodedDispute: string
    ): Promise<DisputeStructIngestProbe> {
        const blockConfirmation = Codec.decode(
            encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const block = Block.tryFromBlockConfirmation(blockConfirmation);
        const strategy = this.createDisputeValidationStrategy(
            Codec.decode(encodedDispute, Type.Dispute),
            block ?? undefined
        );
        const predecessor = this.getReplayPredecessor(block ?? undefined);
        try {
            return {
                accepted:
                    await this.sm.blockIngestService.onBlockConfirmationStruct(
                        blockConfirmation,
                        { validationStrategy: strategy, predecessor }
                    ),
                threw: null
            };
        } catch (error) {
            return { accepted: null, threw: errorMessage(error) };
        }
    }

    /**
     * Decode the confirmation, build the same entry the gossip pipeline
     * builds, pick the strategy, and swap the destructive side effects
     * (dispute, disconnect, queue restore) for recorders. The caller drives
     * validation against `entry`/`instrumentedStrategy`, reads what happened
     * off `recorded`, and MUST call `restore()` when done.
     */
    private startRecordedValidation(
        encodedBlockConfirmation: string,
        options: BlockProbeOptions | undefined
    ): RecordedValidationRun {
        const sm = this.sm;
        const blockConfirmation = Codec.decode(
            encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const block = Block.fromBlockConfirmation(blockConfirmation);
        // Sourced probes spend network allowances; replay has an explicit origin.
        const entry = options?.senderAddress
            ? sm.storage.queues.createEntry(block, {
                  origin: BlockOrigin.NETWORK,
                  senderAddress: options.senderAddress
              })
            : sm.storage.queues.createEntry(block, {
                  origin: BlockOrigin.PROOF
              });
        // default: the live block strategy (PARTICIPATING). "dispute" builds a
        // real DisputeValidationStrategy - as dispute auditing does - so the
        // dispute-only branches (skip future/disputed gates, setState, the
        // isLinked !prevBlock edge) are drivable here. the dispute struct is
        // only referenced when a deviation stores fraud-proof evidence; the
        // paths driven here don't, so a placeholder dispute is faithful.
        // dispute replay judges the block from its predecessor, which the
        // ingest pipeline also positions the state machine at
        if (options?.strategy === "dispute")
            entry.predecessor = this.getReplayPredecessor(block);
        const strategy =
            options?.strategy === "dispute"
                ? this.createDisputeValidationStrategy(
                      options.encodedDispute
                          ? Codec.decode(options.encodedDispute, Type.Dispute)
                          : factory.dispute(),
                      block,
                      entry.predecessor
                  )
                : options?.strategy === "spectating"
                  ? sm.spectatingValidationStrategy
                  : options?.strategy === "calldata"
                    ? sm.calldataCommittedStrategy
                    : sm.getActiveValidationStrategy();

        const recorded: RecordedValidationRun["recorded"] = {
            disputedForkIds: [],
            disconnectedAddresses: [],
            firedHooks: [],
            restoreQueuedEntryCalled: false,
            abortCalled: false,
            calldataRecoveryQueries: 0,
            subjectiveWarningCount: 0,
            lastHookResult: undefined
        };

        const logStore = sm.logger["logStore"];
        const originalStoreLog = logStore.store.bind(logStore);
        logStore.store = (entry) => {
            if (
                entry.level === "warn" &&
                entry.meta.some((meta) => meta?.checkType === "subjective")
            )
                recorded.subjectiveWarningCount += 1;
            originalStoreLog(entry);
        };

        // record-only: a real dispute posts on-chain against the crafted block,
        // a real disconnect cuts a live transport, a real restore re-arms a
        // queue timeout -> all would derail the session. Fraud-proof creation
        // stays real so the hook is identifiable by the persisted proof type.
        const disputeManager = sm.disputeManager;
        const originalDispute = disputeManager?.dispute.bind(disputeManager);
        if (disputeManager) {
            disputeManager.dispute = async (forkId: ForkId) => {
                recorded.disputedForkIds.push(String(forkId));
            };
        }
        const p2pManager = this.p2pManager;
        const originalDisconnect =
            p2pManager.disconnectAndBlacklistPeerByEvmAddress.bind(p2pManager);
        p2pManager.disconnectAndBlacklistPeerByEvmAddress = ((
            address: Address
        ) => {
            recorded.disconnectedAddresses.push(String(address));
        }) as typeof p2pManager.disconnectAndBlacklistPeerByEvmAddress;
        const originalRestore = sm.blockQueueManager.restoreQueuedEntry.bind(
            sm.blockQueueManager
        );
        sm.blockQueueManager.restoreQueuedEntry = (_entry) => {
            recorded.restoreQueuedEntryCalled = true;
        };
        const originalAbort = sm.abort.bind(sm);
        sm.abort = () => {
            recorded.abortCalled = true;
            return originalAbort();
        };
        // count-and-forward: recovery must stay real, the count only proves
        // validation reached the on-chain lookup
        const eventSyncService = sm.eventSyncService;
        const originalRecover =
            eventSyncService.tryRecoverBlockCalldataAndScheduleValidation.bind(
                eventSyncService
            );
        eventSyncService.tryRecoverBlockCalldataAndScheduleValidation = ((
            ...args: Parameters<typeof originalRecover>
        ) => {
            recorded.calldataRecoveryQueries += 1;
            return originalRecover(...args);
        }) as typeof eventSyncService.tryRecoverBlockCalldataAndScheduleValidation;

        // record which deviation hook the strategy fired, so a test can pin its
        // named guard
        const instrumentedStrategy = new Proxy(strategy, {
            get(target, prop) {
                const value = Reflect.get(target, prop);
                if (typeof value !== "function") return value;
                return (...args: unknown[]) =>
                    Promise.resolve(
                        (value as (...a: unknown[]) => unknown).apply(
                            target,
                            args
                        )
                    ).then((resolved) => {
                        if (
                            typeof prop === "string" &&
                            typeof resolved === "number" &&
                            BlockValidationResult[resolved] !== undefined
                        ) {
                            recorded.firedHooks.push(prop);
                            recorded.lastHookResult =
                                resolved as BlockValidationResult;
                        }
                        return resolved;
                    });
            }
        });

        return {
            block,
            entry,
            strategy,
            instrumentedStrategy,
            recorded,
            restore: () => {
                logStore.store = originalStoreLog;
                if (disputeManager && originalDispute) {
                    disputeManager.dispute = originalDispute;
                }
                p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                    originalDisconnect;
                sm.blockQueueManager.restoreQueuedEntry = originalRestore;
                sm.abort = originalAbort;
                eventSyncService.tryRecoverBlockCalldataAndScheduleValidation =
                    originalRecover;
            }
        };
    }

    private buildValidationProbe(
        run: RecordedValidationRun,
        result: BlockValidationResult
    ): BlockValidationProbe {
        const fraudProof =
            this.sm.storage.fraudProofs.getFraudProofForParticipant(
                run.block.signerAddress
            );
        return {
            result,
            resultName: BlockValidationResult[result] ?? `UNKNOWN(${result})`,
            strategyName: run.strategy.name,
            disputedForkIds: run.recorded.disputedForkIds,
            disconnectedAddresses: run.recorded.disconnectedAddresses,
            firedHooks: run.recorded.firedHooks,
            restoreQueuedEntryCalled: run.recorded.restoreQueuedEntryCalled,
            abortCalled: run.recorded.abortCalled,
            signerAddress: String(run.block.signerAddress),
            fraudProofType: fraudProof ? String(fraudProof.proofType) : null,
            sourcePeers: [...getSourcePeers(run.entry)].map(String),
            calldataRecoveryQueries: run.recorded.calldataRecoveryQueries,
            subjectiveWarningCount: run.recorded.subjectiveWarningCount
        };
    }

    private async runAuthorGate(
        author: Address,
        stateSnapshotHash: Hash,
        coordinates?: { forkId: ForkId; height: number }
    ): Promise<string> {
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId);
        if (!head) throw new Error("Expected a latest block");

        const blockStruct = {
            ...factory.blockStructWithTransactionHeader(head.blockStruct, {
                participant: author,
                transactionCnt: coordinates?.height ?? head.height + 1,
                forkId: coordinates?.forkId ?? this.sm.forkId
            }),
            previousBlockHash: head.hash,
            stateSnapshotHash
        };
        const block = await Block.fromBlockStruct(blockStruct, this.sm.signer);

        const { strategy, result } = recordValidationBoundary(
            this.sm.blockValidationStrategy
        );
        const entry = this.sm.storage.queues.createEntry(block, {
            origin: BlockOrigin.PROOF
        });

        await this.sm.validationService.validateBlockConfirmation(
            entry,
            strategy
        );

        // the staged blocks always target the live, open channel - stopping
        // this early means the staging broke, not that the gate decided
        if (["wrongChannel", "channelNotOpened"].includes(result.reached)) {
            throw new Error(
                `author-gate probe stopped at ${result.reached}, before the gate`
            );
        }
        return result.reached;
    }

    /** The head block's own resulting snapshot - the anchor the gate binds against. */
    private previousSnapshot(): StateSnapshot {
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId);
        if (!head) throw new Error("Expected a latest block");
        const snapshot = this.sm.storage.stateSnapshots.getStateSnapshotByHash(
            head.stateSnapshotHash
        );
        if (!snapshot) throw new Error("Expected the latest block's snapshot");
        return snapshot;
    }

    /** Store a snapshot listing `participants` at the given coordinates. */
    private storeSnapshotAt(
        participants: Address[],
        height: number,
        forkId: ForkId = this.sm.forkId
    ): Hash {
        const snapshot = factory.stateSnapshot({
            forkId,
            blockHeight: height,
            timestamp: 0,
            snapshotData: factory.snapshotData({ participants })
        });
        this.sm.storage.stateSnapshots.storeStateSnapshot(snapshot);
        return snapshot.hash;
    }

    private nextHeight(): number {
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId);
        if (!head) throw new Error("Expected a latest block");
        return head.height + 1;
    }

    private randomAddress(): Address {
        return ethers.Wallet.createRandom().address as Address;
    }

    /** Coordinates with no locally-anchored previous snapshot. */
    private unanchoredCoordinates() {
        return {
            forkId: id("probeAuthorGate-unknown-fork") as ForkId,
            height: 1
        };
    }

    /** Author already listed in the previous snapshot. */
    public async probeAuthorGatePreviousSnapshotMember(): Promise<string> {
        const previous = this.previousSnapshot();
        const member = previous.snapshotData.participants[0] as Address;
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId)!;
        return this.runAuthorGate(member, head.stateSnapshotHash);
    }

    /** Author only in a resulting snapshot bound to the block's own coordinates. */
    public async probeAuthorGateMatchingResultingSnapshot(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [outsider],
            this.nextHeight()
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Author only in a resulting snapshot from a different height. */
    public async probeAuthorGateStaleHeightSnapshot(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [outsider],
            this.nextHeight() + 100
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Author only in a resulting snapshot from a different fork, same height. */
    public async probeAuthorGateWrongForkSnapshot(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [outsider],
            this.nextHeight(),
            id("probeAuthorGate-wrong-fork") as ForkId
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Resulting snapshot matches the coordinates but omits the author. */
    public async probeAuthorGateMatchingSnapshotExcludingAuthor(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [this.randomAddress()],
            this.nextHeight()
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Declared resulting snapshot absent from storage; author is in the previous one. */
    public async probeAuthorGateMissingSnapshotPreviousMember(): Promise<string> {
        const member = this.previousSnapshot().snapshotData
            .participants[0] as Address;
        return this.runAuthorGate(
            member,
            id("probeAuthorGate-unstored-result") as Hash
        );
    }

    /** Declared resulting snapshot absent from storage; author is an outsider. */
    public async probeAuthorGateMissingSnapshotOutsider(): Promise<string> {
        return this.runAuthorGate(
            this.randomAddress(),
            id("probeAuthorGate-unstored-result") as Hash
        );
    }

    /** No local anchor; author is a current on-chain participant. */
    public async probeAuthorGateNoAnchorCurrentParticipant(): Promise<string> {
        const member = this.previousSnapshot().snapshotData
            .participants[0] as Address;
        return this.runAuthorGate(
            member,
            ethers.ZeroHash as Hash,
            this.unanchoredCoordinates()
        );
    }

    /** No local anchor; author is a pending (not-yet-current) on-chain participant. */
    public async probeAuthorGateNoAnchorPendingParticipant(
        pendingParticipant: Address
    ): Promise<string> {
        return this.runAuthorGate(
            pendingParticipant,
            ethers.ZeroHash as Hash,
            this.unanchoredCoordinates()
        );
    }

    /** No local anchor; author is unrelated to the channel. */
    public async probeAuthorGateNoAnchorUnknownAddress(): Promise<string> {
        return this.runAuthorGate(
            this.randomAddress(),
            ethers.ZeroHash as Hash,
            this.unanchoredCoordinates()
        );
    }
    public createRPCMethods(
        transport: NetworkTransport
    ): ValidationProbeRpcMethods {
        return new ValidationProbeRpcMethods(transport, this);
    }
}
