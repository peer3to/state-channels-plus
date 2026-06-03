// PeerHandle interface and sub-handle shapes shared by InlinePeer and WorkerPeer.

import type { Signer } from "ethers";
import type { ForkId } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import type { EventSpies } from "./types";

import type {
    ByzantineInterface,
    RpcStubInterface,
    P2pInternalsInterface,
    StubInterface,
    NetworkInterface,
    LifecycleInterface,
    TransitionInterface,
    BlocksInterface,
    ChannelInterface,
    SnapshotInterface,
    StateMachineInterface,
    DisputeInterface,
    BalanceInterface
} from "./interfaces";

export type * from "./interfaces";

export interface PeerHandle {
    // Set on WorkerPeer; undefined on InlinePeer.
    readonly __workerBackend?: true;

    readonly index: number;
    readonly address: string;
    readonly signer: Signer;
    readonly logger: Logger;
    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;
    readonly forkId: ForkId | undefined;

    // --- Sub-handles: test-control surfaces ---
    readonly byzantine: ByzantineInterface;
    readonly rpcStub: RpcStubInterface;
    readonly queryInternals: P2pInternalsInterface;
    readonly network: NetworkInterface;
    readonly stub: StubInterface;
    readonly transition: TransitionInterface;
    readonly lifecycle: LifecycleInterface;

    // --- Sub-handles: state queries and operations ---
    readonly blocks: BlocksInterface;
    readonly channel: ChannelInterface;
    readonly snapshots: SnapshotInterface;
    readonly stateMachine: StateMachineInterface;
    readonly dispute: DisputeInterface;
    readonly balance: BalanceInterface;

    dispose(): Promise<void>;
}
