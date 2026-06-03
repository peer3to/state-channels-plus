import type { Signer } from "ethers";
import type { ForkId } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";

import type { PeerCaller } from "../threaded/rpc/rpc-client";

import type {
    ByzantineInterface,
    StubInterface,
    LifecycleInterface,
    NetworkInterface,
    P2pInternalsInterface,
    PeerHandle,
    RpcStubInterface,
    TransitionInterface,
    BlocksInterface,
    ChannelInterface,
    SnapshotInterface,
    StateMachineInterface,
    DisputeInterface,
    BalanceInterface
} from "./PeerHandle";
import type { StubCallbackRegistry } from "./StubCallbackRegistry";
import type { EventSpies } from "./types";
import { ROUTES, PUSH_TOPICS } from "@test/harness/threaded/worker/routeNames";
import { WorkerByzantineHandle } from "./worker/byzantineHandle";
import { WorkerRpcStubHandle } from "./worker/rpcStubHandle";
import { WorkerP2pInternalsHandle } from "./worker/queryInternalsHandle";
import { WorkerTransitionHandle } from "./worker/transitionHandle";
import { WorkerLifecycleHandle } from "./worker/lifecycleHandle";
import { WorkerStubHandle } from "./worker/stubHandle";
import { WorkerNetworkHandle } from "./worker/networkHandle";
import { WorkerBlocksHandle } from "./worker/blocksHandle";
import { WorkerChannelHandle } from "./worker/channelHandle";
import { WorkerSnapshotHandle } from "./worker/snapshotHandle";
import { WorkerStateMachineHandle } from "./worker/stateMachineHandle";
import { WorkerDisputeHandle } from "./worker/disputeHandle";
import { WorkerBalanceHandle } from "./worker/balanceHandle";

export class WorkerPeer implements PeerHandle {
    // Backend discriminator for rejectClosureInWorkerMode (avoids import cycles).
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
    readonly blocks: BlocksInterface;
    readonly channel: ChannelInterface;
    readonly snapshots: SnapshotInterface;
    readonly stateMachine: StateMachineInterface;
    readonly dispute: DisputeInterface;
    readonly balance: BalanceInterface;

    // Updated from fork.changed push; undefined until p2pSetup completes.
    private cachedForkId: ForkId | undefined = undefined;

    private readonly rpc: PeerCaller;
    private readonly _onDispose: () => Promise<void>;

    constructor(
        index: number,
        address: string,
        signer: Signer,
        logger: Logger,
        eventSpies: EventSpies,
        turnBarrier: EventBarrier,
        rpc: PeerCaller,
        stubCallbackRegistry: StubCallbackRegistry,
        onDispose: () => Promise<void>
    ) {
        this.index = index;
        this.address = address;
        this.signer = signer;
        this.logger = logger;
        this.eventSpies = eventSpies;
        this.turnBarrier = turnBarrier;
        this.rpc = rpc;
        this._onDispose = onDispose;

        this.rpc.on(PUSH_TOPICS.forkChanged, (payload) => {
            const fid = (payload as { forkId?: ForkId }).forkId;
            if (fid !== undefined) this.cachedForkId = fid;
        });

        this.byzantine = new WorkerByzantineHandle(this.rpc);
        this.rpcStub = new WorkerRpcStubHandle(this.rpc, stubCallbackRegistry);
        this.queryInternals = new WorkerP2pInternalsHandle(this.rpc);
        this.network = new WorkerNetworkHandle(this.rpc, stubCallbackRegistry);
        this.transition = new WorkerTransitionHandle(this.rpc);
        this.lifecycle = new WorkerLifecycleHandle(this.rpc);
        this.stub = new WorkerStubHandle(this.rpc, stubCallbackRegistry);
        this.blocks = new WorkerBlocksHandle(this.rpc);
        this.channel = new WorkerChannelHandle(this.rpc);
        this.snapshots = new WorkerSnapshotHandle(this.rpc);
        this.stateMachine = new WorkerStateMachineHandle(this.rpc);
        this.dispute = new WorkerDisputeHandle(this.rpc);
        this.balance = new WorkerBalanceHandle(this.rpc);
    }

    get forkId(): ForkId | undefined {
        return this.cachedForkId;
    }

    // Direct rpc access for tamper-bridge and other worker-only routes.
    getRpc(): PeerCaller {
        return this.rpc;
    }

    async dispose(): Promise<void> {
        try {
            await this.rpc.call(ROUTES.lifecycle.dispose, {});
        } catch {
            // lifecycle.dispose rpc may already be torn down.
        }
        await this._onDispose();
    }
}
