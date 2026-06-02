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
import type { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";

import type { PeerCaller } from "../threaded/rpc/rpc-client";

import type { Bytes, Status, Timestamp } from "@/types";
import type {
    BlockConfirmationStruct,
    BlockStruct,
    BlockStructOutput,
    MessageBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeWindowStructOutput,
    StateProofStruct
} from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    MilestoneProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type {
    ByzantineInterface,
    StubInterface,
    LifecycleInterface,
    NetworkInterface,
    P2pInternalsInterface,
    PeerHandle,
    RpcStubInterface,
    TransitionInterface
} from "./PeerHandle";
import type { SpyMirror } from "./SpyMirror";
import type { StubCallbackRegistry } from "./StubCallbackRegistry";
import type { EventSpies } from "./types";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";
import { WorkerByzantineHandle } from "./worker/byzantineHandle";
import { WorkerRpcStubHandle } from "./worker/rpcStubHandle";
import { WorkerP2pInternalsHandle } from "./worker/queryInternalsHandle";
import { WorkerTransitionHandle } from "./worker/transitionHandle";
import { WorkerLifecycleHandle } from "./worker/lifecycleHandle";
import { WorkerStubHandle } from "./worker/stubHandle";
import { WorkerNetworkHandle } from "./worker/networkHandle";

export type WorkerPeerCtorArgs = {
    index: number;
    address: string;
    signer: Signer;
    logger: Logger;
    eventSpies: EventSpies;
    turnBarrier: EventBarrier;
    rpc: PeerCaller;
    // step 1 - W4 spy mirror. orchestrator-owned; worker bumps land via the
    // "spy" push topic. harness owns construction + ingest wiring.
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
    readonly address: string;
    readonly signer: Signer;
    readonly logger: Logger;
    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;
    readonly byzantine: ByzantineInterface;
    readonly rpcStub: RpcStubInterface;
    readonly queryInternals: P2pInternalsInterface;
    readonly network: NetworkInterface;
    readonly transition: TransitionInterface;
    readonly lifecycle: LifecycleInterface;
    readonly stub: StubInterface;

    // step 1 - cached scalar (D-12). worker pushes `fork.changed` post-p2pSetup
    // (W5-blocked); until then the value stays undefined and any test reading
    // it gets the same "no fork yet" semantics today's inline path has at
    // startup. W4 push channel is wired; only the worker-side emit is deferred.
    private cachedForkId: ForkId | undefined = undefined;

    private readonly rpc: PeerCaller;
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
        this.stub = new WorkerStubHandle(this.rpc, args.stubCallbackRegistry);
    }

    get forkId(): ForkId | undefined {
        return this.cachedForkId;
    }

    // step 1 - escape hatch for tamper-bridge actions that need to invoke
    // worker-only rpc methods (byzantine.installDisputeTamperHook etc.).
    // narrowed via the `__workerBackend` discriminator on PeerHandle. only
    // those two action sites should reach for this; everything else uses
    // the sub-handles.
    getRpc(): PeerCaller {
        return this.rpc;
    }

    queryStatus(): Promise<Status> {
        return this.rpc.call(ROUTES.query.status, {}) as Promise<Status>;
    }
    queryLatestBlock(
        forkId: ForkId
    ): Promise<{ hash: Hash; height: BlockHeight } | undefined> {
        return this.rpc.call(ROUTES.query.latestBlock, { forkId }) as Promise<
            { hash: Hash; height: BlockHeight } | undefined
        >;
    }
    queryBlockAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        { hash: Hash; height: BlockHeight; author: Address } | undefined
    > {
        return this.rpc.call(ROUTES.query.blockAt, req) as Promise<
            { hash: Hash; height: BlockHeight; author: Address } | undefined
        >;
    }
    queryNextToWrite(): Promise<Address> {
        return this.rpc.call(ROUTES.query.nextToWrite, {}) as Promise<Address>;
    }
    queryParticipants(): Promise<Address[]> {
        return this.rpc.call(ROUTES.query.participants, {}) as Promise<
            Address[]
        >;
    }
    queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean> {
        return this.rpc.call(ROUTES.query.didEveryoneSignBlock, {
            blockHash
        }) as Promise<boolean>;
    }
    queryLatestStateMachineStateHash(forkId: ForkId): Promise<Hash | null> {
        return this.rpc.call(ROUTES.query.latestStateMachineStateHash, {
            forkId
        }) as Promise<Hash | null>;
    }
    queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight> {
        return this.rpc.call(ROUTES.query.nextBlockHeight, {
            forkId
        }) as Promise<BlockHeight>;
    }
    queryStateSnapshotAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<{
        hash: Hash;
        stateMachineStateHash: Hash;
        blockHeight: BlockHeight;
    } | null> {
        return this.rpc.call(ROUTES.query.stateSnapshotAt, req) as Promise<{
            hash: Hash;
            stateMachineStateHash: Hash;
            blockHeight: BlockHeight;
        } | null>;
    }
    queryStateMachineState(hash: Hash): Promise<Bytes | null> {
        return this.rpc.call(ROUTES.query.stateMachineState, {
            hash
        }) as Promise<Bytes | null>;
    }
    queryStateSnapshotCount(): Promise<number> {
        return this.rpc.call(
            ROUTES.query.stateSnapshotCount,
            {}
        ) as Promise<number>;
    }
    queryIsMyTurn(): Promise<boolean> {
        return this.rpc.call(ROUTES.query.isMyTurn, {}) as Promise<boolean>;
    }
    queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<BlockConfirmationStruct | undefined> {
        return this.rpc.call(ROUTES.query.latestBlockConfirmation, {
            forkId
        }) as Promise<BlockConfirmationStruct | undefined>;
    }
    queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
          }
        | undefined
    > {
        return this.rpc.call(ROUTES.query.blockConfirmationAt, req) as Promise<
            | {
                  blockConfirmation: BlockConfirmationStruct;
                  onChainTimestamp?: Timestamp;
              }
            | undefined
        >;
    }
    queryBlockByHash(hash: Hash): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
              confirmationSignatures: string[];
          }
        | undefined
    > {
        return this.rpc.call(ROUTES.query.blockByHash, { hash }) as Promise<
            | {
                  blockConfirmation: BlockConfirmationStruct;
                  onChainTimestamp?: Timestamp;
                  confirmationSignatures: string[];
              }
            | undefined
        >;
    }
    queueBlock(req: {
        blockConfirmation: BlockConfirmationStruct;
        onChainTimestamp?: Timestamp;
    }): Promise<void> {
        return this.rpc.call(ROUTES.queue.block, req) as Promise<void>;
    }
    isBlacklisted(addr: Address): Promise<boolean> {
        return this.rpc.call(ROUTES.p2p.isBlacklisted, {
            addr
        }) as Promise<boolean>;
    }
    postBlockCalldata(req: {
        signedBlock: SignedBlockStruct;
        maxTimestamp: Timestamp;
    }): Promise<void> {
        return this.rpc.call(
            ROUTES.contract.postBlockCalldata,
            req
        ) as Promise<void>;
    }
    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash> {
        return this.rpc.call(
            ROUTES.query.previousBlockHash,
            req
        ) as Promise<Hash>;
    }
    queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: Hash;
    }): Promise<Hash> {
        return this.rpc.call(
            ROUTES.query.stateSnapshotHashForFork,
            req
        ) as Promise<Hash>;
    }
    queryFraudProofForParticipant(
        addr: Address
    ): Promise<{ proofType: number; participant: Address } | null> {
        return this.rpc.call(ROUTES.query.fraudProofForParticipant, {
            addr
        }) as Promise<{
            proofType: number;
            participant: Address;
        } | null>;
    }
    queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>> {
        return this.rpc.call(ROUTES.query.disputeFraudProofs, {}) as Promise<
            Array<{ proofType: number }>
        >;
    }
    queryInboundLatestBlockHash(): Promise<Hash | undefined> {
        return this.rpc.call(
            ROUTES.query.inboundLatestBlockHash,
            {}
        ) as Promise<Hash | undefined>;
    }
    queryInboundLatestBlockHeight(): Promise<BlockHeight | undefined> {
        return this.rpc.call(
            ROUTES.query.inboundLatestBlockHeight,
            {}
        ) as Promise<BlockHeight | undefined>;
    }
    storeTimeout(req: {
        forkId: ForkId;
        timeout: TimeoutStruct;
    }): Promise<void> {
        return this.rpc.call(ROUTES.timeout.store, req) as Promise<void>;
    }
    setForceExit(value: boolean): Promise<void> {
        return this.rpc.call(ROUTES.forceExit.set, { value }) as Promise<void>;
    }
    queryTimeoutForFork(forkId: ForkId): Promise<TimeoutStruct | null> {
        return this.rpc.call(ROUTES.query.timeoutForFork, {
            forkId
        }) as Promise<TimeoutStruct | null>;
    }
    queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | null> {
        return this.rpc.call("query.disputeConfirmation", {
            disputeHash
        }) as Promise<DisputeConfirmationStruct | null>;
    }
    computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: Hash;
        lowerBlockHash?: Hash;
    }): Promise<{ amount: string; data: string }> {
        return this.rpc.call(
            "context.computeExpectedWithdrawalsDelta",
            req
        ) as Promise<{ amount: string; data: string }>;
    }
    queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call("query.lastMilestoneSnapshot", {
            forkId
        }) as Promise<StateSnapshotStruct | undefined>;
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
        height: BlockHeight;
    }): Promise<StateSnapshotStruct | null> {
        return this.rpc.call(
            "query.previousStateSnapshot",
            req
        ) as Promise<StateSnapshotStruct | null>;
    }
    constructDispute(forkId: ForkId): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
        auditingData: DisputeAuditingDataStruct;
        fraudProofsToApply: FraudProofStruct[];
    }> {
        return this.rpc.call("dispute.construct", { forkId }) as Promise<{
            dispute: DisputeStruct;
            disputeConfirmation: DisputeConfirmationStruct;
            auditingData: DisputeAuditingDataStruct;
            fraudProofsToApply: FraudProofStruct[];
        }>;
    }
    queryGenesisSnapshot(forkId: ForkId): Promise<StateSnapshotStruct | null> {
        return this.rpc.call("query.genesisSnapshot", {
            forkId
        }) as Promise<StateSnapshotStruct | null>;
    }
    queryStateSnapshotByHash(hash: Hash): Promise<StateSnapshotStruct | null> {
        return this.rpc.call("query.stateSnapshotByHash", {
            hash
        }) as Promise<StateSnapshotStruct | null>;
    }
    queryOutboundMessageBlock(hash: Hash): Promise<MessageBlockStruct | null> {
        return this.rpc.call("query.outboundMessageBlock", {
            hash
        }) as Promise<MessageBlockStruct | null>;
    }
    queryDisputeAuditingData(req: {
        forkId: ForkId;
        args?: unknown[];
    }): Promise<DisputeAuditingDataStruct> {
        return this.rpc.call(
            "dispute.getAuditingData",
            req
        ) as Promise<DisputeAuditingDataStruct>;
    }
    queryLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{ hasBlock: boolean; latestBlock: BlockStruct }> {
        return this.rpc.call("dispute.latestBlockFromStateProof", {
            stateProof
        }) as Promise<{ hasBlock: boolean; latestBlock: BlockStruct }>;
    }
    queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<DisputeWindowStructOutput[]> {
        return this.rpc.call("dispute.windows", req) as Promise<
            DisputeWindowStructOutput[]
        >;
    }
    queryLocalStateSnapshot(channelId: string): Promise<StateSnapshotStruct> {
        return this.rpc.call("dispute.localStateSnapshot", {
            channelId
        }) as Promise<StateSnapshotStruct>;
    }
    postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        return this.rpc.call("snapshot.post", { forkId }) as Promise<
            StateSnapshotStruct | undefined
        >;
    }
    prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshotStruct;
              milestoneSnapshots: StateSnapshotStruct[];
              milestoneProofs: MilestoneProofStruct[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        return this.rpc.call("snapshot.prepareSameFork", { forkId }) as Promise<
            | {
                  callData: string[];
                  expectedSnapshot: StateSnapshotStruct;
                  milestoneSnapshots: StateSnapshotStruct[];
                  milestoneProofs: MilestoneProofStruct[];
                  outboundMessageBlocks: MessageBlockStruct[];
              }
            | undefined
        >;
    }
    applyTransaction(
        req: TransactionStruct
    ): Promise<{ success: boolean; encodedState: Bytes }> {
        return this.rpc.call("tx.apply", req) as Promise<{
            success: boolean;
            encodedState: Bytes;
        }>;
    }
    ingestBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: { onChainTimestamp?: Timestamp };
    }): Promise<boolean> {
        return this.rpc.call(
            "ingest.blockConfirmation",
            req
        ) as Promise<boolean>;
    }

    async dispose(): Promise<void> {
        // step 1 - drive lifecycle rpc, then hand off to PeerWorker.dispose
        // which terminates the underlying node Worker.
        try {
            await this.rpc.call(ROUTES.lifecycle.dispose, {});
        } catch {
            // step 1 - rpc may already be torn down; force-path picks up.
        }
        await this._onDispose();
    }
}
