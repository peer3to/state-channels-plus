import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { Address, ForkId, Hash, Timestamp } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import StubRpcMethods from "./StubRpcMethods";
import { ethers, id, Log } from "ethers";
import type { StateChannelManagerProxy } from "@typechain-types";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import {
    Codec,
    DetachedPromises,
    Mutex,
    tryDecodeCustomError,
    Type
} from "@/utils";
import type { RaceConditionErrorName } from "@/utils/evmErrorHandler";
import * as factory from "@test/factory";
import DisputeValidationStrategy from "@/stateManager/validationStrategy/DisputeValidationStrategy";
import CalldataCommittedStrategy from "@/stateManager/validationStrategy/CalldataCommittedStrategy";
import type AValidationStrategy from "@/stateManager/validationStrategy/AValidationStrategy";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import { BlockValidationResult } from "@/types";
import { Block, StateSnapshot } from "@/models";
import Clock from "@/Clock";
import { recordValidationBoundary } from "./RecordingValidationStrategy";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

type DisputeCommittedEventKey = string;
type CalldataPostedEventKey = string;
type InboundMessageLogKey = string;

/** Fixed identifiers for the stub-original registry (never caller-supplied). */
export type StubKey =
    | "broadcast"
    | "calldataPosting"
    | "pendingInboundInclusion"
    | "selectiveDisconnect"
    | "spectateCreateRpcMethods"
    | "disputeAckCreateRpcMethods"
    | "postStateSnapshot"
    | "unsafeSetLatestState"
    | "blockedInitHandshake"
    | "captureInitHandshake"
    | "initHandshakeCreateRpcMethods"
    | "maybePostBlockOnChain"
    | "spectateAbort"
    | "reductionTasks"
    | "snapshotUpdatedEvents"
    | "inboundMessageEvents"
    | "disputeCommittedEvents"
    | "calldataPostedEvents"
    | "disputeInitiation"
    | "reducedCommitEvents"
    | "reduce"
    | "reductionSimulation"
    | "finalDisputePreparation"
    | "spectateSync"
    | "pausedReduction"
    | "pausedReductionKillPeriod"
    | "constructDisputeStateProof"
    | "constructDisputeEntry"
    | "disputeSubmissions"
    | "disputeFraudProofApplies"
    | "disputeKill"
    | "timeoutCheck"
    | "scheduledTasks"
    | "ingestConfirmations"
    | "onChainSlashesQuery"
    | "localDiamondInboundMessages"
    | "inboundMessageLogs"
    | "chainLogQueries"
    | "disputeWindowTimestamp"
    | "disputeCommittedHandler";

export type ReductionSimulationErrorName =
    | "RaceConditionDisputeAlreadyReduced"
    | "RaceConditionBlockHeightTooOld"
    | "RaceConditionReductionExpectationDoesntMatch";

export type PausedReductionStatus = {
    entered: boolean;
    released: boolean;
    settled: boolean;
    error?: string;
};

export type PausedReductionState = PausedReductionStatus & {
    targetForkId: ForkId;
    inside: boolean;
    release?: () => void;
    promise?: Promise<unknown>;
};

export type RecordedDisputeSubmission = {
    /** Contract method `dispute()` sent. */
    method: string;
    /** Inner call names when `method` is `multicall`, in order. */
    innerMethods: string[];
    /** `encodedDispute` carried by the uploaded dispute confirmation. */
    encodedDispute: string;
    /** Auditing data uploaded alongside the dispute, encoded, or null. */
    encodedAuditingData: string | null;
    /** Participants of the fraud proofs bundled by `applyFraudProofs`. */
    fraudProofParticipants: string[];
    /** `gasLimit` override sent with the transaction, or null. */
    gasLimit: string | null;
    /** Set once `dispute()` awaited the returned transaction. */
    waited: boolean;
};

export type DisputeSubmissionFailureSpec = {
    /** Solidity custom error to revert with (its selector is the revert data). */
    customError?: RaceConditionErrorName;
    /** Failure message when the failure is not a decodable custom error. */
    message?: string;
    /** Whether the failure surfaces from the send or from `tx.wait()`. */
    at: "send" | "wait";
};

export type DisputeSubmissionOriginals = {
    multicall: StateChannelManagerProxy["multicall"];
    uploadDispute: StateChannelManagerProxy["uploadDispute"];
    uploadDisputeWithCalldata: StateChannelManagerProxy["uploadDisputeWithCalldata"];
};

export type DisputeSubmissionHold = {
    gate: Promise<void>;
    release: () => void;
    /** Sends parked at the hold so far. */
    held: number;
};

export type HeldOnChainSlashesQueryState = {
    /** Callers parked at the hold so far. */
    entered: number;
    released: boolean;
    gate: Promise<void>;
    release: () => void;
};

export type RecordedFraudProofApply = {
    /** Participants named by the applied dispute fraud proofs. */
    participants: string[];
    /** Failure message from the send or from `wait()`, or null when it landed. */
    error: string | null;
    /** Custom-error name decoded from that failure, when there was one. */
    customError: string | null;
    /** Set once `killDispute` awaited the returned transaction. */
    waited: boolean;
};

export type PausedConstructDisputeStatus = {
    /** Calls parked at the held boundary so far. */
    entered: number;
    released: boolean;
};

export type PausedConstructDisputeState = PausedConstructDisputeStatus & {
    targetForkId: ForkId;
    /** True only while a `constructDispute` for the target fork is running. */
    inside: boolean;
    gate: Promise<void>;
    release: () => void;
};

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

/** The block range one recorded `provider.getLogs` call asked for. */
export type ChainLogQuerySpan = {
    fromBlock: number | null;
    toBlock: number | null;
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

export type CleanCommittedDivergenceProbe = {
    result: string;
    proofStored: boolean;
};

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
    strategy?: "active" | "dispute";
    encodedDispute?: string;
    /** Supplier of this copy - drives `sourcePeers`/`signatureSources`. */
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
    hook?: "blockAuthorIsNotParticipant" | "wrongGenesisDetected";
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
    signerAddress: string;
    fraudProofType: string | null;
    /** Source attribution the entry carried into validation. */
    sourcePeers: string[];
    /** How many times validation asked EventSyncService to recover calldata. */
    calldataRecoveryQueries: number;
};

export type BlockIngestProbe = BlockValidationProbe & {
    /** onBlockConfirmation's return value. */
    keepConnection: boolean;
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
        calldataRecoveryQueries: number;
        lastHookResult: BlockValidationResult | undefined;
    };
    restore: () => void;
};

/**
 * Method stub/restore for Byzantine and fault-injection scenarios. Each stub is
 * a concrete method (not a free-form path) so an SDK rename breaks compilation
 * here rather than failing silently at runtime. Originals are held per service
 * instance so they survive across RPC method invocations.
 *
 * `p2pManager` is typed as `P2PManager<HarnessControlRpc>`, so `localRpc` (the
 * SDK's own services included) is fully typed. Prefer targeting real members
 * directly; private internals use explicit local structural host types at the
 * stub site.
 */
export class StubService extends ARpcService<
    StubRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    readonly stubOriginals = new Map<StubKey, unknown>();
    /** Set by the record-dispute-ack stub when its method fires. */
    disputeAckRequestCalled = false;
    /** Set by the record-unsafe-set-latest-state stub when it fires. */
    unsafeSetLatestStateCalled = false;
    /** Set by the recording spectate guard when it blocks an RPC. */
    spectateGuardBlocked = false;
    /** Transport captured by the init-handshake capture stub (pre-handshake). */
    capturedInitHandshakeTransport?: ATransport;
    /** Set by the record-spectate-abort stub when `abort` fires. */
    spectateAbortCalled = false;
    /** Incremented by the count-spectate-requests stub per onSpectateRequest. */
    spectateRequestCount = 0;
    /** `reduction-*` timer tasks captured by the hold-reduction-tasks stub. */
    readonly heldReductionTasks: {
        taskName: string;
        task: () => void | Promise<void>;
    }[] = [];
    /** Label + delay of every scheduled task, captured by the record stub. */
    readonly recordedScheduledTasks: {
        taskName: string;
        delayMs: number;
    }[] = [];
    /** Event arg-tuples captured by the hold-event stubs. */
    readonly heldSnapshotUpdatedArgs: unknown[][] = [];
    readonly heldDisputeCommittedArgs: unknown[][] = [];
    readonly heldInboundMessageArgs: unknown[][] = [];
    readonly passedDisputeCommittedEventKeys =
        new Set<DisputeCommittedEventKey>();
    /** Subscribed inbound logs the drop stub has already lost once. */
    readonly droppedInboundMessageLogKeys = new Set<InboundMessageLogKey>();
    /** How many distinct inbound logs may be dropped (undefined = all). */
    inboundMessageLogDropLimit?: number;
    /** Subscribed calldata logs the hold stub has already lost once. */
    readonly heldCalldataPostedEventKeys = new Set<CalldataPostedEventKey>();
    /** getLogs spans recorded by the current chain-log-query patch. */
    private chainLogQuerySpans: ChainLogQuerySpan[] = [];
    /** Dispatches that reached the failing onDisputeCommitted stub. */
    private failedDisputeCommittedCalls = 0;
    /** Resolvers waiting for the first held calldata log. */
    private readonly heldCalldataPostedWaiters: (() => void)[] = [];
    /** Whether the dispute-event hold stub should pass its first new log. */
    passFirstDisputeCommittedEvent = true;
    readonly heldReducedCommitArgs: unknown[][] = [];
    /** Incremented per `ReductionManager.tryReduce` call by the noop/record stubs. */
    reduceCallCount = 0;
    /** Incremented per `spectateService.sync` by the record stub. */
    spectateSyncCallCount = 0;
    /** Addresses `spectateService.sync` was asked to sync from, newest last. */
    readonly spectateSyncTargets: string[] = [];
    /** Resolvers waiting for a given number of `spectateService.sync` calls. */
    private readonly spectateSyncWaiters: {
        target: number;
        resolve: () => void;
    }[] = [];
    /** State for the already-entered old-fork reduction race stub. */
    pausedReduction?: PausedReductionState;
    /** State for the constructDispute state-proof hold. */
    pausedConstructDispute?: PausedConstructDisputeState;
    /** Uploads seen by the record-only dispute-submission probe (newest last). */
    readonly recordedDisputeSubmissions: RecordedDisputeSubmission[] = [];
    /** Gate the dispute-submission probe parks uploads on, when installed. */
    disputeSubmissionHold?: DisputeSubmissionHold;
    /** Failure the dispute-submission probe injects, when installed. */
    disputeSubmissionFailure?: DisputeSubmissionFailureSpec;
    /** Applies seen by the dispute-fraud-proof apply probe (newest last). */
    readonly recordedFraudProofApplies: RecordedFraudProofApply[] = [];
    /** Gate the apply probe parks sends on, when installed. */
    fraudProofApplyHold?: DisputeSubmissionHold;
    /** Failure the apply probe injects, when installed. */
    fraudProofApplyFailure?: DisputeSubmissionFailureSpec;
    /** Incremented per `killDispute` skipped by the suppress-kill stub. */
    suppressedDisputeKillCount = 0;
    /** State for the dispute-audit hold at the on-chain-slashes query. */
    heldOnChainSlashesQuery?: HeldOnChainSlashesQueryState;
    /** Resolvers waiting for the first parked slashes query. */
    private readonly heldOnChainSlashesQueryWaiters: (() => void)[] = [];
    /**
     * Serializes runBlockValidation/runBlockIngest's record-only
     * patch/restore region. The
     * patch replaces shared live methods (dispute, disconnect, restore), so two
     * overlapping probes would restore each other's replacements.
     */
    private readonly blockValidationProbeMutex = new Mutex();

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessStubService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    /**
     * Single owner of dispute-strategy construction for the stub probes, so
     * constructor inputs can't drift between them. `blockIndexInUnfinalized
     * PartOfStateProof` is 0 - the probes replay the first unfinalized block.
     */
    public createDisputeValidationStrategy(
        dispute: DisputeStruct
    ): DisputeValidationStrategy {
        return new DisputeValidationStrategy(
            this.sm.storage,
            dispute,
            0,
            this.sm.diamondStateMachine.localDiamondContract,
            this.sm.logger
        );
    }

    /** Record one `spectateService.sync` call and release anyone waiting on it. */
    public recordSpectateSyncCall(peerAddress: string): void {
        this.spectateSyncCallCount += 1;
        this.spectateSyncTargets.push(peerAddress);
        for (const waiter of this.spectateSyncWaiters.splice(0)) {
            if (this.spectateSyncCallCount >= waiter.target) waiter.resolve();
            else this.spectateSyncWaiters.push(waiter);
        }
    }

    /**
     * Resolve with the recorded targets once `spectateService.sync` has been
     * called `count` times. Signal, not a poll - the record stub releases it.
     */
    public waitForSpectateSyncCalls(count: number): Promise<string[]> {
        if (this.spectateSyncCallCount >= count) {
            return Promise.resolve([...this.spectateSyncTargets]);
        }
        return new Promise((resolve) =>
            this.spectateSyncWaiters.push({
                target: count,
                resolve: () => resolve([...this.spectateSyncTargets])
            })
        );
    }

    public notifyCalldataPostedEventHeld(): void {
        this.heldCalldataPostedWaiters
            .splice(0)
            .forEach((resolve) => resolve());
    }

    public waitForHeldCalldataPostedEvent(): Promise<boolean> {
        if (this.heldCalldataPostedEventKeys.size > 0) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) =>
            this.heldCalldataPostedWaiters.push(() => resolve(true))
        );
    }

    /** Hold subscribed calldata logs before the scheduler records their key. */
    public holdCalldataPostedEvents(): void {
        const eventSyncService = this.sm.eventSyncService;
        if (!this.stubOriginals.has("calldataPostedEvents")) {
            this.stubOriginals.set(
                "calldataPostedEvents",
                eventSyncService.scheduleLog.bind(eventSyncService)
            );
        }
        const original = this.stubOriginals.get(
            "calldataPostedEvents"
        ) as typeof eventSyncService.scheduleLog;
        eventSyncService.scheduleLog = async (...args) => {
            const parsed =
                this.sm.stateChannelManagerContract.interface.parseLog({
                    topics: args[0].topics,
                    data: args[0].data
                });
            if (parsed?.name === "BlockCalldataPosted") {
                const eventKey = `${args[0].transactionHash}:${args[0].index}`;
                if (!this.heldCalldataPostedEventKeys.has(eventKey)) {
                    // Lose the subscribed delivery once. A later explicit
                    // query of the same log must reach the real scheduler so
                    // this stub accurately models missed subscription data.
                    this.heldCalldataPostedEventKeys.add(eventKey);
                    this.notifyCalldataPostedEventHeld();
                    return;
                }
            }
            return original(...args);
        };
    }

    public restoreCalldataPostedEvents(): boolean {
        const eventSyncService = this.sm.eventSyncService;
        const original = this.stubOriginals.get("calldataPostedEvents");
        if (original === undefined) return false;
        eventSyncService.scheduleLog =
            original as typeof eventSyncService.scheduleLog;
        this.stubOriginals.delete("calldataPostedEvents");
        this.heldCalldataPostedEventKeys.clear();
        return true;
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
     * Park `localDiamondContract.getOnChainSlashedParticipants` callers until
     * released - the dispute audit's first await after it captured auditing
     * data, so a test can mutate real state mid-audit deterministically. Both
     * live call sites invoke the method plainly, so a plain async replacement
     * is faithful.
     */
    public installOnChainSlashesQueryHold(): void {
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;
        if (!this.stubOriginals.has("onChainSlashesQuery")) {
            this.stubOriginals.set(
                "onChainSlashesQuery",
                localDiamond.getOnChainSlashedParticipants
            );
        }
        const original = this.stubOriginals.get(
            "onChainSlashesQuery"
        ) as typeof localDiamond.getOnChainSlashedParticipants;
        let releaseGate!: () => void;
        const gate = new Promise<void>((resolve) => {
            releaseGate = resolve;
        });
        const held: HeldOnChainSlashesQueryState = {
            entered: 0,
            released: false,
            gate,
            release: () => {
                held.released = true;
                releaseGate();
            }
        };
        this.heldOnChainSlashesQuery = held;
        localDiamond.getOnChainSlashedParticipants = (async (
            ...args: Parameters<typeof original>
        ) => {
            held.entered += 1;
            this.heldOnChainSlashesQueryWaiters
                .splice(0)
                .forEach((resolve) => resolve());
            await gate;
            return original(...args);
        }) as typeof localDiamond.getOnChainSlashedParticipants;
    }

    /** Release parked callers and reinstall the real query. */
    public releaseOnChainSlashesQueryHold(): boolean {
        this.heldOnChainSlashesQuery?.release();
        this.heldOnChainSlashesQuery = undefined;
        const original = this.stubOriginals.get("onChainSlashesQuery");
        if (original === undefined) return false;
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;
        localDiamond.getOnChainSlashedParticipants =
            original as typeof localDiamond.getOnChainSlashedParticipants;
        this.stubOriginals.delete("onChainSlashesQuery");
        return true;
    }

    /** Resolve with the parked-caller count once at least one is held. */
    public waitForHeldOnChainSlashesQuery(): Promise<number> {
        const held = this.heldOnChainSlashesQuery;
        if (!held) {
            return Promise.reject(
                new Error("onChainSlashesQuery hold not installed")
            );
        }
        if (held.entered > 0) return Promise.resolve(held.entered);
        return new Promise((resolve) =>
            this.heldOnChainSlashesQueryWaiters.push(() =>
                resolve(held.entered)
            )
        );
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

    get chainProvider() {
        const provider = this.sm.stateChannelManagerContract.runner?.provider;
        if (!provider) throw new Error("Expected a chain provider");
        return provider;
    }

    /** Spans of the getLogs calls seen since the current patch went in. */
    get chainLogQueries(): readonly ChainLogQuerySpan[] {
        return this.chainLogQuerySpans;
    }

    /** Make every provider getLogs throw -> no recovery query can succeed. */
    failChainLogQueries(): void {
        this.patchChainLogQueries(true);
    }

    /** Record every provider getLogs span and forward it. */
    countChainLogQueries(): void {
        this.patchChainLogQueries(false);
    }

    restoreChainLogQueries(): boolean {
        const original = this.stubOriginals.get("chainLogQueries");
        if (original === undefined) return false;
        this.chainProvider.getLogs =
            original as typeof this.chainProvider.getLogs;
        this.stubOriginals.delete("chainLogQueries");
        return true;
    }

    /**
     * Record every provider getLogs span; with `fail` each call throws too.
     * One such patch is active at a time - installing a second one resets the
     * recorded spans.
     */
    private patchChainLogQueries(fail: boolean): void {
        const provider = this.chainProvider;
        if (!this.stubOriginals.has("chainLogQueries")) {
            this.stubOriginals.set(
                "chainLogQueries",
                provider.getLogs.bind(provider)
            );
        }
        const original = this.stubOriginals.get(
            "chainLogQueries"
        ) as typeof provider.getLogs;
        this.chainLogQuerySpans = [];
        provider.getLogs = (async (filter) => {
            this.chainLogQuerySpans.push({
                fromBlock:
                    "fromBlock" in filter ? Number(filter.fromBlock) : null,
                toBlock: "toBlock" in filter ? Number(filter.toBlock) : null
            });
            if (fail) throw new Error("stubbed getLogs failure");
            return original(filter);
        }) as typeof provider.getLogs;
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

        if (options?.failChainQueries) this.failChainLogQueries();
        else this.countChainLogQueries();
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
                ...this.describeChainLogQueries(),
                cursorAtCall,
                scheduledLogCount,
                blockCount: run ? run.length : null,
                heldBefore,
                heldAfter: held(),
                threw: null
            };
        } catch (error) {
            return {
                ...this.describeChainLogQueries(),
                cursorAtCall,
                scheduledLogCount,
                blockCount: null,
                heldBefore,
                heldAfter: held(),
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            eventSyncService.scheduleLog = originalScheduleLog;
            this.restoreChainLogQueries();
        }
    }

    /** The recorded getLogs spans as a probe reports them. */
    private describeChainLogQueries() {
        const spans = this.chainLogQueries;
        return {
            queryCount: spans.length,
            queriedFromBlocks: spans.map((span) => span.fromBlock),
            toBlock: spans.length ? spans[spans.length - 1].toBlock : null
        };
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

        this.holdCalldataPostedEvents();
        if (options?.failChainQueries) this.failChainLogQueries();
        else this.countChainLogQueries();

        try {
            await this.postBlockCalldataOnChain(
                Codec.encode(block.signedBlock, Type.SignedBlock) as string
            );
            // premise - the subscribed delivery really was lost
            await this.waitForHeldCalldataPostedEvent();
            const recovery =
                await sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    forkId,
                    block.height,
                    block.author
                );
            return {
                recoveredCalldata: recovery.blockCalldata !== undefined,
                validationScheduled: recovery.validationScheduled,
                queryCount: this.chainLogQueries.length,
                threw: null
            };
        } catch (error) {
            return {
                recoveredCalldata: false,
                validationScheduled: false,
                queryCount: this.chainLogQueries.length,
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            this.restoreChainLogQueries();
            this.restoreCalldataPostedEvents();
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

    get failedDisputeCommittedHandlerCalls(): number {
        return this.failedDisputeCommittedCalls;
    }

    /**
     * Make `onDisputeCommitted` throw, counting the dispatches that reached
     * it - a re-dispatched dispute log that fails again.
     */
    failDisputeCommittedHandler(): void {
        const eventHandler = this.sm.eventHandler;
        if (!this.stubOriginals.has("disputeCommittedHandler")) {
            this.stubOriginals.set(
                "disputeCommittedHandler",
                eventHandler.onDisputeCommitted.bind(eventHandler)
            );
        }
        this.failedDisputeCommittedCalls = 0;
        eventHandler.onDisputeCommitted = async () => {
            this.failedDisputeCommittedCalls += 1;
            throw new Error("stubbed onDisputeCommitted failure");
        };
    }

    restoreDisputeCommittedHandler(): boolean {
        const original = this.stubOriginals.get("disputeCommittedHandler");
        if (original === undefined) return false;
        this.sm.eventHandler.onDisputeCommitted =
            original as typeof this.sm.eventHandler.onDisputeCommitted;
        this.stubOriginals.delete("disputeCommittedHandler");
        return true;
    }

    /** Make the dispute-window creation timestamp read throw. */
    failDisputeWindowTimestampRead(): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("disputeWindowTimestamp")) {
            this.stubOriginals.set(
                "disputeWindowTimestamp",
                contract.getDisputeWindowCreationTimestamp
            );
        }
        contract.getDisputeWindowCreationTimestamp =
            this.asRecordingContractMethod(
                contract.getDisputeWindowCreationTimestamp,
                async () => {
                    throw new Error(
                        "stubbed getDisputeWindowCreationTimestamp failure"
                    );
                }
            );
    }

    restoreDisputeWindowTimestampRead(): boolean {
        const original = this.stubOriginals.get("disputeWindowTimestamp");
        if (original === undefined) return false;
        this.sm.stateChannelManagerContract.getDisputeWindowCreationTimestamp =
            original as StateChannelManagerProxy["getDisputeWindowCreationTimestamp"];
        this.stubOriginals.delete("disputeWindowTimestamp");
        return true;
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
        contract.challengeDisputeReduction = this.asRecordingContractMethod(
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

    public async probeCleanCommittedDivergence(): Promise<CleanCommittedDivergenceProbe> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const latestBlock = this.sm.storage.blocks.getLatestBlock(
            this.sm.forkId
        );
        if (!latestBlock) throw new Error("Expected a latest block");
        const strategy = this.createDisputeValidationStrategy(dispute);
        const result = await strategy.blockIsNotLinkedAndIsNotFirstBlock(
            this.sm.storage.queues.createEntry(latestBlock)
        );
        return {
            result: BlockValidationResult[result],
            proofStored:
                this.sm.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                ) !== undefined
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
        const strategy = this.createDisputeValidationStrategy(dispute);
        const entry = this.sm.storage.queues.createEntry(block);
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
     * Record-only probe over the three dispute-upload entry points. A real
     * upload posts an on-chain dispute against the live fork, which derails the
     * session, so the probe records the send and hands `dispute()` a stand-in
     * transaction; the real uploads keep their coverage on the e2e paths.
     * `holdSubmissions` parks every recorded send until released, so a second
     * caller can be observed queueing behind the dispute mutex. `failure` makes
     * the send (or its `wait()`) fail - a custom error reverts with the real
     * 4-byte selector, exactly what the SDK's decoder reads off a real revert.
     */
    public installDisputeSubmissionRecorder(
        holdSubmissions: boolean,
        failure?: DisputeSubmissionFailureSpec
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("disputeSubmissions")) {
            this.stubOriginals.set("disputeSubmissions", {
                multicall: contract.multicall,
                uploadDispute: contract.uploadDispute,
                uploadDisputeWithCalldata: contract.uploadDisputeWithCalldata
            } satisfies DisputeSubmissionOriginals);
        }
        this.recordedDisputeSubmissions.length = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.disputeSubmissionHold = holdSubmissions
            ? { gate, release, held: 0 }
            : undefined;
        this.disputeSubmissionFailure = failure;

        const record = async (
            submission: Omit<RecordedDisputeSubmission, "waited">
        ) => {
            const entry: RecordedDisputeSubmission = {
                ...submission,
                waited: false
            };
            this.recordedDisputeSubmissions.push(entry);
            const hold = this.disputeSubmissionHold;
            if (hold) {
                hold.held += 1;
                await hold.gate;
            }
            if (failure?.at === "send") throw this.submissionFailure(failure);
            return {
                // a tx that reverts also reverts the preflight `call` that
                // tryHandleEvmError retries through
                provider:
                    failure?.at === "wait"
                        ? {
                              call: async () => {
                                  throw this.submissionFailure(failure);
                              }
                          }
                        : undefined,
                wait: async () => {
                    if (failure?.at === "wait") {
                        throw this.submissionFailure(failure);
                    }
                    entry.waited = true;
                    return null;
                }
            };
        };

        contract.uploadDispute = this.asRecordingContractMethod(
            contract.uploadDispute,
            (confirmation: DisputeConfirmationStruct, overrides?: unknown) =>
                record({
                    method: "uploadDispute",
                    innerMethods: [],
                    encodedDispute: String(
                        confirmation.signedDispute.encodedDispute
                    ),
                    encodedAuditingData: null,
                    fraudProofParticipants: [],
                    gasLimit: this.overrideGasLimit(overrides)
                })
        );

        contract.uploadDisputeWithCalldata = this.asRecordingContractMethod(
            contract.uploadDisputeWithCalldata,
            (
                confirmation: DisputeConfirmationStruct,
                auditingData: DisputeAuditingDataStruct
            ) =>
                record({
                    method: "uploadDisputeWithCalldata",
                    innerMethods: [],
                    encodedDispute: String(
                        confirmation.signedDispute.encodedDispute
                    ),
                    encodedAuditingData: Codec.encode(
                        auditingData,
                        Type.DisputeAuditingData
                    ) as string,
                    fraudProofParticipants: [],
                    gasLimit: null
                })
        );

        contract.multicall = this.asRecordingContractMethod(
            contract.multicall,
            (calls: string[], overrides?: unknown) =>
                record({
                    ...this.describeMulticall(calls),
                    method: "multicall",
                    gasLimit: this.overrideGasLimit(overrides)
                })
        );
    }

    /**
     * A stand-in that records the send but keeps the original method's helpers
     * (`populateTransaction`, `staticCall`, …) - the multicall branch builds its
     * legs through `populateTransaction` on these very methods.
     */
    private asRecordingContractMethod<T extends object>(
        original: T,
        recorder: (...args: never[]) => unknown
    ): T {
        Object.defineProperties(
            recorder,
            Object.getOwnPropertyDescriptors(original)
        );
        return recorder as unknown as T;
    }

    /** Decode a dispute multicall's legs into the fields a test asserts on. */
    private describeMulticall(
        calls: string[]
    ): Omit<RecordedDisputeSubmission, "waited" | "method" | "gasLimit"> {
        const contract = this.sm.stateChannelManagerContract;
        const innerMethods: string[] = [];
        let encodedDispute = "";
        let encodedAuditingData: string | null = null;
        const fraudProofParticipants: string[] = [];
        for (const data of calls) {
            const parsed = contract.interface.parseTransaction({ data });
            if (!parsed) throw new Error("Undecodable dispute multicall leg");
            innerMethods.push(parsed.name);
            if (parsed.name === "applyFraudProofs") {
                for (const proof of parsed.args[0]) {
                    fraudProofParticipants.push(String(proof.participant));
                }
            } else {
                encodedDispute = String(parsed.args[0].signedDispute[0]);
                if (parsed.name === "uploadDisputeWithCalldata") {
                    encodedAuditingData = Codec.encode(
                        parsed.args[1],
                        Type.DisputeAuditingData
                    ) as string;
                }
            }
        }
        return {
            innerMethods,
            encodedDispute,
            encodedAuditingData,
            fraudProofParticipants
        };
    }

    private submissionFailure(failure: DisputeSubmissionFailureSpec): unknown {
        if (failure.customError) {
            return { data: id(`${failure.customError}()`).slice(0, 10) };
        }
        return new Error(failure.message ?? "dispute upload failed");
    }

    private overrideGasLimit(overrides: unknown): string | null {
        const gasLimit = (overrides as { gasLimit?: bigint } | undefined)
            ?.gasLimit;
        return gasLimit === undefined ? null : String(gasLimit);
    }

    public restoreDisputeSubmissions(): boolean {
        this.disputeSubmissionHold?.release();
        this.disputeSubmissionHold = undefined;
        this.disputeSubmissionFailure = undefined;
        const originals = this.stubOriginals.get("disputeSubmissions") as
            | DisputeSubmissionOriginals
            | undefined;
        if (originals === undefined) return false;
        const contract = this.sm.stateChannelManagerContract;
        contract.multicall = originals.multicall;
        contract.uploadDispute = originals.uploadDispute;
        contract.uploadDisputeWithCalldata =
            originals.uploadDisputeWithCalldata;
        this.stubOriginals.delete("disputeSubmissions");
        return true;
    }

    /**
     * Record every `applyDisputeFraudProofs` send and how it settled, still
     * running the real transaction. `holdApplies` parks each send until
     * released, so several kills can be staged inside one live kill window;
     * `failure` reverts the send (or its `wait()`) instead of sending it.
     */
    public installDisputeFraudProofApplyRecorder(
        holdApplies: boolean,
        failure?: DisputeSubmissionFailureSpec
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("disputeFraudProofApplies")) {
            this.stubOriginals.set(
                "disputeFraudProofApplies",
                contract.applyDisputeFraudProofs.bind(contract)
            );
        }
        const original = this.stubOriginals.get(
            "disputeFraudProofApplies"
        ) as typeof contract.applyDisputeFraudProofs;
        this.recordedFraudProofApplies.length = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.fraudProofApplyHold = holdApplies
            ? { gate, release, held: 0 }
            : undefined;
        this.fraudProofApplyFailure = failure;

        contract.applyDisputeFraudProofs = (async (
            proofs: DisputeFraudProofStruct[]
        ) => {
            const entry: RecordedFraudProofApply = {
                participants: proofs.map((proof) => String(proof.participant)),
                error: null,
                customError: null,
                waited: false
            };
            this.recordedFraudProofApplies.push(entry);
            const hold = this.fraudProofApplyHold;
            if (hold) {
                hold.held += 1;
                await hold.gate;
            }
            const fail = (error: unknown) => {
                entry.error =
                    error instanceof Error ? error.message : String(error);
                entry.customError = tryDecodeCustomError(error)?.name ?? null;
            };
            // an injected failure replaces the send entirely - forwarding it
            // would leave a landed transaction behind a "failed" apply
            if (failure) {
                const reject = () => {
                    const error = this.submissionFailure(failure);
                    fail(error);
                    throw error;
                };
                if (failure.at === "send") reject();
                return {
                    // a tx that reverts also reverts the preflight `call` that
                    // tryHandleEvmError retries through
                    provider: { call: async () => reject() },
                    wait: async () => reject()
                };
            }
            let tx;
            try {
                tx = await original(proofs);
            } catch (error) {
                fail(error);
                throw error;
            }
            const originalWait = tx.wait.bind(tx);
            tx.wait = (async (...args: Parameters<typeof originalWait>) => {
                try {
                    const receipt = await originalWait(...args);
                    entry.waited = true;
                    return receipt;
                } catch (error) {
                    fail(error);
                    throw error;
                }
            }) as typeof tx.wait;
            return tx;
        }) as typeof contract.applyDisputeFraudProofs;
    }

    public restoreDisputeFraudProofApplies(): boolean {
        this.fraudProofApplyHold?.release();
        this.fraudProofApplyHold = undefined;
        this.fraudProofApplyFailure = undefined;
        const original = this.stubOriginals.get("disputeFraudProofApplies");
        if (original === undefined) return false;
        const contract = this.sm.stateChannelManagerContract;
        contract.applyDisputeFraudProofs =
            original as typeof contract.applyDisputeFraudProofs;
        this.stubOriginals.delete("disputeFraudProofApplies");
        return true;
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
        const entry = sm.storage.queues.createEntry(block);
        let strategy: AValidationStrategy;
        switch (options?.strategy) {
            case "dispute":
                strategy = this.createDisputeValidationStrategy(
                    factory.dispute()
                );
                break;
            case "spectating":
                strategy = sm.spectatingValidationStrategy;
                break;
            case "calldata":
                // built as EventHandler builds it for a CalldataPosted event
                strategy = new CalldataCommittedStrategy(
                    sm.disputeManager,
                    sm.blockValidationStrategy
                );
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
                const result = options?.hook
                    ? await run.instrumentedStrategy[options.hook](run.entry)
                    : await this.sm.validationService.validateBlockConfirmation(
                          run.entry,
                          run.instrumentedStrategy
                      );
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
                const keepConnection =
                    await this.sm.blockIngestService.onBlockConfirmation(
                        run.entry,
                        { validationStrategy: run.instrumentedStrategy }
                    );
                const result =
                    run.recorded.lastHookResult ??
                    BlockValidationResult.SUCCESS;
                return {
                    ...this.buildValidationProbe(run, result),
                    keepConnection
                };
            } finally {
                run.restore();
            }
        } finally {
            this.blockValidationProbeMutex.unlock();
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
        // same entry the gossip pipeline builds: a supplied copy carries its
        // sender into sourcePeers/signatureSources, a sourceless one doesn't
        const entry = sm.storage.queues.createEntry(block, {
            senderAddress: options?.senderAddress
        });
        // default: the live block strategy (PARTICIPATING). "dispute" builds a
        // real DisputeValidationStrategy - as dispute auditing does - so the
        // dispute-only branches (skip future/disputed gates, setState, the
        // isLinked !prevBlock edge) are drivable here. the dispute struct is
        // only referenced when a deviation stores fraud-proof evidence; the
        // paths driven here don't, so a placeholder dispute is faithful.
        const strategy =
            options?.strategy === "dispute"
                ? this.createDisputeValidationStrategy(
                      options.encodedDispute
                          ? Codec.decode(options.encodedDispute, Type.Dispute)
                          : factory.dispute()
                  )
                : sm.getActiveValidationStrategy();

        const recorded: RecordedValidationRun["recorded"] = {
            disputedForkIds: [],
            disconnectedAddresses: [],
            firedHooks: [],
            restoreQueuedEntryCalled: false,
            calldataRecoveryQueries: 0,
            lastHookResult: undefined
        };

        // record-only: a real dispute posts on-chain against the crafted block,
        // a real disconnect cuts a live transport, a real restore re-arms a
        // queue timeout -> all would derail the session. Fraud-proof creation
        // stays real so the hook is identifiable by the persisted proof type.
        const disputeManager = (
            strategy as unknown as {
                disputeManager?: {
                    dispute: (forkId: ForkId) => Promise<void>;
                };
            }
        ).disputeManager;
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
        sm.blockQueueManager.restoreQueuedEntry = (() => {
            recorded.restoreQueuedEntryCalled = true;
        }) as typeof sm.blockQueueManager.restoreQueuedEntry;
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
                if (disputeManager && originalDispute) {
                    disputeManager.dispute = originalDispute;
                }
                p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                    originalDisconnect;
                sm.blockQueueManager.restoreQueuedEntry = originalRestore;
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
            signerAddress: String(run.block.signerAddress),
            fraudProofType: fraudProof ? String(fraudProof.proofType) : null,
            sourcePeers: [...run.entry.sourcePeers].map(String),
            calldataRecoveryQueries: run.recorded.calldataRecoveryQueries
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
        await this.sm.validationService.validateBlockConfirmation(
            this.sm.storage.queues.createEntry(block),
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

    public createRPCMethods(transport: ATransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;
