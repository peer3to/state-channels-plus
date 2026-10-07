// @spec-test-coverage-ignore: RPC fixture support exercised by owning E2E declarations.
import { EvidenceComparisonRecorder } from "./node/EvidenceComparisonRecorder";
import StubRpcMethods from "./StubRpcMethods";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import Clock from "@/Clock";
import type DisputeManager from "@/disputeManager/DisputeManager";
import type P2PManager from "@/P2PManager";
import type PeerProfile from "@/PeerProfile";
import type { BannablePeerInfo } from "@/PeerProfile";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type LobbyMatchingRpcMethods from "@/rpc/network/services/lobbyMatching/LobbyMatchingRpcMethods";
import type { LobbyMatch } from "@/rpc/network/services/lobbyMatching/LobbyMatchingTypes";
import type OpenChannelNegotiationRpcMethods from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods";
import type {
    MatchedNegotiationOptions,
    NegotiationOutcome
} from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService";
import type SpectateService from "@/rpc/network/services/spectate/SpectateService";
import { deserializeRpcFrame } from "@/rpc/Rpc";
import { BlockOrigin } from "@/storage/QueueStorage";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import {
    Codec,
    LocalDiscoveryServer,
    sleep,
    tryDecodeCustomError,
    Type
} from "@/utils";
import type { RaceConditionErrorName } from "@/utils/evmErrorHandler";
import type { TimeoutManager } from "@/utils/TimeoutManager";
import * as factory from "@test/factory";
import type { StateChannelManagerInterface } from "@typechain-types";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import {
    type ContractTransactionResponse,
    hexlify,
    resolveAddress,
    type TransactionRequest
} from "ethers";
import { AsyncLocalStorage } from "node:async_hooks";
import { WebSocketServer } from "ws";

// `NetworkTransport` is used both for `createRPCMethods` and the captured transport.

export type BlockWorkHoldPoint =
    | "queueDequeue"
    | "authoring"
    | "commit"
    | "signature"
    | "confirmation"
    | "confirmationValidation"
    | "proofConfirmationValidation"
    | "storedMerge"
    | "stateApplicationInspection";

export type SignatureBlockMatch = {
    forkId: ForkId;
    participant: Address;
    transactionSelector: string;
};

type DisputeCommittedEventKey = string;
type CalldataPostedEventKey = string;
type InboundMessageLogKey = string;

/** Fixed identifiers for the stub-original registry (never caller-supplied). */
export type StubKey =
    | "proofWalkHold"
    | "auditingDataBuild"
    | "disputeKillMulticall"
    | "discoveryJoinHold"
    | "auditingDataRebuild"
    | "snapshotPostSend"
    | "adoptionPostFailure"
    | "expiredCalldataPost"
    | "broadcast"
    | "calldataPosting"
    | "undecodableUnfinalizedBlock"
    | "invalidBlockStructurePredicate"
    | "pendingInboundInclusion"
    | "selectiveDisconnect"
    | "spectateCreateRpcMethods"
    | "heldSpectateCreateRpcMethods"
    | "joinSignatureCreateRpcMethods"
    | "disputeAckCreateRpcMethods"
    | "postStateSnapshot"
    | "postStateSnapshotWait"
    | "unsafeSetLatestState"
    | "blockedInitHandshake"
    | "captureInitHandshake"
    | "initHandshakeCreateRpcMethods"
    | "maybePostBlockOnChain"
    | "stateManagerAbort"
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
    | "spectateExactRecoverySync"
    | "pausedReduction"
    | "pausedReductionKillPeriod"
    | "constructDisputeStateProof"
    | "constructDisputeEntry"
    | "disputeSubmissions"
    | "disputeFraudProofApplies"
    | "replayGasEstimates"
    | "replayGasReads"
    | "disputeKill"
    | "timeoutCheck"
    | "scheduledTasks"
    | "reductionApplication"
    | "reductionApplicationSetState"
    | "reductionApplicationGetParticipants"
    | "reductionApplicationGetNextToWrite"
    | "reductionAttempt"
    | "reductionCompute"
    | "reductionDisputes"
    | "reductionAdmission"
    | "reductionObservedAttempt"
    | "reductionSubmitGasLimit"
    | "reductionSubmitMulticall"
    | "denyTurn"
    | "ingestConfirmations"
    | "networkConfirmations"
    | "spectateSyncApplication"
    | "onChainSlashesQuery"
    | "localDiamondInboundMessages"
    | "eventLogs"
    | "chainLogQueries"
    | "onChainSlashesRead"
    | "disputeWindowTimestamp"
    | "disputeCommittedHandler"
    | "lobbyCreateRpcMethods"
    | "negotiationCreateRpcMethods"
    | "matchedNegotiation"
    | "failMatchedNegotiation"
    | "setChannelId"
    | "postMatchTargetRefresh"
    | "membershipJoinReceipt"
    | "membershipTopUpReceipt"
    | "countInitHandshake"
    | "lobbyRoleDuration"
    | "handshakeRequestSkew"
    | "dropHandshakeAcks"
    | "openingSubmission";

export type HeldLobbyReplyKind = "pick" | "commit";
export type HeldNegotiationReplyKind = "exchangeTerms" | "openProposal";
export type HeldMembershipReceiptKind = "joinChannel" | "topUpBalance";

/**
 * Where the reduction genesis application is paused (`hold`) or made to fail
 * (`reject`). Only the two reads after the canonical `setState` can reject.
 */
export type ReductionApplicationControl =
    | {
          outcome: "hold";
          at: "setState" | "getParticipants" | "getNextToWrite";
      }
    | { outcome: "reject"; at: "getParticipants" | "getNextToWrite" };

/** Which stage of a reduction attempt the attempt hold pauses. */
/**
 * Where a reduction attempt pauses: before any executor work, at the synced
 * dispute read, at candidate computation, or at the submission's gas-limit
 * read (after the local install, before the chain write).
 */
export type ReductionAttemptHoldPoint =
    | "attempt"
    | "admission"
    | "disputes"
    | "compute"
    | "submit";
/**
 * What the paused call does once released: continue with the real call,
 * return `undefined` (the executor's "data unavailable" branch), or throw
 * (a fatal attempt error).
 */
export type ReductionAttemptResume = "original" | "undefined" | "throw";
export const REDUCTION_ATTEMPT_STUB_FAILURE =
    "Stubbed reduction attempt failure";

/** One pausable host call: counts entries and releases them together. */
export type StubGate = {
    entered: number;
    gate: Promise<void>;
    release: () => void;
};

/** Settled projection of a detached host call started by a stub. */
export type DetachedCallOutcome = {
    settled: boolean;
    /** `reducedForkId` for tryReduce, `installed` as a string for completeWithGenesis. */
    result: string | null;
    rejected: string | null;
};

type HeldRpcReply = {
    kind:
        | HeldLobbyReplyKind
        | HeldNegotiationReplyKind
        | "spectate"
        | "timeoutBuild";
    entered: number;
    gate: Promise<void>;
    release: () => void;
};

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
    /** Custom error a forwarded send or its `wait()` reverted with, or null. */
    revert: RecordedRevert | null;
};

/** A decoded custom-error revert: its name and its arguments as strings. */
export type RecordedRevert = { name: string; args: string[] };

function recordedRevert(error: unknown): RecordedRevert | null {
    const decoded = tryDecodeCustomError(error);
    return (
        decoded && {
            name: decoded.name,
            args: decoded.errorDescription.args.map(String)
        }
    );
}

/**
 * The error that carries the revert data of a failed `wait()`. A mined revert
 * carries none: replay the same call on the state it was mined on.
 */
async function withRevertData(
    tx: ContractTransactionResponse,
    error: unknown
): Promise<unknown> {
    if (tryDecodeCustomError(error)) return error;
    const blockNumber = (error as { receipt?: { blockNumber?: number } })
        .receipt?.blockNumber;
    if (!blockNumber) return error;
    try {
        await tx.provider.call({
            from: tx.from,
            to: tx.to,
            data: tx.data,
            value: tx.value,
            blockTag: blockNumber - 1
        });
    } catch (replayError) {
        return replayError;
    }
    return error;
}

export type DisputeSubmissionFailureSpec = {
    /** Solidity custom error to revert with (its selector is the revert data). */
    customError?: RaceConditionErrorName;
    customErrorArgs?: factory.CustomErrorArg[];
    /** Fail only this many submissions; later submissions follow `forward`. */
    times?: number;
    /** Failure message when the failure is not a decodable custom error. */
    message?: string;
    /** Whether the failure surfaces from the send or from `tx.wait()`. */
    at: "send" | "wait";
};

export type DisputeSubmissionOriginals = {
    multicall: StateChannelManagerInterface["multicall"];
    uploadDispute: StateChannelManagerInterface["uploadDispute"];
    uploadDisputeWithCalldata: StateChannelManagerInterface["uploadDisputeWithCalldata"];
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
    /** `gasLimit` override sent with the transaction, or null. */
    gasLimit: string | null;
    /** Failure message from the send or from `wait()`, or null when it landed. */
    error: string | null;
    /**
     * Custom-error name decoded from that failure, when there was one; for a
     * mined revert, from the replay of the same call.
     */
    customError: string | null;
    /** Set once `killDispute` awaited the returned transaction. */
    waited: boolean;
};

/** Manager methods whose sends carry a fraud-proof replay. */
export type ReplayGasEstimateMethod = "multicall" | "applyDisputeFraudProofs";

/** One chain-signer estimate taken by the replay-gas estimate probe. */
export type RecordedGasEstimate = {
    /** Manager method the estimated transaction calls. */
    method: ReplayGasEstimateMethod;
    /** The signer's real estimate (its headroom included), decimal. */
    estimate: string;
    /** What the probe answered the caller, decimal. */
    answer: string;
};

/** One `getStateTransitionReplayGas` read seen by the read probe. */
export type RecordedReplayGasRead = {
    outcome: "pending" | "resolved" | "rejected";
    /** The manager's answer, decimal, once resolved. */
    replayGas: string | null;
};

/** Message of the internal error `failBlockReplayAt` throws. */
export const BLOCK_REPLAY_FAULT_MESSAGE = "stubbed block replay failure";

/** Message of the read failure the replay-gas read probe injects. */
export const REPLAY_GAS_READ_STUB_FAILURE =
    "stubbed getStateTransitionReplayGas failure";

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

/** The block range one recorded `provider.getLogs` call asked for. */
export type ChainLogQuerySpan = {
    fromBlock: number | null;
    toBlock: number | null;
};

/** One recorded double-signature handler log entry. */
export type DoubleSignatureLogEntry = {
    level: "debug" | "warn" | "error";
    message: string;
    metadata: Record<string, string>;
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
export class StubService extends ANetworkRpcService<
    StubRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    private nextSignatureHold?: HeldRpcReply;
    private restoreNextSignature?: () => void;
    private syncReductionHold?: HeldRpcReply;
    private restoreSyncReduction?: () => void;
    private restoreFinalityReads?: () => void;
    private restoreSyncRejections?: () => void;
    /** Reasons passed to the real sync rejection handler. */
    private syncRejectionReasons: string[] = [];
    /** Number of finality predicates in each recorded provider call. */
    private finalityReadWidths: number[] = [];
    private chainMembershipReadCount = 0;
    private restoreChainMembership?: () => void;
    private syncWindowHold?: HeldRpcReply;
    private restoreSyncWindow?: () => void;
    private restoreSyncReductionRecorder?: () => void;
    private syncReductionWindows: {
        suppliedForks: ForkId[];
        reductionForks: ForkId[];
    }[] = [];
    private blockWorkRelease?: () => void;
    private blockWorkRestore?: () => void;
    // Double-signature handler log entries recorded while forwarding them.
    private doubleSignatureLogObservation?: {
        entries: DoubleSignatureLogEntry[];
        restore: () => void;
    };
    // Restores the real blacklist write after an injected failure.
    private restoreBlacklistWrite?: () => void;
    private disputeParticipationObservation?: {
        attempts: number;
        warnings: number;
        restore: () => void;
    };
    private admissionObservation?: {
        completedIntakes: number;
        completedSyncs: number;
        successfulSyncs: number;
        networkEntries: number;
        proofEntries: number;
        proofSources: number;
        chainReads: number;
        localMembershipReads: number;
        syncRequests: number;
        broadcasts: number;
        holdGossip: boolean;
        heldGossip: (() => void)[];
        releaseMembership: () => void;
        restore: () => void;
    };

    public blockWorkEntered = 0;
    private leaveWatchdogRestore?: () => void;
    public leaveWatchdogObservation = {
        delayMs: 0,
        scheduled: 0,
        cancelled: 0
    };
    private slashRecoveryCount = 0;
    private restoreSlashRecovery?: () => void;
    readonly stubOriginals = new Map<StubKey, unknown>();
    /** Set by the record-dispute-ack stub when its method fires. */
    disputeAckRequestCalled = false;
    /** Set by the record-unsafe-set-latest-state stub when it fires. */
    unsafeSetLatestStateCalled = false;
    /** Set by the recording spectate guard when it blocks an RPC. */
    spectateGuardBlocked = false;
    /** Transport captured by the init-handshake capture stub (pre-handshake). */
    capturedInitHandshakeTransport?: NetworkTransport;
    /** Opening submissions parked by the hold stub, released together. */
    heldOpeningSubmissions: (() => void)[] = [];
    /** Real init-handshake calls observed by the counting wrapper. */
    private queueProbeHold?: HeldRpcReply & {
        completed: number;
        succeeded: number;
    };
    private originalQueueProbe?: SpectateService["sync"];
    private timeoutBuildHold?: HeldRpcReply;
    private restoreTimeoutBuild?: () => void;
    private timeoutStoreCalls = 0;
    private heldHandshakeTransports: NetworkTransport[] = [];
    private releaseHandshakes?: () => void;
    // the one-shot block replay fault: its restore, and whether it fired
    private restoreBlockReplay?: () => void;
    private blockReplayFaultFired = false;
    // the force-join dispute triggers suppressed so far, in order
    private readonly suppressedForceJoinTriggers: string[] = [];
    initHandshakeCallCount = 0;
    /** Set by the record-spectate-abort stub when `abort` fires. */
    abortCalled = false;
    /** Incremented by the count-spectate-requests stub per onSpectateRequest. */
    spectateRequestCount = 0;
    /** Incremented per join-signature request by the recording wrapper. */
    joinSignatureRequestCount = 0;
    /**
     * Timer tasks captured by the hold-scheduled-tasks stub, keyed by the task
     * name prefix that holds them (for example `reduction-`).
     */
    readonly heldScheduledTasks = new Map<
        string,
        { taskName: string; task: () => void | Promise<void> }[]
    >();
    /**
     * The real `scheduleTask`, kept while any prefix is held. One dispatcher
     * serves every active prefix, so prefixes are released in any order and
     * the real scheduler comes back only when the last one goes.
     */
    heldScheduledTaskBase?: TimeoutManager["scheduleTask"];
    /** Chain writes attempted by a reduction submission while the submit hold is installed. */
    reductionSubmitCalls = 0;
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
    readonly droppedEventLogKeys = new Set<InboundMessageLogKey>();
    /** Reduction genesis application control staged by its hold/reject stub. */
    reductionApplicationControl?: ReductionApplicationControl;
    /**
     * Async context of the wrapped reduction application: set only on the
     * application's own call chain, so a concurrent reader of the same
     * state-machine calls (a timeout probe, block validation) never consumes
     * the staged hold or rejection.
     */
    readonly reductionApplicationContext = new AsyncLocalStorage<true>();
    /**
     * Marks a block confirmation ingested through the harness control port,
     * so a stub that drops network-delivered confirmations lets it through.
     */
    readonly controlIngestContext = new AsyncLocalStorage<true>();
    /** Gate holding this peer's own sync at its application step. */
    spectateSyncApplicationGate?: StubGate;
    reductionApplicationGate?: StubGate;
    /** Calls that reached the control; survives the restore that an abort triggers. */
    reductionApplicationEntered = 0;
    /** Pause of one reduction attempt stage (executor attempt or computation). */
    reductionAttemptGate?: StubGate;
    public reductionAttemptsInFlight = 0;
    public forkLeaveObservation = {
        scheduled: 0,
        cancelled: 0,
        settledStateObserved: 0
    };
    private restoreForkLeaveObservation?: () => void;
    /** Detached host calls started by stubs, read back as projections. */
    tryReduceOutcome?: DetachedCallOutcome;
    completeWithGenesisOutcome?: DetachedCallOutcome;
    /** State-manager mutex held by the stub until released. */
    stateMutexGate?: StubGate;
    /** How many distinct inbound logs may be dropped (undefined = all). */
    eventLogDropLimit?: number;
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
    /** Estimates seen by the replay-gas estimate probe (newest last). */
    readonly recordedGasEstimates: RecordedGasEstimate[] = [];
    /** Reads seen by the replay-gas read probe (newest last). */
    readonly recordedReplayGasReads: RecordedReplayGasRead[] = [];
    /** Gate the replay-gas read probe parks reads on, when installed. */
    replayGasReadHold?: DisputeSubmissionHold;
    /** Incremented per `killDispute` skipped by the suppress-kill stub. */
    suppressedDisputeKillCount = 0;
    /** State for the dispute-audit hold at the on-chain-slashes query. */
    heldOnChainSlashesQuery?: HeldOnChainSlashesQueryState;
    heldAuditingDataRebuild?: HeldOnChainSlashesQueryState;
    /** Audit proof walks parked by the proof-walk hold, by their proof's latest block hash. */
    readonly heldProofWalks: {
        latestBlockHash: string;
        release: () => void;
    }[] = [];
    /** State for the hold on this peer's snapshot post at its send. */
    heldSnapshotPostSend?: HeldOnChainSlashesQueryState;
    /** The first parked send's custom revert name once released, or null when it was mined. */
    snapshotPostSendOutcome?: Promise<string | null>;
    /** Call names of every multicall this peer sent while the adoption-post failure stub was installed. */
    recordedMulticallNames: string[][] = [];
    /** Resolvers waiting for the first parked slashes query. */
    private readonly heldOnChainSlashesQueryWaiters: (() => void)[] = [];
    private readonly heldAuditingDataRebuildWaiters: (() => void)[] = [];
    private readonly heldSnapshotPostSendWaiters: (() => void)[] = [];
    private heldLobbyReply?: HeldRpcReply;
    private heldNegotiationReply?: HeldRpcReply;
    private heldMatchedNegotiation?: HeldRpcReply;
    private heldSetChannelId?: HeldRpcReply;
    private heldSpectateResponse?: HeldRpcReply;
    private heldPostMatchTargetRefresh?: HeldRpcReply;
    private postMatchTargetRefreshCallCount = 0;
    private heldMembershipReceipt?: HeldRpcReply;
    private heldMembershipReceiptKind?: HeldMembershipReceiptKind;
    /** Record-only probe on the post-audit evidence comparison. */
    readonly evidenceComparisons = new EvidenceComparisonRecorder();
    /** Profiles the unregister stubs took out of the profile maps, with their peer info. */
    private readonly unregisteredProfiles: {
        profile: PeerProfile;
        peerInfo: BannablePeerInfo | undefined;
    }[] = [];
    /** Inbound request frames recorded by the capture stub, oldest first. */
    private capturedRequestFrames: {
        serializedRpc: string;
        transport: NetworkTransport;
    }[] = [];
    private restoreRequestFrameCapture?: () => void;

    public recordLeaveWatchdog(): void {
        this.leaveWatchdogRestore?.();
        const timers = this.sm.timeoutManager;
        const schedule = timers.scheduleTask.bind(timers);
        const cancel = timers.cancelTask.bind(timers);
        const observation = { delayMs: 0, scheduled: 0, cancelled: 0 };
        this.leaveWatchdogObservation = observation;
        let held: ReturnType<typeof setTimeout> | undefined;
        timers.scheduleTask = (task, delayMs, name) => {
            if (name !== "terminal channel leave watchdog")
                return schedule(task, delayMs, name);
            observation.delayMs = delayMs;
            observation.scheduled += 1;
            // Record-only timing seam: the exit can be authored without racing a 50 ms timer.
            held = {} as ReturnType<typeof setTimeout>;
            return held;
        };
        timers.cancelTask = (handle) => {
            if (held === handle) {
                observation.cancelled += 1;
                held = undefined;
            }
            cancel(handle);
        };
        this.leaveWatchdogRestore = () => {
            timers.scheduleTask = schedule;
            timers.cancelTask = cancel;
        };
    }

    public restoreLeaveWatchdog(): void {
        this.leaveWatchdogRestore?.();
        this.leaveWatchdogRestore = undefined;
    }

    public recordSlashRecoveries(): void {
        this.restoreSlashRecoveries();
        this.slashRecoveryCount = 0;
        const service = this.sm.eventSyncService;
        const original = service.recoverOnChainSlashes.bind(service);
        service.recoverOnChainSlashes = async (...parameters) => {
            this.slashRecoveryCount += 1;
            return original(...parameters);
        };
        this.restoreSlashRecovery = () => {
            service.recoverOnChainSlashes = original;
        };
    }

    public getSlashRecoveryCount(): number {
        return this.slashRecoveryCount;
    }

    public restoreSlashRecoveries(): void {
        this.restoreSlashRecovery?.();
        this.restoreSlashRecovery = undefined;
    }

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessStubService"
            })
        );
    }

    public observeDisputeParticipation(): void {
        this.restoreDisputeParticipationObservation();
        const manager = this.sm.disputeManager;
        const dispute = manager.dispute.bind(manager);
        // Observe the private logger while forwarding every real message.
        const logger = manager["logger"];
        const warn = logger.warn.bind(logger);
        const observation = {
            attempts: 0,
            warnings: 0,
            restore: () => {
                manager.dispute = dispute;
                logger.warn = warn;
            }
        };
        manager.dispute = async (...args) => {
            observation.attempts++;
            return dispute(...args);
        };
        logger.warn = (...args) => {
            if (args[0] === "dispute: signer cannot participate in dispute")
                observation.warnings++;
            return warn(...args);
        };
        this.disputeParticipationObservation = observation;
    }

    /** Record the P2PManager double-signature log entries, forwarding each. */
    public observeDoubleSignatureLogs(): void {
        this.restoreDoubleSignatureLogs();
        const logger = this.sm.p2pManager.logger;
        const levels = ["debug", "warn", "error"] as const;
        const originals = levels.map((level) => logger[level]);
        const entries: DoubleSignatureLogEntry[] = [];
        levels.forEach((level, index) => {
            const original = originals[index].bind(logger);
            logger[level] = (message, ...rest) => {
                if (
                    typeof message === "string" &&
                    message.includes("ouble signature")
                ) {
                    entries.push({
                        level,
                        message,
                        metadata: { ...(rest[0] as Record<string, string>) }
                    });
                }
                return original(message, ...rest);
            };
        });
        this.doubleSignatureLogObservation = {
            entries,
            restore: () =>
                levels.forEach((level, index) => {
                    logger[level] = originals[index];
                })
        };
    }

    public getDoubleSignatureLogs(): DoubleSignatureLogEntry[] {
        return this.doubleSignatureLogObservation?.entries ?? [];
    }

    public restoreDoubleSignatureLogs(): void {
        this.doubleSignatureLogObservation?.restore();
        this.doubleSignatureLogObservation = undefined;
    }

    /** Make every blacklist write fail until restored. */
    public stubBlacklistWriteFailure(): void {
        this.restoreBlacklistWriteFailure();
        const profiles = this.sm.p2pManager.profileManager;
        const blacklistPeer = profiles.blacklistPeer;
        profiles.blacklistPeer = () => {
            throw new Error("injected blacklist write failure");
        };
        this.restoreBlacklistWrite = () => {
            profiles.blacklistPeer = blacklistPeer;
        };
    }

    public restoreBlacklistWriteFailure(): void {
        this.restoreBlacklistWrite?.();
        this.restoreBlacklistWrite = undefined;
    }

    public getDisputeParticipationObservation() {
        return {
            attempts: this.disputeParticipationObservation?.attempts ?? 0,
            warnings: this.disputeParticipationObservation?.warnings ?? 0,
            status: this.sm.status,
            disposed: this.sm.isDisposed,
            didDispute: this.sm.storage.disputes.didIDispute(this.sm.forkId)
        };
    }

    public restoreDisputeParticipationObservation(): void {
        this.disputeParticipationObservation?.restore();
        this.disputeParticipationObservation = undefined;
    }

    public observeAdmission(
        options: {
            source?: Address;
            holdGossip?: boolean;
            holdMembership?: boolean;
            failMembership?: boolean;
        } = {}
    ): void {
        this.restoreAdmissionObservation();
        const queue = this.sm.blockQueueManager;
        const intake = queue.ingestBlockConfirmation.bind(queue);
        const queues = this.sm.storage.queues;
        const createEntry = queues.createEntry.bind(queues);
        const chain = this.sm.eventSyncService;
        const machine = this.sm.diamondStateMachine;
        const router = this.p2pManager.rpcRouter;
        const read = chain.readPinnedChainMembership.bind(chain);
        const participants = machine.getParticipants.bind(machine);
        const broadcast = router.broadcastRpc.bind(router);
        const request = router.sendRpcRequest.bind(router);
        const spectate = this.p2pManager.localRpc.spectateService;
        const sync = spectate.sync.bind(spectate);
        let releaseMembership: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            releaseMembership = resolve;
        });
        if (!options.holdMembership) releaseMembership();
        const observation = {
            completedIntakes: 0,
            completedSyncs: 0,
            successfulSyncs: 0,
            networkEntries: 0,
            proofEntries: 0,
            proofSources: 0,
            chainReads: 0,
            localMembershipReads: 0,
            syncRequests: 0,
            broadcasts: 0,
            holdGossip: options.holdGossip ?? false,
            heldGossip: [] as (() => void)[],
            releaseMembership,
            restore: () => {
                queue.ingestBlockConfirmation = intake;
                spectate.sync = sync;
                queues.createEntry = createEntry;
                chain.readPinnedChainMembership = read;
                machine.getParticipants = participants;
                router.broadcastRpc = broadcast;
                router.sendRpcRequest = request;
            }
        };
        this.admissionObservation = observation;
        spectate.sync = async (...args) => {
            try {
                const result = await sync(...args);
                if (result) observation.successfulSyncs++;
                return result;
            } finally {
                observation.completedSyncs++;
            }
        };
        queues.createEntry = (...args) => {
            const entry = createEntry(...args);
            // Like completedIntakes, a source filter counts only that sender's
            // entries: concurrent copies from honest participants are not
            // the observed source's admission.
            if (
                entry.origin === BlockOrigin.NETWORK &&
                (!options.source ||
                    (args[1].origin === BlockOrigin.NETWORK &&
                        args[1].senderAddress === options.source))
            )
                observation.networkEntries++;
            if (entry.origin === BlockOrigin.PROOF) {
                observation.proofEntries++;
                observation.proofSources += entry.sourcesToSignatures.size;
            }
            return entry;
        };
        queue.ingestBlockConfirmation = async (...args) => {
            try {
                return await intake(...args);
            } finally {
                if (
                    !options.source ||
                    (args[1].origin === BlockOrigin.NETWORK &&
                        args[1].senderAddress === options.source)
                )
                    observation.completedIntakes++;
            }
        };
        chain.readPinnedChainMembership = async (...args) => {
            observation.chainReads++;
            if (options.failMembership)
                throw new Error("Injected membership provider failure");
            const result = await read(...args);
            await gate;
            return result;
        };
        machine.getParticipants = async () => {
            observation.localMembershipReads++;
            return participants();
        };
        router.broadcastRpc = (rpc) => {
            if (
                rpc.service === "stateTransitionService" &&
                rpc.method === "onBlockConfirmation"
            ) {
                observation.broadcasts++;
                if (observation.holdGossip) {
                    observation.heldGossip.push(() => broadcast(rpc));
                    return;
                }
            }
            return broadcast(rpc);
        };
        router.sendRpcRequest = <T>(
            ...args: Parameters<typeof request>
        ): Promise<T> => {
            if (
                args[0].service === "spectateService" &&
                args[0].method === "onSpectateRequest"
            )
                observation.syncRequests++;
            return request<T>(...args);
        };
    }

    public getAdmissionObservation() {
        const observation = this.admissionObservation;
        return {
            completedIntakes: observation?.completedIntakes ?? 0,
            completedSyncs: observation?.completedSyncs ?? 0,
            successfulSyncs: observation?.successfulSyncs ?? 0,
            networkEntries: observation?.networkEntries ?? 0,
            proofEntries: observation?.proofEntries ?? 0,
            proofSources: observation?.proofSources ?? 0,
            chainReads: observation?.chainReads ?? 0,
            localMembershipReads: observation?.localMembershipReads ?? 0,
            syncRequests: observation?.syncRequests ?? 0,
            broadcasts: observation?.broadcasts ?? 0,
            heldGossip: observation?.heldGossip.length ?? 0
        };
    }

    public releaseAdmissionMembership(): void {
        this.admissionObservation?.releaseMembership();
    }

    public releaseAdmissionGossip(): void {
        const observation = this.admissionObservation;
        if (!observation) return;
        observation.holdGossip = false;
        for (const send of observation.heldGossip.splice(0)) send();
    }

    public restoreAdmissionObservation(): void {
        this.releaseAdmissionMembership();
        this.releaseAdmissionGossip();
        this.admissionObservation?.restore();
        this.admissionObservation = undefined;
    }

    /** Scoped clock read for deadline tests; the action must be synchronous. */
    public withQueueClockOffset<T>(seconds: number, action: () => T): T {
        const original = Clock.getTimeInSeconds;
        Clock.getTimeInSeconds = () => original.call(Clock) + seconds;
        try {
            return action();
        } finally {
            Clock.getTimeInSeconds = original;
        }
    }

    /** Schedule one zero-delay task host-side and report whether it ran. */
    public async scheduleProbe(taskName: string): Promise<boolean> {
        let ran = false;
        this.sm.timeoutManager.scheduleTask(
            () => {
                ran = true;
            },
            0,
            taskName
        );
        // The delay is the probe input, giving a zero-delay task one turn to run.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return ran;
    }

    get sm() {
        return this.p2pManager.stateManager;
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

    private holdRpcMethod<
        K extends PropertyKey,
        M extends Record<K, (...args: any[]) => any>
    >(
        original: (transport: NetworkTransport) => M,
        kind: K,
        hold: HeldRpcReply
    ): (transport: NetworkTransport) => M {
        return (transport) => {
            const methods = original(transport);
            const endpoint = methods[kind].bind(methods);
            Reflect.set(methods, kind, async (...parameters: unknown[]) => {
                hold.entered += 1;
                await hold.gate;
                return Reflect.apply(endpoint, methods, parameters);
            });
            return methods;
        };
    }

    public holdLobbyReply(kind: HeldLobbyReplyKind): void {
        this.restoreLobbyReply();
        const service = this.p2pManager.localRpc.lobbyMatchingService;
        const original = service.createRPCMethods.bind(service);
        this.stubOriginals.set("lobbyCreateRpcMethods", original);
        const hold = this.createRpcHold(kind);
        this.heldLobbyReply = hold;
        service.createRPCMethods = this.holdRpcMethod(original, kind, hold);
    }

    public releaseLobbyReply(): number {
        const entered = this.heldLobbyReply?.entered ?? 0;
        this.heldLobbyReply?.release();
        this.restoreLobbyReply();
        return entered;
    }

    public holdNegotiationReply(kind: HeldNegotiationReplyKind): void {
        this.restoreNegotiationReply();
        const service = this.p2pManager.localRpc.openChannelNegotiationService;
        const original = service.createRPCMethods.bind(service);
        this.stubOriginals.set("negotiationCreateRpcMethods", original);
        const hold = this.createRpcHold(kind);
        this.heldNegotiationReply = hold;
        service.createRPCMethods = this.holdRpcMethod(original, kind, hold);
    }

    public releaseNegotiationReply(): number {
        const entered = this.heldNegotiationReply?.entered ?? 0;
        this.heldNegotiationReply?.release();
        this.restoreNegotiationReply();
        return entered;
    }

    public getHeldNegotiationReplyCount(): number {
        return this.heldNegotiationReply?.entered ?? 0;
    }

    public holdMatchedNegotiation(fail = false): void {
        this.releaseMatchedNegotiation();
        const service = this.p2pManager.localRpc.openChannelNegotiationService;
        const original = service.initMatchedNegotiation.bind(service);
        this.stubOriginals.set("matchedNegotiation", original);
        const hold = this.createRpcHold("exchangeTerms");
        this.heldMatchedNegotiation = hold;
        service.initMatchedNegotiation = async (
            match: LobbyMatch,
            options: MatchedNegotiationOptions = {}
        ) => {
            hold.entered += 1;
            await hold.gate;
            if (fail) return { status: "targeted-failed" } as const;
            return original(match, options);
        };
    }

    public releaseMatchedNegotiation(): number {
        const entered = this.heldMatchedNegotiation?.entered ?? 0;
        this.heldMatchedNegotiation?.release();
        const original = this.stubOriginals.get("matchedNegotiation");
        if (original) {
            this.p2pManager.localRpc.openChannelNegotiationService.initMatchedNegotiation =
                original as (
                    match: LobbyMatch,
                    options?: MatchedNegotiationOptions
                ) => Promise<NegotiationOutcome>;
            this.stubOriginals.delete("matchedNegotiation");
        }
        this.heldMatchedNegotiation = undefined;
        return entered;
    }

    public getHeldMatchedNegotiationCount(): number {
        return this.heldMatchedNegotiation?.entered ?? 0;
    }

    public failNextMatchedNegotiation(): void {
        this.restoreFailedMatchedNegotiation();
        const service = this.p2pManager.localRpc.openChannelNegotiationService;
        const original = service.initMatchedNegotiation.bind(service);
        this.stubOriginals.set("failMatchedNegotiation", original);
        service.initMatchedNegotiation = async () => {
            this.restoreFailedMatchedNegotiation();
            return { status: "targeted-failed" };
        };
    }

    private restoreFailedMatchedNegotiation(): void {
        const original = this.stubOriginals.get("failMatchedNegotiation");
        if (!original) return;
        this.p2pManager.localRpc.openChannelNegotiationService.initMatchedNegotiation =
            original as (
                match: LobbyMatch,
                options?: MatchedNegotiationOptions
            ) => Promise<NegotiationOutcome>;
        this.stubOriginals.delete("failMatchedNegotiation");
    }

    public holdSpectateResponses(fail = false): void {
        this.releaseSpectateResponses();
        const service = this.p2pManager.localRpc.spectateService;
        const original = service.createRPCMethods.bind(service);
        this.stubOriginals.set("heldSpectateCreateRpcMethods", original);
        const hold = this.createRpcHold("spectate");
        this.heldSpectateResponse = hold;
        service.createRPCMethods = (transport) => {
            const methods = original(transport);
            const endpoint = methods.onSpectateRequest.bind(methods);
            methods.onSpectateRequest = async (request) => {
                const response = await endpoint(request);
                hold.entered += 1;
                await hold.gate;
                if (fail) {
                    throw new Error("injected spectate response failure");
                }
                return response;
            };
            return methods;
        };
    }

    public releaseSpectateResponses(): number {
        const entered = this.heldSpectateResponse?.entered ?? 0;
        this.heldSpectateResponse?.release();
        const original = this.stubOriginals.get("heldSpectateCreateRpcMethods");
        if (original) {
            this.p2pManager.localRpc.spectateService.createRPCMethods =
                original as typeof this.p2pManager.localRpc.spectateService.createRPCMethods;
            this.stubOriginals.delete("heldSpectateCreateRpcMethods");
        }
        this.heldSpectateResponse = undefined;
        return entered;
    }

    public getHeldSpectateResponseCount(): number {
        return this.heldSpectateResponse?.entered ?? 0;
    }

    /** Park the second opened-status refresh; `autoReleaseMs` frees it by timer. */
    public holdPostMatchTargetRefresh(autoReleaseMs?: number): void {
        this.releasePostMatchTargetRefresh();
        const original = this.sm.refreshOpenedStatusFromChain.bind(this.sm);
        this.stubOriginals.set("postMatchTargetRefresh", original);
        const hold = this.createRpcHold("exchangeTerms");
        this.heldPostMatchTargetRefresh = hold;
        this.postMatchTargetRefreshCallCount = 0;
        if (autoReleaseMs !== undefined)
            setTimeout(() => hold.release(), autoReleaseMs).unref();
        this.sm.refreshOpenedStatusFromChain = async () => {
            this.postMatchTargetRefreshCallCount += 1;
            if (this.postMatchTargetRefreshCallCount === 2) {
                hold.entered += 1;
                await hold.gate;
            }
            return original();
        };
    }

    public releasePostMatchTargetRefresh(): number {
        const entered = this.heldPostMatchTargetRefresh?.entered ?? 0;
        this.heldPostMatchTargetRefresh?.release();
        const original = this.stubOriginals.get("postMatchTargetRefresh");
        if (original) {
            this.sm.refreshOpenedStatusFromChain =
                original as typeof this.sm.refreshOpenedStatusFromChain;
            this.stubOriginals.delete("postMatchTargetRefresh");
        }
        this.heldPostMatchTargetRefresh = undefined;
        return entered;
    }

    public getHeldPostMatchTargetRefreshCount(): number {
        return this.heldPostMatchTargetRefresh?.entered ?? 0;
    }

    private membershipStubKey(kind: HeldMembershipReceiptKind): StubKey {
        return kind === "joinChannel"
            ? "membershipJoinReceipt"
            : "membershipTopUpReceipt";
    }

    private captureMembershipMethod(kind: HeldMembershipReceiptKind) {
        this.releaseMembershipReceipt();
        const contract = this.sm.stateChannelManagerContract;
        const original = contract[kind].bind(contract);
        this.stubOriginals.set(this.membershipStubKey(kind), original);
        return { contract, original };
    }

    public holdMembershipReceipt(
        kind: HeldMembershipReceiptKind,
        fail = false
    ): void {
        const { contract, original } = this.captureMembershipMethod(kind);
        const hold = this.createRpcHold("exchangeTerms");
        this.heldMembershipReceipt = hold;
        this.heldMembershipReceiptKind = kind;
        Reflect.set(contract, kind, async (...parameters: unknown[]) => {
            if (fail) {
                return {
                    wait: async () => {
                        hold.entered += 1;
                        await hold.gate;
                        throw Object.assign(
                            new Error(`injected ${kind} receipt failure`),
                            {
                                code: "CALL_EXCEPTION",
                                receipt: { status: 0 }
                            }
                        );
                    }
                };
            }
            const tx = await Reflect.apply(original, contract, parameters);
            const originalWait = tx.wait.bind(tx);
            tx.wait = async (...waitParameters: unknown[]) => {
                hold.entered += 1;
                await hold.gate;
                return Reflect.apply(originalWait, tx, waitParameters);
            };
            return tx;
        });
    }

    public holdMembershipSubmission(kind: HeldMembershipReceiptKind): void {
        const { contract, original } = this.captureMembershipMethod(kind);
        const hold = this.createRpcHold("exchangeTerms");
        this.heldMembershipReceipt = hold;
        this.heldMembershipReceiptKind = kind;
        Reflect.set(contract, kind, async (...parameters: unknown[]) => {
            hold.entered += 1;
            await hold.gate;
            return Reflect.apply(original, contract, parameters);
        });
    }

    public holdNextSignature(match?: SignatureBlockMatch): void {
        const signer = this.sm.signer;
        const original = signer.signMessage.bind(signer);
        const hold = this.createRpcHold("spectate");
        this.nextSignatureHold = hold;
        const commit = this.sm.blockCommitService;
        const originalCommit = commit.success.bind(commit);
        let expectedPayload: string | undefined;
        if (match) {
            // Observe the block before its real commit signs it; the signer only receives its hash.
            commit.success = async (block, ...args) => {
                if (
                    block.forkId === match.forkId &&
                    (
                        await resolveAddress(block.signerAddress)
                    ).toLowerCase() ===
                        (
                            await resolveAddress(match.participant)
                        ).toLowerCase() &&
                    hexlify(block.tx.body.data).startsWith(
                        match.transactionSelector
                    )
                )
                    expectedPayload = hexlify(block.hash);
                return originalCommit(block, ...args);
            };
        }
        this.restoreNextSignature = () => {
            signer.signMessage = original;
            commit.success = originalCommit;
        };
        signer.signMessage = async (...args) => {
            const payload =
                typeof args[0] === "string" ? args[0] : hexlify(args[0]);
            if (match && payload !== expectedPayload) return original(...args);
            this.restoreNextSignature?.();
            hold.entered += 1;
            await hold.gate;
            return original(...args);
        };
    }

    public getNextSignatureEntered(): number {
        return this.nextSignatureHold?.entered ?? 0;
    }

    public releaseNextSignature(): void {
        this.restoreNextSignature?.();
        this.restoreNextSignature = undefined;
        this.nextSignatureHold?.release();
    }

    public holdSyncReductionResult(): void {
        const contract = this.sm.diamondStateMachine.localDiamondContract;
        const original = contract.reduceAndFinalize;
        const hold = this.createRpcHold("spectate");
        this.syncReductionHold = hold;
        this.restoreSyncReduction = () =>
            Reflect.set(contract, "reduceAndFinalize", original);
        Reflect.set(
            contract,
            "reduceAndFinalize",
            async (...args: Parameters<typeof original>) => {
                const result = await original(...args);
                this.restoreSyncReduction?.();
                hold.entered += 1;
                await hold.gate;
                return result;
            }
        );
    }

    public getSyncReductionEntered(): number {
        return this.syncReductionHold?.entered ?? 0;
    }

    public releaseSyncReductionResult(): void {
        this.restoreSyncReduction?.();
        this.restoreSyncReduction = undefined;
        this.syncReductionHold?.release();
    }

    /**
     * Stop this peer running the participant-timeout check, so a staged
     * scenario is not cut short by a real timeout dispute.
     */
    public suppressTimeoutCheck(): void {
        const timeouts = this.sm.participantTimeoutService;
        if (!this.stubOriginals.has("timeoutCheck")) {
            this.stubOriginals.set(
                "timeoutCheck",
                timeouts["tryTimeoutParticipant"]
            );
        }
        timeouts["tryTimeoutParticipant"] = async () => undefined;
    }

    /** Undo {@link suppressTimeoutCheck}; false when it was not installed. */
    public restoreSuppressTimeoutCheck(): boolean {
        const original = this.stubOriginals.get("timeoutCheck");
        if (original === undefined) return false;
        const timeouts = this.sm.participantTimeoutService;
        timeouts["tryTimeoutParticipant"] =
            original as (typeof timeouts)["tryTimeoutParticipant"];
        this.stubOriginals.delete("timeoutCheck");
        return true;
    }

    public recordSyncRejections(): void {
        // Private handler observed only at the host-side test seam.
        const service = this.sm.p2pManager.localRpc
            .spectateService as unknown as {
            rejectSync(peerAddress: string, reason: string): false;
        };
        const original = service.rejectSync.bind(service);
        this.syncRejectionReasons = [];
        this.restoreSyncRejections = () => {
            service.rejectSync = original;
        };
        service.rejectSync = (peerAddress, reason) => {
            this.syncRejectionReasons.push(reason);
            return original(peerAddress, reason);
        };
    }

    public restoreRecordedSyncRejections(): string[] {
        this.restoreSyncRejections?.();
        this.restoreSyncRejections = undefined;
        return [...this.syncRejectionReasons];
    }

    public recordSyncFinalityReads(): void {
        const contract = this.sm.stateChannelManagerContract;
        const provider = contract.runner!.provider!;
        const original = provider.call.bind(provider);
        const finalitySelector = contract.interface.getFunction(
            "isReduceChallengePeriodExpired"
        )!.selector;
        const multicallSelector =
            contract.interface.getFunction("multicall")!.selector;
        this.finalityReadWidths = [];
        this.restoreFinalityReads = () => {
            provider.call = original;
        };
        provider.call = async (transaction) => {
            if (typeof transaction.data === "string") {
                const data = transaction.data;
                if (data.startsWith(finalitySelector))
                    this.finalityReadWidths.push(1);
                if (data.startsWith(multicallSelector)) {
                    const [calls] = contract.interface.decodeFunctionData(
                        "multicall",
                        data
                    );
                    const width = Array.from(calls as string[]).filter((call) =>
                        call.startsWith(finalitySelector)
                    ).length;
                    if (width > 0) this.finalityReadWidths.push(width);
                }
            }
            return original(transaction);
        };
    }

    public getSyncFinalityReadWidths(): number[] {
        return this.finalityReadWidths;
    }

    public restoreSyncFinalityReads(): void {
        this.restoreFinalityReads?.();
        this.restoreFinalityReads = undefined;
    }

    public recordChainMembershipReads(): void {
        const contract = this.sm.stateChannelManagerContract;
        const original = contract.getParticipants;
        this.chainMembershipReadCount = 0;
        this.restoreChainMembership = () => {
            Reflect.set(contract, "getParticipants", original);
        };
        Reflect.set(
            contract,
            "getParticipants",
            (...args: Parameters<typeof original>) => {
                this.chainMembershipReadCount += 1;
                return original(...args);
            }
        );
    }

    public getChainMembershipReadCount(): number {
        return this.chainMembershipReadCount;
    }

    public restoreChainMembershipReads(): void {
        this.restoreChainMembership?.();
        this.restoreChainMembership = undefined;
    }

    public holdSyncWindowPersistence(): void {
        const service = this.p2pManager.localRpc.spectateService;
        const original =
            service.fetchAndPersistOnChainDisputeWindows.bind(service);
        const hold = this.createRpcHold("spectate");
        this.syncWindowHold = hold;
        this.restoreSyncWindow = () => {
            service.fetchAndPersistOnChainDisputeWindows = original;
        };
        service.fetchAndPersistOnChainDisputeWindows = async (...args) => {
            const windows = await original(...args);
            this.restoreSyncWindow?.();
            hold.entered += 1;
            await hold.gate;
            return windows;
        };
    }

    public getSyncWindowPersistenceEntered(): number {
        return this.syncWindowHold?.entered ?? 0;
    }

    public releaseSyncWindowPersistence(): void {
        this.restoreSyncWindow?.();
        this.restoreSyncWindow = undefined;
        this.syncWindowHold?.release();
    }

    // records each sync's supplied windows and those the chain had not finalized, which the sync must reduce
    public recordSyncReductionWindows(): void {
        const service = this.p2pManager.localRpc.spectateService;
        const original = service.applySyncResponse.bind(service);
        const contract =
            this.p2pManager.stateManager.stateChannelManagerContract;
        this.syncReductionWindows = [];
        this.restoreSyncReductionRecorder = () => {
            service.applySyncResponse = original;
        };
        service.applySyncResponse = async (
            peerAddress,
            syncRequest,
            encodedSyncPayload
        ) => {
            const suppliedForks = Codec.decode(
                encodedSyncPayload,
                Type.SyncPayload
            ).disputeWindows.map((window) => window.forkId);
            const reductionForks: ForkId[] = [];
            for (const forkId of suppliedForks) {
                if (
                    !(await contract.isReduceChallengePeriodExpired(
                        syncRequest.channelId,
                        forkId
                    ))
                )
                    reductionForks.push(forkId);
            }
            this.syncReductionWindows.push({ suppliedForks, reductionForks });
            return await original(peerAddress, syncRequest, encodedSyncPayload);
        };
    }

    public getSyncReductionWindows() {
        return this.syncReductionWindows;
    }

    public restoreSyncReductionWindows(): void {
        this.restoreSyncReductionRecorder?.();
        this.restoreSyncReductionRecorder = undefined;
    }

    public holdQueueProbe(): void {
        const service = this.p2pManager.localRpc.spectateService;
        const original = service.sync.bind(service);
        this.originalQueueProbe = original;
        const hold = {
            ...this.createRpcHold("spectate"),
            completed: 0,
            succeeded: 0
        };
        this.queueProbeHold = hold;
        service.sync = async (...args) => {
            hold.entered += 1;
            await hold.gate;
            try {
                const result = await original(...args);
                if (result) hold.succeeded += 1;
                return result;
            } finally {
                hold.completed += 1;
            }
        };
    }

    public getQueueProbeObservation() {
        const hold = this.queueProbeHold;
        return {
            entered: hold?.entered ?? 0,
            completed: hold?.completed ?? 0,
            succeeded: hold?.succeeded ?? 0
        };
    }

    public releaseQueueProbe(): void {
        this.queueProbeHold?.release();
        if (this.originalQueueProbe)
            this.p2pManager.localRpc.spectateService.sync =
                this.originalQueueProbe;
        this.originalQueueProbe = undefined;
    }

    public async startTimeoutConstruction(
        writer: string,
        height: BlockHeight = 1
    ): Promise<boolean> {
        await this.sm.participantTimeoutService["createTimeOutDispute"](
            this.sm.forkId,
            height,
            writer,
            0
        );
        return true;
    }

    public holdTimeoutBuild(): void {
        const sm = this.p2pManager.stateManager;
        const contract = sm.diamondStateMachine.localDiamondContract;
        const original = contract.getBlockCallDataCommitment;
        const store = sm.storage.timeout.storeTimeout.bind(sm.storage.timeout);
        const hold = this.createRpcHold("timeoutBuild");
        this.timeoutBuildHold = hold;
        this.timeoutStoreCalls = 0;
        Reflect.set(
            contract,
            "getBlockCallDataCommitment",
            async (...args: Parameters<typeof original>) => {
                const result = await original(...args);
                hold.entered += 1;
                await hold.gate;
                return result;
            }
        );
        sm.storage.timeout.storeTimeout = (...args) => {
            this.timeoutStoreCalls += 1;
            return store(...args);
        };
        this.restoreTimeoutBuild = () => {
            hold.release();
            Reflect.set(contract, "getBlockCallDataCommitment", original);
            sm.storage.timeout.storeTimeout = store;
        };
    }

    public getTimeoutBuildObservation(): { entered: number; stored: number } {
        return {
            entered: this.timeoutBuildHold?.entered ?? 0,
            stored: this.timeoutStoreCalls
        };
    }

    public releaseTimeoutBuild(): void {
        this.timeoutBuildHold?.release();
    }

    public restoreTimeoutBuildRecording(): void {
        this.restoreTimeoutBuild?.();
        this.restoreTimeoutBuild = undefined;
    }

    public holdInitHandshakes(): void {
        const service = this.p2pManager.localRpc.initHandshakeService;
        const original = service.initHandshake.bind(service);
        this.heldHandshakeTransports = [];
        service.initHandshake = (transport) => {
            this.heldHandshakeTransports.push(transport);
        };
        this.releaseHandshakes = () => {
            service.initHandshake = original;
            for (const transport of this.heldHandshakeTransports)
                original(transport);
            this.heldHandshakeTransports = [];
        };
    }

    public getHeldHandshakeCount(): number {
        return this.heldHandshakeTransports.length;
    }

    /** Held transports whose remote peer already acknowledged this peer. */
    public getAckedHeldHandshakeCount(): number {
        const service = this.p2pManager.localRpc.initHandshakeService;
        return this.heldHandshakeTransports.filter((transport) =>
            service.didReceiveAck(transport)
        ).length;
    }

    public releaseInitHandshakes(): void {
        this.releaseHandshakes?.();
        this.releaseHandshakes = undefined;
    }

    /**
     * Fault injection: take a proven peer's profile out of the profile
     * owner, as if it was dropped after the handshake. Its transports stay
     * open and keep their proven address.
     */
    public unregisterPeerProfile(peerAddress: Address): boolean {
        const profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(peerAddress);
        if (!profile) return false;
        this.unregisterProfile(profile);
        return true;
    }

    /**
     * Fault injection: take the profile of every transport the handshake
     * hold parked out of the profile owner. Those transports then have
     * neither a profile nor a proven address.
     */
    public unregisterHeldHandshakeProfiles(): number {
        let unregistered = 0;
        for (const transport of this.heldHandshakeTransports) {
            const profile =
                this.p2pManager.profileManager.getProfileByTransport(transport);
            if (!profile) continue;
            this.unregisterProfile(profile);
            unregistered += 1;
        }
        return unregistered;
    }

    /** Register every profile the unregister stubs removed again. */
    public restoreUnregisteredProfiles(): number {
        const restored = this.unregisteredProfiles.splice(0);
        for (const { profile, peerInfo } of restored) {
            if (peerInfo) profile.setHolepunchPeerInfo(peerInfo);
            this.p2pManager.profileManager.registerProfile(profile);
        }
        return restored.length;
    }

    /**
     * Record-only: keep every inbound request frame for `service` that
     * reaches the network router, with the connection it arrived on.
     */
    public captureInboundRequestFrames(service: string): void {
        this.restoreInboundRequestFrames();
        const router = this.p2pManager.rpcRouter;
        const onRpc = router.onRpc;
        const frames: typeof this.capturedRequestFrames = [];
        this.capturedRequestFrames = frames;
        router.onRpc = function (serializedRpc, transport) {
            const frame = deserializeRpcFrame(serializedRpc);
            if (
                frame?.kind === "request" &&
                frame.rpc.service === service &&
                !transport.isTrusted
            ) {
                frames.push({ serializedRpc, transport });
            }
            return onRpc.call(this, serializedRpc, transport);
        };
        this.restoreRequestFrameCapture = () => {
            router.onRpc = onRpc;
        };
    }

    /**
     * Fault injection: deliver a captured request frame again on the actual
     * connection it arrived on, through the network router entry point.
     */
    public async injectCapturedRequestFrame(
        index: number
    ): Promise<{ transportClosed: boolean }> {
        const frame = this.capturedRequestFrames[index];
        if (!frame) throw new Error(`no captured request frame ${index}`);
        const transportClosed = frame.transport.isClosed;
        await this.p2pManager.rpcRouter.onRpc(
            frame.serializedRpc,
            frame.transport
        );
        return { transportClosed };
    }

    public restoreInboundRequestFrames(): void {
        this.restoreRequestFrameCapture?.();
        this.restoreRequestFrameCapture = undefined;
        this.capturedRequestFrames = [];
    }

    private unregisterProfile(profile: PeerProfile): void {
        const profileManager = this.p2pManager.profileManager;
        const peerInfo = profile.getHolepunchPeerInfo();
        // Unmap every live transport, not only the preferred one.
        for (const transport of profile.getLiveTransports())
            profileManager.unregisterProfile(profile, transport);
        profileManager.unregisterProfile(profile);
        this.unregisteredProfiles.push({ profile, peerInfo });
    }

    public countInitHandshakeCalls(): void {
        const service = this.p2pManager.localRpc.initHandshakeService;
        if (!this.stubOriginals.has("countInitHandshake")) {
            this.stubOriginals.set(
                "countInitHandshake",
                service.initHandshake.bind(service)
            );
        }
        const original = this.stubOriginals.get(
            "countInitHandshake"
        ) as typeof service.initHandshake;
        this.initHandshakeCallCount = 0;
        service.initHandshake = (transport) => {
            this.initHandshakeCallCount += 1;
            return original(transport);
        };
    }

    public getInitHandshakeCallCount(): number {
        return this.initHandshakeCallCount;
    }

    public failMembershipReceipt(kind: HeldMembershipReceiptKind): void {
        const { contract, original } = this.captureMembershipMethod(kind);
        this.heldMembershipReceiptKind = kind;
        Reflect.set(contract, kind, async () => ({
            wait: async () => {
                throw Object.assign(
                    new Error(`injected ${kind} receipt failure`),
                    {
                        code: "CALL_EXCEPTION",
                        receipt: { status: 0 }
                    }
                );
            }
        }));
    }

    public failMembershipSubmissionUncertain(
        kind: HeldMembershipReceiptKind
    ): void {
        const { contract, original } = this.captureMembershipMethod(kind);
        this.heldMembershipReceiptKind = kind;
        Reflect.set(contract, kind, async () => {
            throw new Error(`injected uncertain ${kind} submission failure`);
        });
    }

    public releaseMembershipReceipt(): number {
        const entered = this.heldMembershipReceipt?.entered ?? 0;
        this.heldMembershipReceipt?.release();
        const kind = this.heldMembershipReceiptKind;
        if (kind) {
            const key = this.membershipStubKey(kind);
            const original = this.stubOriginals.get(key);
            if (original) {
                Reflect.set(
                    this.sm.stateChannelManagerContract,
                    kind,
                    original
                );
                this.stubOriginals.delete(key);
            }
        }
        this.heldMembershipReceipt = undefined;
        this.heldMembershipReceiptKind = undefined;
        return entered;
    }

    public getHeldMembershipReceiptCount(): number {
        return this.heldMembershipReceipt?.entered ?? 0;
    }

    public holdSetChannelId(): void {
        this.releaseSetChannelId();
        const original = this.sm.setChannelId.bind(this.sm);
        this.stubOriginals.set("setChannelId", original);
        const hold = this.createRpcHold("exchangeTerms");
        this.heldSetChannelId = hold;
        this.sm.setChannelId = async (channelId) => {
            hold.entered += 1;
            await hold.gate;
            return original(channelId);
        };
    }

    public releaseSetChannelId(): number {
        const entered = this.heldSetChannelId?.entered ?? 0;
        this.heldSetChannelId?.release();
        const original = this.stubOriginals.get("setChannelId");
        if (original) {
            this.sm.setChannelId = original as typeof this.sm.setChannelId;
            this.stubOriginals.delete("setChannelId");
        }
        this.heldSetChannelId = undefined;
        return entered;
    }

    public getHeldSetChannelIdCount(): number {
        return this.heldSetChannelId?.entered ?? 0;
    }

    public overrideLobbyRoleDuration(durationMs: number): void {
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
            throw new Error("Role duration must be a positive integer");
        }
        const service = this.p2pManager.localRpc.lobbyMatchingService;
        if (!this.stubOriginals.has("lobbyRoleDuration")) {
            this.stubOriginals.set("lobbyRoleDuration", {
                min: Reflect.get(service, "roleDurationMinMs"),
                max: Reflect.get(service, "roleDurationMaxMs")
            });
        }
        Reflect.set(service, "roleDurationMinMs", durationMs);
        Reflect.set(service, "roleDurationMaxMs", durationMs);
    }

    public restoreLobbyRoleDuration(): boolean {
        const original = this.stubOriginals.get("lobbyRoleDuration") as
            | { min: number; max: number }
            | undefined;
        if (!original) return false;
        const service = this.p2pManager.localRpc.lobbyMatchingService;
        Reflect.set(service, "roleDurationMinMs", original.min);
        Reflect.set(service, "roleDurationMaxMs", original.max);
        this.stubOriginals.delete("lobbyRoleDuration");
        return true;
    }

    /** One releasable pause shared by the reduction-control stubs. */
    public createGate(): StubGate {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        return { entered: 0, gate, release };
    }

    /**
     * Release every paused reduction-control call and restore the wrapped
     * host methods. Runs on control-root disposal so an abort during a staged
     * hold never leaves a paused drain behind.
     */
    public installBlockWorkHold(point: BlockWorkHoldPoint): void {
        this.releaseBlockWorkHold();
        this.blockWorkEntered = 0;
        const gate = new Promise<void>((resolve) => {
            this.blockWorkRelease = resolve;
        });
        const enter = async () => {
            this.blockWorkRestore?.();
            this.blockWorkRestore = undefined;
            this.blockWorkEntered += 1;
            await gate;
        };
        if (point === "queueDequeue") {
            const owner = this.sm.blockQueueManager;
            const original = owner.tryExecuteFromQueue;
            this.blockWorkRestore = () => {
                owner.tryExecuteFromQueue = original;
            };
            owner.tryExecuteFromQueue = async (...args) => {
                this.blockWorkEntered += 1;
                await gate;
                return original.apply(owner, args);
            };
        } else if (point === "stateApplicationInspection") {
            const owner = this.sm.diamondStateMachine;
            const original = owner.getNextToWrite;
            this.blockWorkRestore = () => {
                owner.getNextToWrite = original;
            };
            owner.getNextToWrite = async () => {
                const result = await original.call(owner);
                await enter();
                return result;
            };
        } else if (point === "storedMerge") {
            const owner = this.sm.storedBlockMergeService;
            const original = owner.tryMergeStoredBlockConfirmation;
            this.blockWorkRestore = () => {
                owner.tryMergeStoredBlockConfirmation = original;
            };
            owner.tryMergeStoredBlockConfirmation = async (...args) => {
                await enter();
                return original.apply(owner, args);
            };
        } else if (
            point === "confirmationValidation" ||
            point === "proofConfirmationValidation"
        ) {
            const owner = this.sm.validationService;
            const original = owner.normalizeConfirmationSignatures;
            this.blockWorkRestore = () => {
                owner.normalizeConfirmationSignatures = original;
            };
            owner.normalizeConfirmationSignatures = async (...args) => {
                if (
                    point === "confirmationValidation" ||
                    args[0].origin === BlockOrigin.PROOF
                )
                    await enter();
                return original.apply(owner, args);
            };
        } else if (point === "authoring") {
            const owner = this.sm.snapshotAssemblyService;
            const original = owner.assembleFromTransaction;
            this.blockWorkRestore = () => {
                owner.assembleFromTransaction = original;
            };
            owner.assembleFromTransaction = async (...args) => {
                await enter();
                return original.apply(owner, args);
            };
        } else if (point === "commit") {
            const owner = this.sm.blockCommitService;
            const original = owner.success;
            this.blockWorkRestore = () => {
                owner.success = original;
            };
            owner.success = async (...args) => {
                await enter();
                return original.apply(owner, args);
            };
        } else if (point === "confirmation") {
            // parks every queued confirmation until release, so a timeout
            // check meets the posted block still in flight
            const owner = this.sm.blockIngestService;
            const original = owner.onBlockConfirmation;
            this.blockWorkRestore = () => {
                owner.onBlockConfirmation = original;
            };
            owner.onBlockConfirmation = async (...args) => {
                this.blockWorkEntered += 1;
                await gate;
                return original.apply(owner, args);
            };
        } else {
            const owner = this.sm.signer;
            const original = owner.signMessage;
            this.blockWorkRestore = () => {
                owner.signMessage = original;
            };
            owner.signMessage = async (...args) => {
                await enter();
                return original.apply(owner, args);
            };
        }
    }

    public releaseBlockWorkHold(): void {
        this.blockWorkRestore?.();
        this.blockWorkRestore = undefined;
        this.blockWorkRelease?.();
        this.blockWorkRelease = undefined;
    }

    public recordForkLeave(forkId: ForkId): void {
        this.restoreForkLeave();
        const observation = {
            scheduled: 0,
            cancelled: 0,
            settledStateObserved: 0
        };
        this.forkLeaveObservation = observation;
        const timers = this.sm.timeoutManager;
        const leave = this.sm.leaveChannelService;
        const schedule = timers.scheduleTask;
        const cancel = timers.cancelTask;
        const settled = leave.onSettledStateObserved;
        const handles = new Set<ReturnType<typeof setTimeout>>();
        timers.scheduleTask = (...args) => {
            const handle = schedule.apply(timers, args);
            if (args[2] === `reduction-${forkId}`) {
                observation.scheduled += 1;
                handles.add(handle);
            }
            return handle;
        };
        timers.cancelTask = (handle) => {
            if (handles.delete(handle)) observation.cancelled += 1;
            cancel.call(timers, handle);
        };
        leave.onSettledStateObserved = async (...args) => {
            await settled.apply(leave, args);
            observation.settledStateObserved += 1;
        };
        this.restoreForkLeaveObservation = () => {
            timers.scheduleTask = schedule;
            timers.cancelTask = cancel;
            leave.onSettledStateObserved = settled;
        };
    }

    public restoreForkLeave(): void {
        this.restoreForkLeaveObservation?.();
        this.restoreForkLeaveObservation = undefined;
    }

    public releaseReductionHolds(): void {
        this.restoreDoubleSignatureLogs();
        this.restoreBlacklistWriteFailure();
        this.restoreDisputeParticipationObservation();
        this.restoreAdmissionObservation();
        this.restoreForkLeave();
        this.releaseBlockWorkHold();
        this.restoreReductionApplication();
        this.restoreReductionAttempt();
        this.releaseStateMutex();
    }

    public restoreReductionApplication(): void {
        const sm = this.sm;
        const application = this.stubOriginals.get("reductionApplication");
        if (application) {
            sm.stateApplicationService.unsafeApplyReductionGenesis =
                application as typeof sm.stateApplicationService.unsafeApplyReductionGenesis;
            this.stubOriginals.delete("reductionApplication");
        }
        const setState = this.stubOriginals.get("reductionApplicationSetState");
        if (setState) {
            sm.diamondStateMachine.setState =
                setState as typeof sm.diamondStateMachine.setState;
            this.stubOriginals.delete("reductionApplicationSetState");
        }
        const getParticipants = this.stubOriginals.get(
            "reductionApplicationGetParticipants"
        );
        if (getParticipants) {
            sm.diamondStateMachine.getParticipants =
                getParticipants as typeof sm.diamondStateMachine.getParticipants;
            this.stubOriginals.delete("reductionApplicationGetParticipants");
        }
        const getNextToWrite = this.stubOriginals.get(
            "reductionApplicationGetNextToWrite"
        );
        if (getNextToWrite) {
            sm.diamondStateMachine.getNextToWrite =
                getNextToWrite as typeof sm.diamondStateMachine.getNextToWrite;
            this.stubOriginals.delete("reductionApplicationGetNextToWrite");
        }
        this.reductionApplicationControl = undefined;
        this.reductionApplicationGate?.release();
        this.reductionApplicationGate = undefined;
    }

    public restoreReductionAttempt(): void {
        const manager = this.sm.reductionManager;
        const executor = manager["reductionExecutor"];
        const computation = manager["reductionComputationService"];
        const contract = this.sm.stateChannelManagerContract;
        const admission = this.stubOriginals.get("reductionAdmission");
        if (admission) {
            Reflect.set(contract, "isForkDisputed", admission);
            this.stubOriginals.delete("reductionAdmission");
        }
        const attempt = this.stubOriginals.get("reductionAttempt");
        if (attempt) {
            executor.tryReduce = attempt as typeof executor.tryReduce;
            this.stubOriginals.delete("reductionAttempt");
        }
        const observed = this.stubOriginals.get("reductionObservedAttempt");
        if (observed) {
            executor.tryReduce = observed as typeof executor.tryReduce;
            this.stubOriginals.delete("reductionObservedAttempt");
        }
        const disputes = this.stubOriginals.get("reductionDisputes");
        if (disputes) {
            executor.getSyncedForkDisputes =
                disputes as typeof executor.getSyncedForkDisputes;
            this.stubOriginals.delete("reductionDisputes");
        }
        const compute = this.stubOriginals.get("reductionCompute");
        if (compute) {
            computation.compute = compute as typeof computation.compute;
            this.stubOriginals.delete("reductionCompute");
        }
        const gasLimit = this.stubOriginals.get("reductionSubmitGasLimit");
        if (gasLimit) {
            Reflect.set(contract, "getGasLimit", gasLimit);
            this.stubOriginals.delete("reductionSubmitGasLimit");
        }
        const multicall = this.stubOriginals.get("reductionSubmitMulticall");
        if (multicall) {
            Reflect.set(contract, "multicall", multicall);
            this.stubOriginals.delete("reductionSubmitMulticall");
        }
        this.reductionAttemptGate?.release();
        this.reductionAttemptGate = undefined;
    }

    public releaseStateMutex(): void {
        this.stateMutexGate?.release();
        this.stateMutexGate = undefined;
    }

    private createRpcHold(kind: HeldRpcReply["kind"]): HeldRpcReply {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        return { kind, entered: 0, gate, release };
    }

    private restoreLobbyReply(): void {
        const original = this.stubOriginals.get("lobbyCreateRpcMethods");
        if (original) {
            this.p2pManager.localRpc.lobbyMatchingService.createRPCMethods =
                original as (
                    transport: NetworkTransport
                ) => LobbyMatchingRpcMethods;
            this.stubOriginals.delete("lobbyCreateRpcMethods");
        }
        this.heldLobbyReply = undefined;
    }

    private restoreNegotiationReply(): void {
        const original = this.stubOriginals.get("negotiationCreateRpcMethods");
        if (original) {
            this.p2pManager.localRpc.openChannelNegotiationService.createRPCMethods =
                original as (
                    transport: NetworkTransport
                ) => OpenChannelNegotiationRpcMethods;
            this.stubOriginals.delete("negotiationCreateRpcMethods");
        }
        this.heldNegotiationReply = undefined;
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

    /**
     * Test-harness pruning of history below an anchor: deletes this peer's
     * stored blocks of `forkId` below `anchorHeight` through the real
     * `BlockStorage.deleteBlock`, keeping the anchor block and everything
     * above it. Snapshots and state-machine states stay: their storage has no
     * delete API. Returns the pruned heights.
     */
    public pruneStoredBlocksBelowAnchor(
        forkId: ForkId,
        anchorHeight: BlockHeight
    ): BlockHeight[] {
        const blocks = this.sm.storage.blocks;
        if (!blocks.getBlock(forkId, anchorHeight))
            throw new Error(
                `pruneStoredBlocksBelowAnchor: no stored anchor block at height ${anchorHeight} of ${forkId}`
            );
        const pruned: BlockHeight[] = [];
        for (let height = 0; height < anchorHeight; height++)
            if (blocks.deleteBlock(forkId, height)) pruned.push(height);
        return pruned;
    }

    /**
     * Fault injection: the next execution of the block at `forkId:height`
     * (`SnapshotAssemblyService.assembleFromTransaction`, the state
     * transition step of every replay) throws a genuine internal error
     * instead of a verdict. One-shot: the real method is back once it fired.
     */
    public failBlockReplayAt(forkId: ForkId, height: BlockHeight): void {
        this.restoreBlockReplayFault();
        const assembly = this.sm.snapshotAssemblyService;
        const original = assembly.assembleFromTransaction;
        this.blockReplayFaultFired = false;
        this.restoreBlockReplay = () => {
            assembly.assembleFromTransaction = original;
        };
        assembly.assembleFromTransaction = (async (...args) => {
            const [coordinates] = args;
            if (
                coordinates.forkId === forkId &&
                coordinates.height === height
            ) {
                this.restoreBlockReplayFault();
                this.blockReplayFaultFired = true;
                throw new Error(BLOCK_REPLAY_FAULT_MESSAGE);
            }
            return Reflect.apply(original, assembly, args);
        }) as typeof assembly.assembleFromTransaction;
    }

    /**
     * Keep this peer's force-join route closed: every force-join dispute it
     * would start (block bound or deadline) is recorded by its trigger and
     * reported as started, so the deadline does not re-arm. Its other
     * dispute routes are untouched.
     */
    public suppressForceJoinDispute(): void {
        // private: MembershipService's single entry to the force-join dispute
        Reflect.set(
            this.sm.membershipService,
            "startForceJoinDispute",
            async (trigger: string) => {
                this.suppressedForceJoinTriggers.push(trigger);
                return true;
            }
        );
    }

    public getSuppressedForceJoinTriggers(): string[] {
        return [...this.suppressedForceJoinTriggers];
    }

    public didBlockReplayFaultFire(): boolean {
        return this.blockReplayFaultFired;
    }

    public restoreBlockReplayFault(): boolean {
        if (!this.restoreBlockReplay) return false;
        this.restoreBlockReplay();
        this.restoreBlockReplay = undefined;
        return true;
    }

    /**
     * Test-harness removal of one signer's confirmation signature from this
     * peer's stored block of `forkId` at `height` (the author's signature
     * cannot be removed). The block is stored again without it; the view does
     * not move.
     */
    public stripStoredBlockSignature(
        forkId: ForkId,
        height: BlockHeight,
        signer: Address
    ): void {
        const blocks = this.sm.storage.blocks;
        const block = blocks.getBlock(forkId, height);
        if (!block)
            throw new Error(
                `stripStoredBlockSignature: no stored block at height ${height} of ${forkId}`
            );
        if (block.author === signer)
            throw new Error(
                "stripStoredBlockSignature: the author's signature cannot be removed"
            );
        const signatures = [...block.confirmationSignatures];
        const kept = signatures.filter(
            (signature) => block.signatureToAddress(signature) !== signer
        );
        if (kept.length === signatures.length)
            throw new Error(
                `stripStoredBlockSignature: ${signer} did not sign height ${height}`
            );
        const stripped = block.authorSignedCopy().expandSignatures(kept);
        blocks.deleteBlock(forkId, height);
        blocks.storeBlock(stripped, {
            hash: stripped.hash,
            coordinates: stripped.coordinates,
            justPersist: true
        });
    }

    /**
     * Test-harness pruning of one stored state snapshot by hash. Snapshot
     * storage has no delete API, so this removes the entry from its map. A
     * genesis snapshot is refused.
     */
    public deleteStoredSnapshot(snapshotHash: Hash): void {
        const snapshots = this.sm.storage.stateSnapshots;
        const snapshot = snapshots.getStateSnapshotByHash(snapshotHash);
        if (!snapshot)
            throw new Error(
                `deleteStoredSnapshot: no stored snapshot ${snapshotHash}`
            );
        if (snapshot.isGenesis)
            throw new Error("deleteStoredSnapshot: a genesis snapshot is kept");
        snapshots["snapshotsByHash"].delete(snapshotHash);
    }

    /** Remove one required application state; session teardown discards the peer. */
    public deleteStoredState(stateHash: Hash): boolean {
        return this.sm.storage.stateMachineStates["statesByHash"].delete(
            stateHash
        );
    }

    /**
     * Test-harness pruning of the snapshots and application states below an
     * anchor: for every stored block of `forkId` below `anchorHeight`, its
     * resulting snapshot and that snapshot's state-machine state are removed
     * (their storages have no delete API). The anchor block's snapshot and
     * state and the fork genesis are kept. Run it before pruning the blocks.
     * Returns the pruned snapshot hashes.
     */
    public pruneStoredSnapshotsBelowAnchor(
        forkId: ForkId,
        anchorHeight: BlockHeight
    ): Hash[] {
        const blocks = this.sm.storage.blocks;
        const snapshots = this.sm.storage.stateSnapshots;
        const states = this.sm.storage.stateMachineStates;
        const anchorBlock = blocks.getBlock(forkId, anchorHeight);
        if (!anchorBlock)
            throw new Error(
                `pruneStoredSnapshotsBelowAnchor: no stored anchor block at height ${anchorHeight} of ${forkId}`
            );
        const anchor = snapshots.getStateSnapshotByHash(
            anchorBlock.stateSnapshotHash
        );
        const genesis = snapshots.getGenesisSnapshotByForkId(forkId);
        const keptStates = new Set(
            [anchor, genesis].map((kept) =>
                String(kept?.snapshotData.stateMachineStateHash)
            )
        );
        const pruned: Hash[] = [];
        for (let height = 0; height < anchorHeight; height++) {
            const block = blocks.getBlock(forkId, height);
            const snapshot =
                block &&
                snapshots.getStateSnapshotByHash(block.stateSnapshotHash);
            if (
                !snapshot ||
                snapshot.isGenesis ||
                snapshot.hash === anchor?.hash
            )
                continue;
            const stateHash = String(
                snapshot.snapshotData.stateMachineStateHash
            ) as Hash;
            if (!keptStates.has(String(stateHash)))
                states["statesByHash"].delete(stateHash);
            snapshots["snapshotsByHash"].delete(snapshot.hash);
            pruned.push(snapshot.hash);
        }
        return pruned;
    }

    /**
     * Park every dispute output computation (the local diamond's
     * `computeDisputeOutputSnapshotData`) until released. Its two callers are
     * `DisputeManager.constructDispute`, after the dispute marker and before
     * the dispute is signed or stored, and the commit handler of a final
     * dispute, before it installs the reduced result. `at: "auditingData"`
     * parks `DisputeManager.buildAuditingData` instead: inside
     * `constructDispute`, before it reads the force-exit flag.
     */
    public installAuditingDataRebuildHold(
        at: "output" | "auditingData" = "output"
    ): void {
        if (at === "auditingData") return this.installAuditingDataBuildHold();
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;
        if (!this.stubOriginals.has("auditingDataRebuild")) {
            this.stubOriginals.set(
                "auditingDataRebuild",
                localDiamond.computeDisputeOutputSnapshotData
            );
        }
        const original = this.stubOriginals.get(
            "auditingDataRebuild"
        ) as typeof localDiamond.computeDisputeOutputSnapshotData;
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
        this.heldAuditingDataRebuild = held;
        // the callers use only staticCall; the hold patches that member
        localDiamond.computeDisputeOutputSnapshotData = Object.assign(
            original.bind(localDiamond),
            {
                staticCall: async (
                    ...args: Parameters<typeof original.staticCall>
                ) => {
                    held.entered += 1;
                    this.heldAuditingDataRebuildWaiters
                        .splice(0)
                        .forEach((resolve) => resolve());
                    await gate;
                    return original.staticCall(...args);
                }
            }
        ) as unknown as typeof original;
    }

    /**
     * Delay this runtime's discovery join so an abort can land inside it. The
     * test that uses it aborts the runtime, which disposes this worker, so
     * there is nothing left to restore.
     */
    public installDiscoveryJoinHold(holdMs: number): void {
        if (this.stubOriginals.has("discoveryJoinHold")) return;
        const original =
            LocalDiscoveryServer.connectToPeers.bind(LocalDiscoveryServer);
        this.stubOriginals.set("discoveryJoinHold", original);
        LocalDiscoveryServer.connectToPeers = (async (...args) => {
            await sleep(holdMs);
            return original(...args);
        }) as typeof LocalDiscoveryServer.connectToPeers;
    }

    public async joinAndLeavePendingLocalDiscovery(
        topic: string
    ): Promise<void> {
        await LocalDiscoveryServer.tryStart();
        await Promise.all([
            LocalDiscoveryServer.connectToPeers(
                this.p2pManager,
                topic,
                this.sm.signerAddress.toString()
            ),
            LocalDiscoveryServer.leave(topic, this.p2pManager)
        ]);
    }

    public getLocalDiscoveryListenerCount(): number {
        const servers = Reflect.get(LocalDiscoveryServer, "peerServers");
        if (!(servers instanceof Set))
            throw new Error("Missing discovery listener registry");
        return [...servers].filter(
            (server) =>
                server instanceof WebSocketServer && server.address() !== null
        ).length;
    }

    public expireCalldataPost(): void {
        const contract = this.sm.stateChannelManagerContract;
        if (this.stubOriginals.has("expiredCalldataPost")) return;
        const original = contract.postBlockCalldata;
        this.stubOriginals.set("expiredCalldataPost", original);
        contract.postBlockCalldata = new Proxy(original, {
            apply: async (target, receiver, parameters) =>
                Reflect.apply(target, receiver, [
                    parameters[0],
                    (await Clock.getBlockchainTime()).timestamp - 1,
                    { gasLimit: 1_000_000 }
                ])
        });
    }

    public restoreCalldataPost(): boolean {
        const original = this.stubOriginals.get("expiredCalldataPost");
        if (original === undefined) return false;
        this.sm.stateChannelManagerContract.postBlockCalldata =
            original as StateChannelManagerInterface["postBlockCalldata"];
        this.stubOriginals.delete("expiredCalldataPost");
        return true;
    }

    /**
     * Park this peer's snapshot post at its contract send, after the post
     * was prepared against the chain state of that moment; the send then
     * runs for real against the chain state at release.
     */
    public installSnapshotPostSendHold(): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("snapshotPostSend")) {
            this.stubOriginals.set("snapshotPostSend", contract.multicall);
        }
        const original = this.stubOriginals.get(
            "snapshotPostSend"
        ) as StateChannelManagerInterface["multicall"];
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
        this.heldSnapshotPostSend = held;
        this.snapshotPostSendOutcome = undefined;
        // Only the send is held; simulation and population keep the real
        // contract method's properties, including when another hold wraps it.
        contract.multicall = new Proxy(original, {
            apply: (target, receiver, parameters) => {
                held.entered += 1;
                this.heldSnapshotPostSendWaiters
                    .splice(0)
                    .forEach((resolve) => resolve());
                const sent = gate.then(
                    (): ReturnType<typeof original> =>
                        Reflect.apply(target, receiver, parameters)
                );
                if (held.entered === 1)
                    this.snapshotPostSendOutcome = sent
                        .then((response) => response.wait())
                        .then(
                            () => null,
                            (error) =>
                                tryDecodeCustomError(error)?.name ??
                                String(error)
                        );
                return sent;
            }
        });
    }

    public releaseSnapshotPostSendHold(): boolean {
        this.heldSnapshotPostSend?.release();
        this.heldSnapshotPostSend = undefined;
        const original = this.stubOriginals.get("snapshotPostSend");
        if (original === undefined) return false;
        this.sm.stateChannelManagerContract.multicall =
            original as StateChannelManagerInterface["multicall"];
        this.stubOriginals.delete("snapshotPostSend");
        return true;
    }

    /**
     * Fail this peer's first `failures` adopt-only snapshot posts (a multicall
     * whose only call is `updateStateSnapshotFork`) at their send, and record
     * the call names of every multicall the peer sends; later sends run for real.
     */
    public installAdoptionPostFailure(failures: number): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("adoptionPostFailure")) {
            this.stubOriginals.set("adoptionPostFailure", contract.multicall);
        }
        const original = this.stubOriginals.get(
            "adoptionPostFailure"
        ) as StateChannelManagerInterface["multicall"];
        this.recordedMulticallNames = [];
        let failed = 0;
        contract.multicall = new Proxy(original, {
            apply: (target, receiver, parameters) => {
                const names = (parameters[0] as string[]).map(
                    (data) =>
                        contract.interface.parseTransaction({ data })?.name ??
                        "unknown"
                );
                this.recordedMulticallNames.push(names);
                if (
                    failed < failures &&
                    names.length === 1 &&
                    names[0] === "updateStateSnapshotFork"
                ) {
                    failed++;
                    return Promise.reject(
                        new Error("injected adoption post send failure")
                    );
                }
                return Reflect.apply(target, receiver, parameters);
            }
        });
    }

    /** Restore the real send; the call names recorded while installed. */
    public restoreAdoptionPostFailure(): string[][] {
        const original = this.stubOriginals.get("adoptionPostFailure");
        if (original !== undefined) {
            this.sm.stateChannelManagerContract.multicall =
                original as StateChannelManagerInterface["multicall"];
            this.stubOriginals.delete("adoptionPostFailure");
        }
        return this.recordedMulticallNames;
    }

    /** Resolve with the parked count once a post is held at its send. */
    public waitForHeldSnapshotPostSend(): Promise<number> {
        const held = this.heldSnapshotPostSend;
        if (!held) {
            return Promise.reject(
                new Error("snapshotPostSend hold not installed")
            );
        }
        if (held.entered > 0) return Promise.resolve(held.entered);
        return new Promise((resolve) =>
            this.heldSnapshotPostSendWaiters.push(() => resolve(held.entered))
        );
    }

    private installAuditingDataBuildHold(): void {
        const disputeManager = this.sm.disputeManager;
        if (!this.stubOriginals.has("auditingDataBuild")) {
            this.stubOriginals.set(
                "auditingDataBuild",
                disputeManager["buildAuditingData"].bind(disputeManager)
            );
        }
        const original = this.stubOriginals.get(
            "auditingDataBuild"
        ) as DisputeManager["buildAuditingData"];
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
        this.heldAuditingDataRebuild = held;
        disputeManager["buildAuditingData"] = (async (...args) => {
            held.entered += 1;
            this.heldAuditingDataRebuildWaiters
                .splice(0)
                .forEach((resolve) => resolve());
            await gate;
            return original(...args);
        }) as DisputeManager["buildAuditingData"];
    }

    /**
     * Park every proof walk of this peer's audits (after their pre-walk
     * checks, before the walk, its replay and the persistence of what it
     * verified) until the test releases it by the proof's latest block hash.
     */
    public installProofWalkHold(): void {
        const agreementManager = this.sm.agreementManager;
        if (!this.stubOriginals.has("proofWalkHold"))
            this.stubOriginals.set(
                "proofWalkHold",
                agreementManager.walkStateProofTiers.bind(agreementManager)
            );
        const original = this.stubOriginals.get(
            "proofWalkHold"
        ) as typeof agreementManager.walkStateProofTiers;
        const held = this.heldProofWalks;
        agreementManager.walkStateProofTiers = async function* (
            forkId,
            stateProof,
            evidence
        ) {
            const latest =
                agreementManager.getLatestBlockFromStateProof(stateProof);
            await new Promise<void>((release) =>
                held.push({
                    latestBlockHash: String(latest?.hash ?? ""),
                    release
                })
            );
            yield* original(forkId, stateProof, evidence);
        };
    }

    /** Release the parked walk whose proof ends at `latestBlockHash`. */
    public releaseHeldProofWalk(latestBlockHash: string): boolean {
        const index = this.heldProofWalks.findIndex(
            (walk) => walk.latestBlockHash === latestBlockHash
        );
        if (index === -1) return false;
        const [walk] = this.heldProofWalks.splice(index, 1);
        walk!.release();
        return true;
    }

    /** Release every parked walk and restore the real walk. */
    public restoreProofWalkHold(): boolean {
        this.heldProofWalks.splice(0).forEach((walk) => walk.release());
        const original = this.stubOriginals.get("proofWalkHold");
        if (original === undefined) return false;
        this.sm.agreementManager.walkStateProofTiers =
            original as typeof this.sm.agreementManager.walkStateProofTiers;
        this.stubOriginals.delete("proofWalkHold");
        return true;
    }

    public releaseAuditingDataRebuildHold(): boolean {
        this.heldAuditingDataRebuild?.release();
        this.heldAuditingDataRebuild = undefined;
        const build = this.stubOriginals.get("auditingDataBuild");
        if (build !== undefined) {
            this.sm.disputeManager["buildAuditingData"] =
                build as DisputeManager["buildAuditingData"];
            this.stubOriginals.delete("auditingDataBuild");
            return true;
        }
        const original = this.stubOriginals.get("auditingDataRebuild");
        if (original === undefined) return false;
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;
        localDiamond.computeDisputeOutputSnapshotData =
            original as typeof localDiamond.computeDisputeOutputSnapshotData;
        this.stubOriginals.delete("auditingDataRebuild");
        return true;
    }

    /** Resolve with the parked-caller count once at least one rebuild is held. */
    public waitForHeldAuditingDataRebuild(): Promise<number> {
        const held = this.heldAuditingDataRebuild;
        if (!held) {
            return Promise.reject(
                new Error("auditingDataRebuild hold not installed")
            );
        }
        if (held.entered > 0) return Promise.resolve(held.entered);
        return new Promise((resolve) =>
            this.heldAuditingDataRebuildWaiters.push(() =>
                resolve(held.entered)
            )
        );
    }

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

    failOnChainSlashesRead(): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("onChainSlashesRead")) {
            this.stubOriginals.set(
                "onChainSlashesRead",
                this.chainProvider.call.bind(this.chainProvider)
            );
        }
        const original = this.stubOriginals.get(
            "onChainSlashesRead"
        ) as typeof this.chainProvider.call;
        const selector = contract.interface
            .getFunction("getOnChainSlashedParticipants")!
            .selector.slice(2);
        this.chainProvider.call = async (transaction) => {
            if (String(transaction.data).includes(selector))
                throw new Error("authoritative slash read failed");
            return original(transaction);
        };
    }

    restoreOnChainSlashesRead(): boolean {
        const original = this.stubOriginals.get("onChainSlashesRead");
        if (original === undefined) return false;
        this.chainProvider.call = original as typeof this.chainProvider.call;
        this.stubOriginals.delete("onChainSlashesRead");
        return true;
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

    /** The recorded getLogs spans as a probe reports them. */
    // Shared with ValidationProbeService, which reads the same query recorder.
    public describeChainLogQueries() {
        const spans = this.chainLogQueries;
        return {
            queryCount: spans.length,
            queriedFromBlocks: spans.map((span) => span.fromBlock),
            toBlock: spans.length ? spans[spans.length - 1].toBlock : null
        };
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
            original as StateChannelManagerInterface["getDisputeWindowCreationTimestamp"];
        this.stubOriginals.delete("disputeWindowTimestamp");
        return true;
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
        failure?: DisputeSubmissionFailureSpec,
        forward = false
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("disputeSubmissions")) {
            this.stubOriginals.set("disputeSubmissions", {
                multicall: contract.multicall,
                uploadDispute: contract.uploadDispute,
                uploadDisputeWithCalldata: contract.uploadDisputeWithCalldata
            } satisfies DisputeSubmissionOriginals);
        }
        const originals = this.stubOriginals.get(
            "disputeSubmissions"
        ) as DisputeSubmissionOriginals;
        this.recordedDisputeSubmissions.length = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.disputeSubmissionHold = holdSubmissions
            ? { gate, release, held: 0 }
            : undefined;
        this.disputeSubmissionFailure = failure;

        let failuresRemaining = failure?.times ?? Infinity;
        const record = async (
            submission: Omit<RecordedDisputeSubmission, "waited" | "revert">,
            send: () => Promise<unknown>
        ) => {
            const entry: RecordedDisputeSubmission = {
                ...submission,
                waited: false,
                revert: null
            };
            this.recordedDisputeSubmissions.push(entry);
            const hold = this.disputeSubmissionHold;
            if (hold) {
                hold.held += 1;
                await hold.gate;
            }
            const activeFailure = failuresRemaining > 0 ? failure : undefined;
            if (activeFailure) failuresRemaining -= 1;
            if (activeFailure?.at === "send")
                throw this.submissionFailure(activeFailure);
            if (forward && !activeFailure) {
                let tx: ContractTransactionResponse;
                try {
                    tx = (await send()) as ContractTransactionResponse;
                } catch (error) {
                    entry.revert = recordedRevert(error);
                    throw error;
                }
                const originalWait = tx.wait.bind(tx);
                tx.wait = (async (...args: Parameters<typeof originalWait>) => {
                    try {
                        const receipt = await originalWait(...args);
                        entry.waited = true;
                        return receipt;
                    } catch (error) {
                        entry.revert = recordedRevert(
                            await withRevertData(tx, error)
                        );
                        throw error;
                    }
                }) as typeof tx.wait;
                return tx;
            }
            return {
                // a tx that reverts also reverts the preflight `call` that
                // tryHandleEvmError retries through
                provider:
                    activeFailure?.at === "wait"
                        ? {
                              call: async () => {
                                  throw this.submissionFailure(activeFailure);
                              }
                          }
                        : undefined,
                wait: async () => {
                    if (activeFailure?.at === "wait") {
                        throw this.submissionFailure(activeFailure);
                    }
                    entry.waited = true;
                    return null;
                }
            };
        };

        contract.uploadDispute = this.asRecordingContractMethod(
            contract.uploadDispute,
            (confirmation: DisputeConfirmationStruct, overrides?: unknown) =>
                record(
                    {
                        method: "uploadDispute",
                        innerMethods: [],
                        encodedDispute: String(
                            confirmation.signedDispute.encodedDispute
                        ),
                        encodedAuditingData: null,
                        fraudProofParticipants: [],
                        gasLimit: this.overrideGasLimit(overrides)
                    },
                    () =>
                        Reflect.apply(originals.uploadDispute, contract, [
                            confirmation,
                            ...(overrides ? [overrides] : [])
                        ])
                )
        );

        contract.uploadDisputeWithCalldata = this.asRecordingContractMethod(
            contract.uploadDisputeWithCalldata,
            (
                confirmation: DisputeConfirmationStruct,
                auditingData: DisputeAuditingDataStruct,
                overrides?: unknown
            ) =>
                record(
                    {
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
                        gasLimit: this.overrideGasLimit(overrides)
                    },
                    () =>
                        Reflect.apply(
                            originals.uploadDisputeWithCalldata,
                            contract,
                            [
                                confirmation,
                                auditingData,
                                ...(overrides ? [overrides] : [])
                            ]
                        )
                )
        );

        contract.multicall = this.asRecordingContractMethod(
            contract.multicall,
            (calls: string[], overrides?: unknown) => {
                const send = () =>
                    Reflect.apply(originals.multicall, contract, [
                        calls,
                        ...(overrides ? [overrides] : [])
                    ]);
                const described = this.describeMulticall(calls);
                // only dispute uploads are recorded; snapshot posts and reductions pass through
                if (!described.encodedDispute) return send();
                return record(
                    {
                        ...described,
                        method: "multicall",
                        gasLimit: this.overrideGasLimit(overrides)
                    },
                    send
                );
            }
        );
    }

    /**
     * A stand-in that records the send but keeps the original method's helpers
     * (`populateTransaction`, `staticCall`, …) - the multicall branch builds its
     * legs through `populateTransaction` on these very methods.
     */
    // Shared with ValidationProbeService to install its recording contract methods.
    public asRecordingContractMethod<T extends object>(
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
    ): Omit<
        RecordedDisputeSubmission,
        "waited" | "revert" | "method" | "gasLimit"
    > {
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
            } else if (
                parsed.name === "uploadDispute" ||
                parsed.name === "uploadDisputeWithCalldata"
            ) {
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
            // Built from the error's own ABI fragment; a hand-hashed `Name()`
            // selector decodes to nothing once the error gains a parameter.
            return {
                data: factory.encodedCustomErrorRevert(
                    failure.customError,
                    failure.customErrorArgs
                )
            };
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
                contract.applyDisputeFraudProofs
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

        contract.applyDisputeFraudProofs = this.asRecordingContractMethod(
            original,
            async (proofs: DisputeFraudProofStruct[], overrides?: unknown) => {
                const entry: RecordedFraudProofApply = {
                    participants: proofs.map((proof) =>
                        String(proof.participant)
                    ),
                    gasLimit: this.overrideGasLimit(overrides),
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
                    entry.customError =
                        tryDecodeCustomError(error)?.name ?? null;
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
                    tx = await Reflect.apply(original, contract, [
                        proofs,
                        ...(overrides ? [overrides] : [])
                    ]);
                } catch (error) {
                    fail(error);
                    throw error;
                }
                const originalWait = tx.wait.bind(tx);
                const sent = tx;
                sent.wait = (async (
                    ...args: Parameters<typeof originalWait>
                ) => {
                    try {
                        const receipt = await originalWait(...args);
                        entry.waited = true;
                        return receipt;
                    } catch (error) {
                        fail(error);
                        // a mined revert carries no revert data: name it by
                        // replaying the same call, as tryHandleEvmError does
                        if (entry.customError === null)
                            await sent.provider
                                .call({
                                    from: sent.from,
                                    to: sent.to,
                                    data: sent.data,
                                    value: sent.value
                                })
                                .catch((replayError: unknown) => {
                                    entry.customError =
                                        tryDecodeCustomError(replayError)
                                            ?.name ?? null;
                                });
                        throw error;
                    }
                }) as typeof sent.wait;
                return sent;
            }
        );
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
     * Probe on this peer's chain-signer estimates for transactions calling
     * one of `methods` on the manager: each estimate is taken by the real
     * signer (its headroom included), recorded, and answered scaled by
     * `numerator / denominator`. Scaling stands in for an estimator that
     * reports a different figure for the same transaction (a spent-gas
     * estimator answers below the replay requirement, a searching one at or
     * above it); the transaction itself is unchanged and still sent for real
     * by the caller. Other estimates pass through unrecorded.
     */
    public installReplayGasEstimateScale(
        methods: ReplayGasEstimateMethod[],
        numerator: number,
        denominator: number
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        const runner = contract.runner;
        if (!runner?.estimateGas)
            throw new Error("the manager contract's runner cannot estimate");
        this.restoreReplayGasEstimateScale();
        this.stubOriginals.set(
            "replayGasEstimates",
            Object.getOwnPropertyDescriptor(runner, "estimateGas") ?? null
        );
        const estimateGas = runner.estimateGas.bind(runner);
        const selectors = new Map(
            methods.map((method) => [
                contract.interface.getFunction(method)!.selector,
                method
            ])
        );
        this.recordedGasEstimates.length = 0;
        Reflect.set(
            runner,
            "estimateGas",
            async (tx: TransactionRequest): Promise<bigint> => {
                const estimate = await estimateGas(tx);
                const method = selectors.get(String(tx.data).slice(0, 10));
                if (method === undefined) return estimate;
                const answer =
                    (estimate * BigInt(numerator)) / BigInt(denominator);
                this.recordedGasEstimates.push({
                    method,
                    estimate: String(estimate),
                    answer: String(answer)
                });
                return answer;
            }
        );
    }

    public restoreReplayGasEstimateScale(): boolean {
        if (!this.stubOriginals.has("replayGasEstimates")) return false;
        const original = this.stubOriginals.get(
            "replayGasEstimates"
        ) as PropertyDescriptor | null;
        const runner = this.sm.stateChannelManagerContract.runner!;
        if (original) Object.defineProperty(runner, "estimateGas", original);
        else Reflect.deleteProperty(runner, "estimateGas");
        this.stubOriginals.delete("replayGasEstimates");
        return true;
    }

    /**
     * Record-only probe on the manager's `getStateTransitionReplayGas` read:
     * every read is recorded with how it settled and forwarded to the real
     * contract, except the first `failFirst` reads, which reject with
     * REPLAY_GAS_READ_STUB_FAILURE instead of reaching the chain. `hold`
     * parks each read (recorded as pending) until released, before it is
     * forwarded.
     */
    public installReplayGasReadRecorder(
        failFirst: number,
        hold: boolean
    ): void {
        const contract = this.sm.stateChannelManagerContract;
        if (!this.stubOriginals.has("replayGasReads"))
            this.stubOriginals.set(
                "replayGasReads",
                contract.getStateTransitionReplayGas
            );
        const original = this.stubOriginals.get(
            "replayGasReads"
        ) as StateChannelManagerInterface["getStateTransitionReplayGas"];
        this.recordedReplayGasReads.length = 0;
        this.replayGasReadHold?.release();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.replayGasReadHold = hold ? { gate, release, held: 0 } : undefined;
        let failuresRemaining = failFirst;
        contract.getStateTransitionReplayGas = this.asRecordingContractMethod(
            original,
            async (...args: never[]): Promise<bigint> => {
                const entry: RecordedReplayGasRead = {
                    outcome: "pending",
                    replayGas: null
                };
                this.recordedReplayGasReads.push(entry);
                const held = this.replayGasReadHold;
                if (held) {
                    held.held += 1;
                    await held.gate;
                }
                if (failuresRemaining > 0) {
                    failuresRemaining -= 1;
                    entry.outcome = "rejected";
                    throw new Error(REPLAY_GAS_READ_STUB_FAILURE);
                }
                try {
                    const replayGas: bigint = await Reflect.apply(
                        original,
                        contract,
                        args
                    );
                    entry.outcome = "resolved";
                    entry.replayGas = String(replayGas);
                    return replayGas;
                } catch (error) {
                    entry.outcome = "rejected";
                    throw error;
                }
            }
        );
    }

    /** Let every parked replay-gas read (and any later one) through. */
    public releaseReplayGasReads(): boolean {
        const hold = this.replayGasReadHold;
        if (!hold) return false;
        this.replayGasReadHold = undefined;
        hold.release();
        return true;
    }

    public restoreReplayGasReads(): boolean {
        this.releaseReplayGasReads();
        const original = this.stubOriginals.get("replayGasReads");
        if (original === undefined) return false;
        this.sm.stateChannelManagerContract.getStateTransitionReplayGas =
            original as StateChannelManagerInterface["getStateTransitionReplayGas"];
        this.stubOriginals.delete("replayGasReads");
        return true;
    }

    public createRPCMethods(transport: NetworkTransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;
