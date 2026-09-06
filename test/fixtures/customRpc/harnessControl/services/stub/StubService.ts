// @spec-test-coverage-ignore: RPC fixture support exercised by owning E2E declarations.
import StubRpcMethods from "./StubRpcMethods";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import type LobbyMatchingRpcMethods from "@/rpc/services/lobbyMatching/LobbyMatchingRpcMethods";
import type { LobbyMatch } from "@/rpc/services/lobbyMatching/LobbyMatchingTypes";
import type OpenChannelNegotiationRpcMethods from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods";
import type {
    MatchedNegotiationOptions,
    NegotiationOutcome
} from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import {
    Codec,
    LocalDiscoveryServer,
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
import { AsyncLocalStorage } from "node:async_hooks";
import { WebSocketServer } from "ws";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

export type BlockWorkHoldPoint = "authoring" | "commit" | "signature";

type DisputeCommittedEventKey = string;
type CalldataPostedEventKey = string;
type InboundMessageLogKey = string;

/** Fixed identifiers for the stub-original registry (never caller-supplied). */
export type StubKey =
    | "auditingDataRebuild"
    | "snapshotPostSend"
    | "expiredCalldataPost"
    | "broadcast"
    | "calldataPosting"
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
    | "lobbyRoleDuration";

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
    kind: HeldLobbyReplyKind | HeldNegotiationReplyKind | "spectate";
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
};

export type DisputeSubmissionFailureSpec = {
    /** Solidity custom error to revert with (its selector is the revert data). */
    customError?: RaceConditionErrorName;
    customErrorArgs?: string[];
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

/** The block range one recorded `provider.getLogs` call asked for. */
export type ChainLogQuerySpan = {
    fromBlock: number | null;
    toBlock: number | null;
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
    private blockWorkRelease?: () => void;
    private blockWorkRestore?: () => void;
    public blockWorkEntered = 0;
    readonly stubOriginals = new Map<StubKey, unknown>();
    /** Set by the record-dispute-ack stub when its method fires. */
    disputeAckRequestCalled = false;
    /** Set by the record-unsafe-set-latest-state stub when it fires. */
    unsafeSetLatestStateCalled = false;
    /** Set by the recording spectate guard when it blocks an RPC. */
    spectateGuardBlocked = false;
    /** Transport captured by the init-handshake capture stub (pre-handshake). */
    capturedInitHandshakeTransport?: ATransport;
    /** Real init-handshake calls observed by the counting wrapper. */
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
    /** Incremented per `killDispute` skipped by the suppress-kill stub. */
    suppressedDisputeKillCount = 0;
    /** State for the dispute-audit hold at the on-chain-slashes query. */
    heldOnChainSlashesQuery?: HeldOnChainSlashesQueryState;
    heldAuditingDataRebuild?: HeldOnChainSlashesQueryState;
    /** State for the hold on this peer's snapshot post at its send. */
    heldSnapshotPostSend?: HeldOnChainSlashesQueryState;
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

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessStubService"
            })
        );
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
        original: (transport: ATransport) => M,
        kind: K,
        hold: HeldRpcReply
    ): (transport: ATransport) => M {
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

    public holdPostMatchTargetRefresh(): void {
        this.releasePostMatchTargetRefresh();
        const original = this.sm.refreshOpenedStatusFromChain.bind(this.sm);
        this.stubOriginals.set("postMatchTargetRefresh", original);
        const hold = this.createRpcHold("exchangeTerms");
        this.heldPostMatchTargetRefresh = hold;
        this.postMatchTargetRefreshCallCount = 0;
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
        if (point === "authoring") {
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
                original as (transport: ATransport) => LobbyMatchingRpcMethods;
            this.stubOriginals.delete("lobbyCreateRpcMethods");
        }
        this.heldLobbyReply = undefined;
    }

    private restoreNegotiationReply(): void {
        const original = this.stubOriginals.get("negotiationCreateRpcMethods");
        if (original) {
            this.p2pManager.localRpc.openChannelNegotiationService.createRPCMethods =
                original as (
                    transport: ATransport
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

    /** Release parked callers and reinstall the real query. */
    /**
     * Park every auditing-data rebuild (`DisputeManager.getAuditingData`)
     * until released. A final dispute committed without its auditing data
     * makes the commit handler rebuild it before installing the result, so
     * the hold keeps that install waiting while an ordinary attempt runs.
     */
    public installAuditingDataRebuildHold(): void {
        const disputeManager = this.sm.disputeManager;
        if (!this.stubOriginals.has("auditingDataRebuild")) {
            this.stubOriginals.set(
                "auditingDataRebuild",
                disputeManager.getAuditingData.bind(disputeManager)
            );
        }
        const original = this.stubOriginals.get(
            "auditingDataRebuild"
        ) as typeof disputeManager.getAuditingData;
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
        disputeManager.getAuditingData = (async (
            ...args: Parameters<typeof original>
        ) => {
            held.entered += 1;
            this.heldAuditingDataRebuildWaiters
                .splice(0)
                .forEach((resolve) => resolve());
            await gate;
            return original(...args);
        }) as typeof disputeManager.getAuditingData;
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
        // Only the send is held; simulation and population keep the real
        // contract method's properties, including when another hold wraps it.
        contract.multicall = new Proxy(original, {
            apply: async (target, receiver, parameters) => {
                held.entered += 1;
                this.heldSnapshotPostSendWaiters
                    .splice(0)
                    .forEach((resolve) => resolve());
                await gate;
                return Reflect.apply(target, receiver, parameters);
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

    public releaseAuditingDataRebuildHold(): boolean {
        this.heldAuditingDataRebuild?.release();
        this.heldAuditingDataRebuild = undefined;
        const original = this.stubOriginals.get("auditingDataRebuild");
        if (original === undefined) return false;
        this.sm.disputeManager.getAuditingData =
            original as typeof this.sm.disputeManager.getAuditingData;
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
                contract.getOnChainSlashedParticipants
            );
        }
        Reflect.set(contract, "getOnChainSlashedParticipants", async () => {
            throw new Error("authoritative slash read failed");
        });
    }

    restoreOnChainSlashesRead(): boolean {
        const original = this.stubOriginals.get("onChainSlashesRead");
        if (original === undefined) return false;
        Reflect.set(
            this.sm.stateChannelManagerContract,
            "getOnChainSlashedParticipants",
            original
        );
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
            submission: Omit<RecordedDisputeSubmission, "waited">,
            send: () => Promise<unknown>
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
            const activeFailure = failuresRemaining > 0 ? failure : undefined;
            if (activeFailure) failuresRemaining -= 1;
            if (activeFailure?.at === "send")
                throw this.submissionFailure(activeFailure);
            if (forward && !activeFailure) return send();
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
                auditingData: DisputeAuditingDataStruct
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
                        gasLimit: null
                    },
                    () =>
                        originals.uploadDisputeWithCalldata(
                            confirmation,
                            auditingData
                        )
                )
        );

        contract.multicall = this.asRecordingContractMethod(
            contract.multicall,
            (calls: string[], overrides?: unknown) =>
                record(
                    {
                        ...this.describeMulticall(calls),
                        method: "multicall",
                        gasLimit: this.overrideGasLimit(overrides)
                    },
                    () =>
                        Reflect.apply(originals.multicall, contract, [
                            calls,
                            ...(overrides ? [overrides] : [])
                        ])
                )
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

    public createRPCMethods(transport: ATransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;
