import { AStateMachine } from "@typechain-types";
import type { RpcServiceFactoryMap } from "@/rpc/registry";
import { Signer } from "ethers";
import { P2pInstance } from "@/evm";
import StateManager from "@/stateManager";
import { EventSpies } from "@test/fixtures/PeerTestHarness";
import { EventBarrier, Logger } from "@/utils";
import { ForkId, ChannelId } from "@/types/types";
import { StateChannelManagerProxy } from "@typechain-types";
import { Config } from "@/utils/config";
import { TimeConfig } from "@/types/time";
import { StateSnapshot } from "@/models";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ChannelBalanceStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/StateChannelCommon";

/**
 * Represents a single peer in the test environment
 */
export interface TestPeer<
    T extends AStateMachine,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> {
    index: number;
    signer: Signer;
    address: string;
    p2pInstance: P2pInstance<T, TFactories>;
    stateManager: StateManager;
    contractInstance: T;
    eventSpies: EventSpies;
    joinChannelCommitment?: any;
    turnBarrier: EventBarrier;
    logger: Logger;
}

/**
 * Configuration options for harness initialization
 */
export interface HarnessOptions<
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> {
    timeConfig?: Partial<TimeConfig>;
    channelId?: string;
    initialBalance?: number;
    gasLimit?: number;
    autoConnect?: boolean;
    configOverrides?: Partial<Config>;
    rpcServiceFactories?: TFactories;
}

/**
 * Options for transaction submission
 */
export type SubmitTransactionOptions = {
    waitForSync?: boolean;
    waitForPeers?: number[];
    waitForTurn?: boolean;
};

/**
 * Result of creating and resolving a dispute
 */
export type CreateAndResolveDisputeResult<
    T extends AStateMachine,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> = {
    originalForkId: ForkId;
    newForkId: ForkId;
    maliciousPeerIndex: number;
    honestPeerIndices: number[];
    honestPeers: Array<TestPeer<T, TFactories>>;
};

/**
 * Core harness state that blocks operate on
 */
export interface PeerHarnessState<
    T extends AStateMachine,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> {
    peers: Array<TestPeer<T, TFactories>>;
    channelManager: StateChannelManagerProxy;
    channelId?: ChannelId;
    activeForkId?: ForkId;
    options: Required<HarnessOptions<TFactories>>;
}
