import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import StubRpcMethods from "./StubRpcMethods";
import { id, Log } from "ethers";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

type DisputeCommittedEventKey = string;

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
    | "disputeInitiation"
    | "reducedCommitEvents"
    | "reduce"
    | "reductionSimulation"
    | "finalDisputePreparation"
    | "spectateSync"
    | "pausedReduction"
    | "pausedReductionKillPeriod";

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

export type EventSyncFailureProbe = {
    samePromise: boolean;
    handlerCallCount: number;
    firstError: string | null;
    secondError: string | null;
    cursorBefore: number | null;
    cursorAfter: number | null;
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
    /** Event arg-tuples captured by the hold-event stubs. */
    readonly heldSnapshotUpdatedArgs: unknown[][] = [];
    readonly heldDisputeCommittedArgs: unknown[][] = [];
    readonly passedDisputeCommittedEventKeys =
        new Set<DisputeCommittedEventKey>();
    /** Whether the dispute-event hold stub should pass its first new log. */
    passFirstDisputeCommittedEvent = true;
    readonly heldReducedCommitArgs: unknown[][] = [];
    /** Incremented per `ReductionManager.tryReduce` call by the noop/record stubs. */
    reduceCallCount = 0;
    /** Incremented per `spectateService.sync` by the record stub. */
    spectateSyncCallCount = 0;
    /** State for the already-entered old-fork reduction race stub. */
    pausedReduction?: PausedReductionState;

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
            return {
                samePromise: first === second,
                handlerCallCount,
                firstError,
                secondError,
                cursorBefore,
                cursorAfter:
                    sm.storage.eventSync.getLatestProcessedBlock(
                        sm.channelId
                    ) ?? null
            };
        } finally {
            eventHandler.onStateSnapshotUpdated = original;
        }
    }

    public createRPCMethods(transport: ATransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;
