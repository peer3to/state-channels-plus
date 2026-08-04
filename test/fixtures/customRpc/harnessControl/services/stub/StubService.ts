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
import { BlockValidationResult } from "@/types";
import { Block, StateSnapshot } from "@/models";
import Clock from "@/Clock";
import { recordValidationBoundary } from "./RecordingValidationStrategy";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

type DisputeCommittedEventKey = string;
type CalldataPostedEventKey = string;

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
    | "ingestConfirmations";

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

export type EventSyncFailureProbe = {
    samePromise: boolean;
    handlerCallCount: number;
    firstError: string | null;
    secondError: string | null;
    rescheduledError: string | null;
    cursorBefore: number | null;
    cursorAfter: number | null;
    detachedError: string | null;
};

export type ConcurrentCalldataRecoveryProbe = {
    queryCount: number;
    firstFound: boolean;
    secondFound: boolean;
    retryFound: boolean;
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

export type BlockValidationProbeOptions = {
    strategy?: "active" | "dispute";
    encodedDispute?: string;
    /** Supplier of this copy - drives `sourcePeers`/`signatureSources`. */
    senderAddress?: Address;
    /**
     * Drive this one deviation hook on the strategy instead of the whole
     * pipeline. For branches the pipeline can't reach: an unknown-fork entry is
     * never handed to `validateBlockConfirmation` because
     * `BlockQueueManager.scheduleQueueExecution` and `tryExecuteFromQueue` both
     * return early on a non-current fork, so the missing-genesis branch is only
     * reachable by calling the hook.
     */
    invokeHook?: "blockAuthorIsNotParticipant" | "wrongGenesisDetected";
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
    /** Only set by pipeline: "full" - onBlockConfirmation's return value. */
    keepConnection?: boolean;
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
    readonly passedDisputeCommittedEventKeys =
        new Set<DisputeCommittedEventKey>();
    /** Subscribed calldata logs the hold stub has already lost once. */
    readonly heldCalldataPostedEventKeys = new Set<CalldataPostedEventKey>();
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
    /**
     * Serializes `runBlockValidation`'s record-only patch/restore region. The
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

    /** Exercise rejected-log retention through the real EventSyncService. */
    public async probeRejectedEventSyncLog(): Promise<EventSyncFailureProbe> {
        const sm = this.sm;
        const contract = sm.stateChannelManagerContract;
        const provider = contract.runner?.provider;
        if (!provider) throw new Error("Expected a provider for event sync");
        const latestBlock = await provider.getBlock("latest");
        if (!latestBlock?.hash) throw new Error("Expected a latest block");
        const stateSnapshot = await contract.getStateSnapshot(sm.channelId);
        const event = contract.interface.getEvent("StateSnapshotUpdated");
        const encodedEvent = contract.interface.encodeEventLog(event, [
            sm.channelId,
            stateSnapshot
        ]);
        const log = new Log(
            {
                address: String(contract.target),
                blockHash: latestBlock.hash,
                blockNumber: latestBlock.number + 1,
                data: encodedEvent.data,
                index: 0,
                removed: false,
                topics: encodedEvent.topics,
                transactionHash: id(`event-sync-failure-${Date.now()}`),
                transactionIndex: 0
            },
            provider
        );
        const eventHandler = sm.eventHandler;
        const original = eventHandler.onStateSnapshotUpdated.bind(eventHandler);
        let handlerCallCount = 0;
        eventHandler.onStateSnapshotUpdated = async () => {
            handlerCallCount += 1;
            throw new Error("Expected event-sync rejection");
        };
        const cursorBefore =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;
        try {
            const first = sm.eventSyncService.scheduleLog(log, sm.channelId);
            const second = sm.eventSyncService.scheduleLog(log, sm.channelId);
            DetachedPromises.collect(first);
            const [firstError, secondError] = await Promise.all([
                first.then(
                    () => null,
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                ),
                second.then(
                    () => null,
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                )
            ]);
            const detached = await DetachedPromises.collectSettledAndClear();
            const rejected = detached.find(
                (result): result is PromiseRejectedResult =>
                    result.status === "rejected"
            );
            const detachedError = rejected
                ? rejected.reason instanceof Error
                    ? rejected.reason.message
                    : String(rejected.reason)
                : null;

            // A failed log is fatal - rescheduling it returns the cached
            // rejection and never re-enters the handler, even once the handler
            // would succeed.
            eventHandler.onStateSnapshotUpdated = async () => {
                handlerCallCount += 1;
            };
            const rescheduled = sm.eventSyncService.scheduleLog(
                log,
                sm.channelId
            );
            const rescheduledError = await rescheduled.then(
                () => null,
                (error: unknown) =>
                    error instanceof Error ? error.message : String(error)
            );

            return {
                samePromise: first === second,
                handlerCallCount,
                firstError,
                secondError,
                rescheduledError,
                cursorBefore,
                cursorAfter:
                    sm.storage.eventSync.getLatestProcessedBlock(
                        sm.channelId
                    ) ?? null,
                detachedError
            };
        } finally {
            eventHandler.onStateSnapshotUpdated = original;
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
     * from the confirmation, under the live block strategy or a fabricated
     * dispute strategy. Returns the merge result and the persisted signature
     * set for the block's hash.
     */
    public async runStoredBlockMerge(
        encodedBlockConfirmation: string,
        options?: { strategy?: "active" | "dispute" }
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
        const strategy =
            options?.strategy === "dispute"
                ? this.createDisputeValidationStrategy(factory.dispute())
                : sm.blockValidationStrategy;
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
            return await this.runBlockValidationLocked(
                encodedBlockConfirmation,
                options
            );
        } finally {
            this.blockValidationProbeMutex.unlock();
        }
    }

    private async runBlockValidationLocked(
        encodedBlockConfirmation: string,
        options?: BlockValidationProbeOptions
    ): Promise<BlockValidationProbe> {
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

        const disputedForkIds: string[] = [];
        const disconnectedAddresses: string[] = [];
        let restoreQueuedEntryCalled = false;

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
                disputedForkIds.push(String(forkId));
            };
        }
        const p2pManager = this.p2pManager;
        const originalDisconnect =
            p2pManager.disconnectAndBlacklistPeerByEvmAddress.bind(p2pManager);
        p2pManager.disconnectAndBlacklistPeerByEvmAddress = ((
            address: Address
        ) => {
            disconnectedAddresses.push(String(address));
        }) as typeof p2pManager.disconnectAndBlacklistPeerByEvmAddress;
        const originalRestore = sm.blockQueueManager.restoreQueuedEntry.bind(
            sm.blockQueueManager
        );
        sm.blockQueueManager.restoreQueuedEntry = (() => {
            restoreQueuedEntryCalled = true;
        }) as typeof sm.blockQueueManager.restoreQueuedEntry;
        // count-and-forward: recovery must stay real, the count only proves
        // validation reached the on-chain lookup
        let calldataRecoveryQueries = 0;
        const eventSyncService = sm.eventSyncService;
        const originalRecover =
            eventSyncService.tryRecoverBlockCalldataAndScheduleValidation.bind(
                eventSyncService
            );
        eventSyncService.tryRecoverBlockCalldataAndScheduleValidation = ((
            ...args: Parameters<typeof originalRecover>
        ) => {
            calldataRecoveryQueries += 1;
            return originalRecover(...args);
        }) as typeof eventSyncService.tryRecoverBlockCalldataAndScheduleValidation;

        // record which deviation hook the strategy fired, so a test can pin its
        // named guard
        const firedHooks: string[] = [];
        let lastHookResult: BlockValidationResult | undefined;
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
                            firedHooks.push(prop);
                            lastHookResult = resolved as BlockValidationResult;
                        }
                        return resolved;
                    });
            }
        });

        try {
            let keepConnection: boolean | undefined;
            let result: BlockValidationResult;
            if (options?.invokeHook) {
                result = await instrumentedStrategy[options.invokeHook](entry);
            } else if (options?.pipeline === "full") {
                keepConnection =
                    await sm.blockIngestService.onBlockConfirmation(entry, {
                        validationStrategy: instrumentedStrategy
                    });
                result = lastHookResult ?? BlockValidationResult.SUCCESS;
            } else {
                result = await sm.validationService.validateBlockConfirmation(
                    entry,
                    instrumentedStrategy
                );
            }
            const fraudProof =
                sm.storage.fraudProofs.getFraudProofForParticipant(
                    block.signerAddress
                );
            return {
                result,
                keepConnection,
                resultName:
                    BlockValidationResult[result] ?? `UNKNOWN(${result})`,
                strategyName: strategy.name,
                disputedForkIds,
                disconnectedAddresses,
                firedHooks,
                restoreQueuedEntryCalled,
                signerAddress: String(block.signerAddress),
                fraudProofType: fraudProof
                    ? String(fraudProof.proofType)
                    : null,
                sourcePeers: [...entry.sourcePeers].map(String),
                calldataRecoveryQueries
            };
        } finally {
            if (disputeManager && originalDispute) {
                disputeManager.dispute = originalDispute;
            }
            p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                originalDisconnect;
            sm.blockQueueManager.restoreQueuedEntry = originalRestore;
            eventSyncService.tryRecoverBlockCalldataAndScheduleValidation =
                originalRecover;
        }
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
