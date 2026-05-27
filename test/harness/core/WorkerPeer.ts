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
    DebugHandle,
    DisconnectFilterFn,
    LifecycleHandle,
    NamedOpRequest,
    NetworkHandle,
    P2pInternalsHandle,
    PeerHandle,
    ProfileSummary,
    RestoreToken,
    RpcStubHandle,
    RpcStubHandlerFn,
    StubMethodFn,
    SubmitDoubleSignReq,
    TransitionHandle,
    TransportSummary
} from "./PeerHandle";
import type { SpyMirror } from "./SpyMirror";
import type { StubCallbackRegistry } from "./StubCallbackRegistry";
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
    broadcastBlockConfirmation(req: {
        blockConfirmation: unknown;
    }): Promise<void> {
        return this.rpc.call(
            "byzantine.broadcastBlockConfirmation",
            req
        ) as Promise<void>;
    }
}

class WorkerRpcStubHandle implements RpcStubHandle {
    // step 1 - per-handle live ids -> let restoreAll drop the orchestrator-side
    // closures even when the test source only restores via restoreCreateRpcMethodStub
    // (one-slot key) or never restores explicitly.
    private readonly liveCallbackIds = new Map<string, string>();

    constructor(
        private readonly rpc: RpcClient,
        private readonly registry: StubCallbackRegistry
    ) {}

    async installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken> {
        const key = `${serviceName}:${methodName}`;
        // step 1 - replace any prior closure on this slot first so the orchestrator
        // map stays in sync with the worker's single-slot table.
        const prior = this.liveCallbackIds.get(key);
        if (prior) this.registry.unregisterStub(prior);

        // step 2 - register the closure with the per-peer registry; ship the
        // opaque id to the worker. worker calls back via "harness.invokeStubCallback"
        // -> registry dispatches -> closure runs orchestrator-side. `this` is
        // not bound cross-thread; closures that need it can't run in worker mode.
        const id = this.registry.registerStub((args) =>
            (handler as (...a: unknown[]) => unknown)(...args)
        );
        this.liveCallbackIds.set(key, id);
        const token = (await this.rpc.call(
            "rpcStub.installCreateRpcMethodStub",
            { serviceName, methodName, callbackId: id }
        )) as RestoreToken;
        return token;
    }

    async restoreCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
    }): Promise<void> {
        const key = `${req.serviceName}:${req.methodName}`;
        const id = this.liveCallbackIds.get(key);
        if (id) {
            this.registry.unregisterStub(id);
            this.liveCallbackIds.delete(key);
        }
        await this.rpc.call("rpcStub.restoreCreateRpcMethodStub", req);
    }

    async restoreAll(): Promise<void> {
        for (const id of this.liveCallbackIds.values()) {
            this.registry.unregisterStub(id);
        }
        this.liveCallbackIds.clear();
        await this.rpc.call("rpcStub.restoreAll", {});
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

class WorkerDebugHandle implements DebugHandle {
    // step 1 - orchestrator-side token -> callback id map. token id is the
    // worker-returned slot ("debugStub#N"); callback id is the registry handle
    // we drop when the test restores. parallel to WorkerRpcStubHandle.
    private readonly liveCallbackIds = new Map<string, string>();

    constructor(
        private readonly rpc: RpcClient,
        private readonly registry: StubCallbackRegistry
    ) {}

    async stubMethod(path: string, fn: StubMethodFn): Promise<RestoreToken> {
        // step 1 - register closure + ship the opaque id to the worker. worker
        // patches stateManager[<path>] with a stub that calls back via
        // "harness.invokeStubCallback" -> registry runs the closure with args.
        const callbackId = this.registry.registerStub((args) =>
            (fn as (...a: unknown[]) => unknown)(...args)
        );
        const token = (await this.rpc.call("debug.stubMethod", {
            path,
            callbackId
        })) as RestoreToken;
        this.liveCallbackIds.set(token.id, callbackId);
        return token;
    }

    async restoreStubbedMethod(token: RestoreToken): Promise<void> {
        const callbackId = this.liveCallbackIds.get(token.id);
        if (callbackId) {
            this.registry.unregisterStub(callbackId);
            this.liveCallbackIds.delete(token.id);
        }
        await this.rpc.call("debug.restoreStubbedMethod", {
            tokenId: token.id
        });
    }

    async restoreAllStubbedMethods(): Promise<void> {
        for (const id of this.liveCallbackIds.values()) {
            this.registry.unregisterStub(id);
        }
        this.liveCallbackIds.clear();
        await this.rpc.call("debug.restoreAllStubbedMethods", {});
    }
}

class WorkerNetworkHandle implements NetworkHandle {
    // step 1 - single-slot filter id matches the worker route's table.
    private liveCallbackId: string | undefined;

    constructor(
        private readonly rpc: RpcClient,
        private readonly registry: StubCallbackRegistry
    ) {}
    disconnectAll(): Promise<void> {
        return this.rpc.call("network.disconnectAll", {}) as Promise<void>;
    }
    tryOpenConnectionToChannel(channelId: string): Promise<void> {
        return this.rpc.call("network.tryOpenConnectionToChannel", {
            channelId
        }) as Promise<void>;
    }
    async installDisconnectFilter(
        filter: DisconnectFilterFn
    ): Promise<RestoreToken> {
        // step 1 - drop any prior closure -> map stays in sync with worker.
        if (this.liveCallbackId) {
            this.registry.unregisterFilter(this.liveCallbackId);
        }
        const id = this.registry.registerFilter((msg) => filter(msg));
        this.liveCallbackId = id;
        return (await this.rpc.call("network.installDisconnectFilter", {
            callbackId: id
        })) as RestoreToken;
    }
    async restoreDisconnectFilter(): Promise<void> {
        if (this.liveCallbackId) {
            this.registry.unregisterFilter(this.liveCallbackId);
            this.liveCallbackId = undefined;
        }
        await this.rpc.call("network.restoreDisconnectFilter", {});
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
    // step 3 - per-peer closure registry. ships opaque ids for inline closures
    // installed via rpcStub / network filters; worker invokes via callbacks
    // wired in PeerTestHarness.createPeerHandle ("harness.invokeStubCallback"
    // / "harness.invokeFilterCallback") -> registry dispatches to the closure.
    stubCallbackRegistry: StubCallbackRegistry;
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
    readonly debug: DebugHandle;

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
        this.rpcStub = new WorkerRpcStubHandle(
            this.rpc,
            args.stubCallbackRegistry
        );
        this.queryInternals = new WorkerP2pInternalsHandle(this.rpc);
        this.network = new WorkerNetworkHandle(
            this.rpc,
            args.stubCallbackRegistry
        );
        this.transition = new WorkerTransitionHandle(this.rpc);
        this.lifecycle = new WorkerLifecycleHandle(this.rpc);
        this.debug = new WorkerDebugHandle(this.rpc, args.stubCallbackRegistry);
    }

    get forkId(): ForkId | undefined {
        return this.cachedForkId;
    }

    // step 1 - escape hatch for tamper-bridge actions that need to invoke
    // worker-only rpc methods (byzantine.installDisputeTamperHook etc.).
    // narrowed via the `__workerBackend` discriminator on PeerHandle. only
    // those two action sites should reach for this; everything else uses
    // the sub-handles.
    getRpc(): RpcClient {
        return this.rpc;
    }

    queryStatus(): Promise<unknown> {
        return this.rpc.call("query.status", {});
    }
    queryLatestBlock(forkId: ForkId): Promise<unknown> {
        return this.rpc.call("query.latestBlock", { forkId });
    }
    queryBlockAt(req: {
        forkId: ForkId;
        height: number;
    }): Promise<{ hash: string; height: number; author: Address } | undefined> {
        return this.rpc.call("query.blockAt", req) as Promise<
            { hash: string; height: number; author: Address } | undefined
        >;
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
    queryStateSnapshotAt(req: { forkId: ForkId; height: number }): Promise<{
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
    queryIsMyTurn(): Promise<boolean> {
        return this.rpc.call("query.isMyTurn", {}) as Promise<boolean>;
    }
    queryLatestBlockConfirmation(forkId: ForkId): Promise<unknown | undefined> {
        return this.rpc.call("query.latestBlockConfirmation", { forkId });
    }
    queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: number;
    }): Promise<
        { blockConfirmation: unknown; onChainTimestamp?: number } | undefined
    > {
        return this.rpc.call("query.blockConfirmationAt", req) as Promise<
            | { blockConfirmation: unknown; onChainTimestamp?: number }
            | undefined
        >;
    }
    queryBlockByHash(hash: string): Promise<
        | {
              blockConfirmation: unknown;
              onChainTimestamp?: number;
              confirmationSignatures: string[];
          }
        | undefined
    > {
        return this.rpc.call("query.blockByHash", { hash }) as Promise<
            | {
                  blockConfirmation: unknown;
                  onChainTimestamp?: number;
                  confirmationSignatures: string[];
              }
            | undefined
        >;
    }
    queueBlock(req: {
        blockConfirmation: unknown;
        onChainTimestamp?: number;
    }): Promise<void> {
        return this.rpc.call("queue.block", req) as Promise<void>;
    }
    isBlacklisted(addr: Address): Promise<boolean> {
        return this.rpc.call("p2p.isBlacklisted", { addr }) as Promise<boolean>;
    }
    postBlockCalldata(req: {
        signedBlock: unknown;
        maxTimestamp: number;
    }): Promise<void> {
        return this.rpc.call(
            "contract.postBlockCalldata",
            req
        ) as Promise<void>;
    }
    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: number;
    }): Promise<string> {
        return this.rpc.call("query.previousBlockHash", req) as Promise<string>;
    }
    queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: string;
    }): Promise<string> {
        return this.rpc.call(
            "query.stateSnapshotHashForFork",
            req
        ) as Promise<string>;
    }
    queryFraudProofForParticipant(
        addr: string
    ): Promise<{ proofType: number; participant: string } | null> {
        return this.rpc.call("query.fraudProofForParticipant", {
            addr
        }) as Promise<{ proofType: number; participant: string } | null>;
    }
    queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>> {
        return this.rpc.call("query.disputeFraudProofs", {}) as Promise<
            Array<{ proofType: number }>
        >;
    }
    queryInboundLatestBlockHash(): Promise<string | undefined> {
        return this.rpc.call("query.inboundLatestBlockHash", {}) as Promise<
            string | undefined
        >;
    }
    queryInboundLatestBlockHeight(): Promise<number | undefined> {
        return this.rpc.call("query.inboundLatestBlockHeight", {}) as Promise<
            number | undefined
        >;
    }
    storeTimeout(req: { forkId: ForkId; timeout: unknown }): Promise<void> {
        return this.rpc.call("timeout.store", req) as Promise<void>;
    }
    setForceExit(value: boolean): Promise<void> {
        return this.rpc.call("forceExit.set", { value }) as Promise<void>;
    }
    queryTimeoutsForFork(forkId: ForkId): Promise<unknown[]> {
        return this.rpc.call("query.timeoutsForFork", {
            forkId
        }) as Promise<unknown[]>;
    }
    queryTimeoutForFork(forkId: ForkId): Promise<{
        participant: string;
        isForced: boolean;
        blockHeight?: string;
    } | null> {
        return this.rpc.call("query.timeoutForFork", { forkId }) as Promise<{
            participant: string;
            isForced: boolean;
            blockHeight?: string;
        } | null>;
    }
    queryDisputeConfirmation(disputeHash: string): Promise<unknown | null> {
        return this.rpc.call("query.disputeConfirmation", {
            disputeHash
        }) as Promise<unknown | null>;
    }
    queryOpenDisputeForkIds(): Promise<string[]> {
        return this.rpc.call("query.openDisputeForkIds", {}) as Promise<
            string[]
        >;
    }
    computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: string;
        lowerBlockHash?: string;
    }): Promise<{ amount: string; data: string }> {
        return this.rpc.call(
            "context.computeExpectedWithdrawalsDelta",
            req
        ) as Promise<{ amount: string; data: string }>;
    }
    queryLastMilestoneSnapshot(forkId: ForkId): Promise<unknown | undefined> {
        return this.rpc.call("query.lastMilestoneSnapshot", { forkId });
    }
    subtractBalance(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<{ amount: string; data: string }> {
        return this.rpc.call("balance.subtract", req) as Promise<{
            amount: string;
            data: string;
        }>;
    }
    areBalancesEqual(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<boolean> {
        return this.rpc.call("balance.areEqual", req) as Promise<boolean>;
    }
    queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: number;
    }): Promise<unknown | null> {
        return this.rpc.call("query.previousStateSnapshot", req);
    }
    constructDispute(forkId: ForkId): Promise<{
        dispute: unknown;
        disputeConfirmation: unknown;
        auditingData: unknown;
        fraudProofsToApply: unknown[];
    }> {
        return this.rpc.call("dispute.construct", { forkId }) as Promise<{
            dispute: unknown;
            disputeConfirmation: unknown;
            auditingData: unknown;
            fraudProofsToApply: unknown[];
        }>;
    }
    queryGenesisSnapshot(forkId: ForkId): Promise<unknown | null> {
        return this.rpc.call("query.genesisSnapshot", { forkId });
    }
    queryDisputeAuditingData(req: {
        forkId: ForkId;
        args?: unknown[];
    }): Promise<unknown> {
        return this.rpc.call("dispute.getAuditingData", req);
    }
    queryLatestBlockFromStateProof(stateProof: unknown): Promise<{
        hasBlock: boolean;
        latestBlock: {
            transaction: {
                header: { transactionCnt: bigint | number | string };
            };
        } & Record<string, unknown>;
    }> {
        return this.rpc.call("dispute.latestBlockFromStateProof", {
            stateProof
        }) as Promise<{
            hasBlock: boolean;
            latestBlock: {
                transaction: {
                    header: { transactionCnt: bigint | number | string };
                };
            } & Record<string, unknown>;
        }>;
    }
    queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<unknown[]> {
        return this.rpc.call("dispute.windows", req) as Promise<unknown[]>;
    }
    queryLocalStateSnapshot(channelId: string): Promise<unknown> {
        return this.rpc.call("dispute.localStateSnapshot", {
            channelId
        }) as Promise<unknown>;
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
