import type { ForkId } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import type { Signer } from "ethers";
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
import type { EventSpies, TestPeer } from "./types";

import { InlineByzantineHandle } from "./inline/byzantineHandle";
import { InlineRpcStubHandle } from "./inline/rpcStubHandle";
import { InlineP2pInternalsHandle } from "./inline/queryInternalsHandle";
import { InlineTransitionHandle } from "./inline/transitionHandle";
import { InlineLifecycleHandle } from "./inline/lifecycleHandle";
import { InlineNetworkHandle } from "./inline/networkHandle";
import { InlineStubHandle } from "./inline/stubHandle";
import { InlineBlocksHandle } from "./inline/blocksHandle";
import { InlineChannelHandle } from "./inline/channelHandle";
import { InlineSnapshotHandle } from "./inline/snapshotHandle";
import { InlineStateMachineHandle } from "./inline/stateMachineHandle";
import { InlineDisputeHandle } from "./inline/disputeHandle";
import { InlineBalanceHandle } from "./inline/balanceHandle";

export class InlinePeer implements PeerHandle {
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

    constructor(public readonly peer: TestPeer) {
        this.byzantine = new InlineByzantineHandle(peer);
        this.rpcStub = new InlineRpcStubHandle(peer);
        this.queryInternals = new InlineP2pInternalsHandle(peer);
        this.network = new InlineNetworkHandle(peer);
        this.transition = new InlineTransitionHandle(peer);
        this.lifecycle = new InlineLifecycleHandle(peer);
        this.stub = new InlineStubHandle(peer);
        this.blocks = new InlineBlocksHandle(peer);
        this.channel = new InlineChannelHandle(peer);
        this.snapshots = new InlineSnapshotHandle(peer);
        this.stateMachine = new InlineStateMachineHandle(peer);
        this.dispute = new InlineDisputeHandle(peer);
        this.balance = new InlineBalanceHandle(peer);
    }

    get index(): number {
        return this.peer.index;
    }
    get address(): string {
        return this.peer.address;
    }
    get signer(): Signer {
        return this.peer.signer;
    }
    get logger(): Logger {
        return this.peer.logger;
    }
    get eventSpies(): EventSpies {
        return this.peer.eventSpies;
    }
    get turnBarrier(): EventBarrier {
        return this.peer.turnBarrier;
    }
    get forkId(): ForkId | undefined {
        return this.peer.stateManager.forkId;
    }

    async dispose(): Promise<void> {
        await this.peer.p2pInstance.dispose();
    }
}
