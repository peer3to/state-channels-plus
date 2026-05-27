// W1 - WorkerPeer backend. rpc proxy over the W3 kernel; sub-handles forward
// {method, args} to fixed worker-side handlers. one rpc method per existing
// inline action surface (D-23).
//
// scoping for this session: orchestrator-side WorkerPeer scaffolding exists
// and forwards to W3. worker-side route handlers (rpc method registration)
// are stubbed until next agent wires (a) the per-action worker handler tables
// and (b) the named-op registry. tests that exercise these end-to-end are
// W5-blocked anyway (worker-side chain access).

import type { Signer } from "ethers";
import type { Address, ForkId } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";

import type { RpcClient } from "../threaded/rpc/rpc-client";
import { LIFECYCLE_RPC } from "../threaded/worker/types";
import { SPY_RESET_RPC } from "../threaded/worker/SpyRegistry";
import { TRANSITION_RUN_OP } from "../threaded/worker/opRoutes";
import { rejectLambdaArgs } from "./namedOpGuards";
import type {
    ByzantineHandle,
    LifecycleHandle,
    NamedOpRequest,
    NetworkHandle,
    P2pInternalsHandle,
    PeerHandle,
    ProfileSummary,
    RestoreToken,
    RpcStubHandle,
    SubmitDoubleSignReq,
    TransitionHandle,
    TransportSummary
} from "./PeerHandle";
import type { SpyMirror } from "./SpyMirror";
import type { EventSpies } from "./types";

// step 1 - sub-handle implementations forward to W3 rpc. route ids follow
// the convention `<sub-handle>.<method>` per W1 §5. worker-side handlers
// are registered by W2's bundle-manifest pattern (next agent ships those).

class WorkerByzantineHandle implements ByzantineHandle {
    constructor(private readonly rpc: RpcClient) {}
    stubCalldataHandler(): Promise<void> {
        return this.rpc.call(
            "byzantine.stubCalldataHandler",
            {}
        ) as Promise<void>;
    }
    restoreCalldataHandler(): Promise<void> {
        return this.rpc.call(
            "byzantine.restoreCalldataHandler",
            {}
        ) as Promise<void>;
    }
    stubPendingInboundInclusion(): Promise<void> {
        return this.rpc.call(
            "byzantine.stubPendingInboundInclusion",
            {}
        ) as Promise<void>;
    }
    restorePendingInboundInclusion(): Promise<void> {
        return this.rpc.call(
            "byzantine.restorePendingInboundInclusion",
            {}
        ) as Promise<void>;
    }
    stubBroadcast(): Promise<void> {
        return this.rpc.call("byzantine.stubBroadcast", {}) as Promise<void>;
    }
    submitDoubleSignBlock(req: SubmitDoubleSignReq): Promise<void> {
        return this.rpc.call(
            "byzantine.submitDoubleSignBlock",
            req
        ) as Promise<void>;
    }
}

class WorkerRpcStubHandle implements RpcStubHandle {
    constructor(private readonly rpc: RpcClient) {}
    installCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
        handlerId: string;
        handlerArgs?: unknown;
    }): Promise<RestoreToken> {
        return this.rpc.call(
            "rpcStub.installCreateRpcMethodStub",
            req
        ) as Promise<RestoreToken>;
    }
    restoreCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
    }): Promise<void> {
        return this.rpc.call(
            "rpcStub.restoreCreateRpcMethodStub",
            req
        ) as Promise<void>;
    }
    restoreAll(): Promise<void> {
        return this.rpc.call("rpcStub.restoreAll", {}) as Promise<void>;
    }
}

class WorkerP2pInternalsHandle implements P2pInternalsHandle {
    constructor(private readonly rpc: RpcClient) {}
    openConnections(): Promise<TransportSummary[]> {
        return this.rpc.call("queryInternals.openConnections", {}) as Promise<
            TransportSummary[]
        >;
    }
    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined> {
        return this.rpc.call("queryInternals.getProfileByEvmAddress", {
            addr
        }) as Promise<ProfileSummary | undefined>;
    }
    getProfileByConnectionId(
        connectionId: string
    ): Promise<ProfileSummary | undefined> {
        return this.rpc.call("queryInternals.getProfileByConnectionId", {
            connectionId
        }) as Promise<ProfileSummary | undefined>;
    }
    connectionCount(): Promise<number> {
        return this.rpc.call(
            "queryInternals.connectionCount",
            {}
        ) as Promise<number>;
    }
    isHandshakeCompletedWith(otherAddr: Address): Promise<boolean> {
        return this.rpc.call("queryInternals.isHandshakeCompletedWith", {
            otherAddr
        }) as Promise<boolean>;
    }
    self(): Promise<Address> {
        return this.rpc.call("queryInternals.self", {}) as Promise<Address>;
    }
    isForkDisputedService(req: {
        op: string;
        args: unknown;
    }): Promise<unknown> {
        return this.rpc.call("queryInternals.isForkDisputedService", req);
    }
    initHandshakeService(req: { op: string; args: unknown }): Promise<unknown> {
        return this.rpc.call("queryInternals.initHandshakeService", req);
    }
    callServiceWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown> {
        return this.rpc.call("queryInternals.callServiceWithTransport", req);
    }
    callServiceMethodWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown> {
        return this.rpc.call(
            "queryInternals.callServiceMethodWithTransport",
            req
        );
    }
    getPreferredTransportType(): Promise<number> {
        return this.rpc.call(
            "queryInternals.getPreferredTransportType",
            {}
        ) as Promise<number>;
    }
    getInitChallenge(otherAddr: Address): Promise<
        | {
              randomChallengeHash: string;
              initTime: number;
          }
        | undefined
    > {
        return this.rpc.call("queryInternals.getInitChallenge", {
            otherAddr
        }) as Promise<
            { randomChallengeHash: string; initTime: number } | undefined
        >;
    }
    clearInitChallenge(otherAddr: Address): Promise<void> {
        return this.rpc.call("queryInternals.clearInitChallenge", {
            otherAddr
        }) as Promise<void>;
    }
    getTransportStatus(
        otherAddr: Address
    ): Promise<{ present: boolean; isClosed?: boolean }> {
        return this.rpc.call("queryInternals.getTransportStatus", {
            otherAddr
        }) as Promise<{ present: boolean; isClosed?: boolean }>;
    }
}

class WorkerTransitionHandle implements TransitionHandle {
    constructor(private readonly rpc: RpcClient) {}
    submitNext(req: NamedOpRequest): Promise<unknown> {
        rejectLambdaArgs("WorkerPeer.transition.submitNext", req);
        return this.rpc.call(TRANSITION_RUN_OP, {
            op: req.op,
            args: req.args
        });
    }
}

class WorkerLifecycleHandle implements LifecycleHandle {
    constructor(private readonly rpc: RpcClient) {}
    connectToChannel(channelId: string): Promise<void> {
        return this.rpc.call("lifecycle.connectToChannel", {
            channelId
        }) as Promise<void>;
    }
    joinChannel(req: {
        confirmation: unknown;
        expectedSnapshotHash: string;
    }): Promise<void> {
        return this.rpc.call("lifecycle.joinChannel", req) as Promise<void>;
    }
}

class WorkerNetworkHandle implements NetworkHandle {
    constructor(private readonly rpc: RpcClient) {}
    disconnectAll(): Promise<void> {
        return this.rpc.call("network.disconnectAll", {}) as Promise<void>;
    }
    tryOpenConnectionToChannel(channelId: string): Promise<void> {
        return this.rpc.call("network.tryOpenConnectionToChannel", {
            channelId
        }) as Promise<void>;
    }
    installDisconnectFilter(req: {
        filterId: string;
        args?: unknown;
    }): Promise<RestoreToken> {
        return this.rpc.call(
            "network.installDisconnectFilter",
            req
        ) as Promise<RestoreToken>;
    }
    restoreDisconnectFilter(): Promise<void> {
        return this.rpc.call(
            "network.restoreDisconnectFilter",
            {}
        ) as Promise<void>;
    }
}

export type WorkerPeerCtorArgs = {
    index: number;
    address: Address;
    signer: Signer;
    logger: Logger;
    eventSpies: EventSpies;
    turnBarrier: EventBarrier;
    rpc: RpcClient;
    // step 1 - W4 spy mirror. orchestrator-owned; worker bumps land via the
    // "spy" push topic; WorkerPeer.resetSpies clears the row after the rpc
    // round-trip resolves (§reset). harness owns construction + ingest wiring.
    mirror: SpyMirror;
    // step 2 - dispose-the-worker hook. WorkerPeer.dispose() drives the
    // lifecycle.dispose rpc; the underlying PeerWorker.dispose terminates the
    // node Worker. wiring lives in PeerTestHarness.createPeer.
    onDispose: () => Promise<void>;
};

export class WorkerPeer implements PeerHandle {
    // step 1 - structural marker for rejectClosureInWorkerMode. avoids
    // importing WorkerPeer in action classes / namedOpGuards (no cycle).
    readonly __workerBackend = true as const;

    readonly index: number;
    readonly address: Address;
    readonly signer: Signer;
    readonly logger: Logger;
    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;
    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;
    readonly transition: TransitionHandle;
    readonly lifecycle: LifecycleHandle;

    // step 1 - cached scalar (D-12). worker pushes `fork.changed` post-p2pSetup
    // (W5-blocked); until then the value stays undefined and any test reading
    // it gets the same "no fork yet" semantics today's inline path has at
    // startup. W4 push channel is wired; only the worker-side emit is deferred.
    private cachedForkId: ForkId | undefined = undefined;

    private readonly rpc: RpcClient;
    private readonly mirror: SpyMirror;
    private readonly _onDispose: () => Promise<void>;

    constructor(args: WorkerPeerCtorArgs) {
        this.index = args.index;
        this.address = args.address;
        this.signer = args.signer;
        this.logger = args.logger;
        this.eventSpies = args.eventSpies;
        this.turnBarrier = args.turnBarrier;
        this.rpc = args.rpc;
        this.mirror = args.mirror;
        this._onDispose = args.onDispose;

        // step 1 - subscribe to W4 push for cached scalars. W4 isn't shipped
        // yet so the listener won't fire; safe to register so the seam is
        // visible.
        this.rpc.on("fork.changed", (payload) => {
            const fid = (payload as { forkId?: ForkId }).forkId;
            if (fid !== undefined) this.cachedForkId = fid;
        });

        this.byzantine = new WorkerByzantineHandle(this.rpc);
        this.rpcStub = new WorkerRpcStubHandle(this.rpc);
        this.queryInternals = new WorkerP2pInternalsHandle(this.rpc);
        this.network = new WorkerNetworkHandle(this.rpc);
        this.transition = new WorkerTransitionHandle(this.rpc);
        this.lifecycle = new WorkerLifecycleHandle(this.rpc);
    }

    get forkId(): ForkId | undefined {
        return this.cachedForkId;
    }

    queryStatus(): Promise<unknown> {
        return this.rpc.call("query.status", {});
    }
    queryLatestBlock(forkId: ForkId): Promise<unknown> {
        return this.rpc.call("query.latestBlock", { forkId });
    }
    queryNextToWrite(): Promise<Address> {
        return this.rpc.call("query.nextToWrite", {}) as Promise<Address>;
    }
    queryParticipants(): Promise<Address[]> {
        return this.rpc.call("query.participants", {}) as Promise<Address[]>;
    }
    queryDidEveryoneSignBlock(blockHash: string): Promise<boolean> {
        return this.rpc.call("query.didEveryoneSignBlock", {
            blockHash
        }) as Promise<boolean>;
    }
    queryLatestStateMachineStateHash(forkId: ForkId): Promise<string | null> {
        return this.rpc.call("query.latestStateMachineStateHash", {
            forkId
        }) as Promise<string | null>;
    }
    queryNextBlockHeight(forkId: ForkId): Promise<number> {
        return this.rpc.call("query.nextBlockHeight", {
            forkId
        }) as Promise<number>;
    }
    queryStateSnapshotAt(req: {
        forkId: ForkId;
        height: number;
    }): Promise<{
        hash: string;
        stateMachineStateHash: string;
        blockHeight: number;
    } | null> {
        return this.rpc.call("query.stateSnapshotAt", req) as Promise<{
            hash: string;
            stateMachineStateHash: string;
            blockHeight: number;
        } | null>;
    }
    queryStateMachineState(hash: string): Promise<string | null> {
        return this.rpc.call("query.stateMachineState", { hash }) as Promise<
            string | null
        >;
    }
    queryStateSnapshotCount(): Promise<number> {
        return this.rpc.call("query.stateSnapshotCount", {}) as Promise<number>;
    }
    postStateSnapshot(forkId: ForkId): Promise<unknown> {
        return this.rpc.call("snapshot.post", { forkId });
    }
    prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: unknown;
              milestoneSnapshots: unknown[];
              milestoneProofs?: unknown[];
              outboundMessageBlocks?: unknown[];
          }
        | undefined
    > {
        return this.rpc.call("snapshot.prepareSameFork", {
            forkId
        }) as Promise<
            | {
                  callData: string[];
                  expectedSnapshot: unknown;
                  milestoneSnapshots: unknown[];
                  milestoneProofs?: unknown[];
                  outboundMessageBlocks?: unknown[];
              }
            | undefined
        >;
    }
    queryStorageSnapshot(req: unknown): Promise<unknown> {
        return this.rpc.call("query.storageSnapshot", req);
    }
    applyTransaction(req: unknown): Promise<unknown> {
        return this.rpc.call("tx.apply", req);
    }
    ingestBlockConfirmation(req: unknown): Promise<boolean> {
        return this.rpc.call(
            "ingest.blockConfirmation",
            req
        ) as Promise<boolean>;
    }

    async dispose(): Promise<void> {
        // step 1 - drive lifecycle rpc, then hand off to PeerWorker.dispose
        // which terminates the underlying node Worker.
        try {
            await this.rpc.call(LIFECYCLE_RPC.dispose, {});
        } catch {
            // step 1 - rpc may already be torn down; force-path picks up.
        }
        await this._onDispose();
    }

    // step 1 - W4 §reset. two-step locked here: rpc round-trip flushes prior
    // pushes through the fifo + clears the worker's counter map; then we zero
    // the orchestrator row. any post-reset pushes overwrite via max() in
    // SpyMirror.ingest. nothing else may call mirror.noteReset or the rpc
    // directly (invariant declared in W4 §reset).
    async resetSpies(): Promise<void> {
        await this.rpc.call(SPY_RESET_RPC, {});
        this.mirror.noteReset(this.index);
    }
}
