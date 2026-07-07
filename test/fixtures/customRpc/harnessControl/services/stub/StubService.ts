import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { ForkId } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import StubRpcMethods from "./StubRpcMethods";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

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
    | "reducedCommitEvents"
    | "reduceLocally"
    | "spectateSync"
    | "pausedTryReduce"
    | "pausedTryReduceKillPeriod";

export type PausedTryReduceStatus = {
    entered: boolean;
    released: boolean;
    settled: boolean;
    error?: string;
};

export type PausedTryReduceState = PausedTryReduceStatus & {
    targetForkId: ForkId;
    inside: boolean;
    release?: () => void;
    promise?: Promise<unknown>;
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
    readonly heldReducedCommitArgs: unknown[][] = [];
    /** Incremented per `reduceLocally` call by the noop/record stubs. */
    reduceLocallyCallCount = 0;
    /** Incremented per `spectateService.sync` by the record stub. */
    spectateSyncCallCount = 0;
    /** State for the already-entered old-fork reduction race stub. */
    pausedTryReduce?: PausedTryReduceState;

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

    public createRPCMethods(transport: ATransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;
