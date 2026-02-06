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
 * Options for asserting peer synchronization
 */
export type AssertAllPeersInSyncOptions = {
    expectedState?: any;
    peerIndices?: number[];
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

/**
 * Test context fields used by blocks for cross-block state sharing
 * These fields are set by certain blocks and consumed by others
 */
export interface HarnessContext {
    /** Original fork ID captured before dispute/fork change (set by Event.captureOriginalFork) */
    originalForkId?: ForkId;

    /** New fork ID after fork change (set by Context.updateActiveFork) */
    newForkId?: ForkId;

    /** Index of the malicious peer in Byzantine attack scenarios (set by Context.markMaliciousPeer, Byzantine blocks) */
    maliciousPeerIndex?: number;

    /** Last malicious peer index from most recent Byzantine attack (set by Byzantine blocks) */
    lastMaliciousPeerIndex?: number;

    /** Indices of honest peers in Byzantine attack scenarios (set by Context.markMaliciousPeer) */
    honestPeerIndices?: number[];

    /** Last tampered dispute object (set by Byzantine blocks) */
    lastTamperedDispute?: any;

    /** Promise that resolves to tampered dispute (set by Byzantine.interceptDisputeConstruction) */
    tamperedDisputePromise?: Promise<any>;

    /** Function to restore dispute construction after interception (set by Byzantine.interceptDisputeConstruction) */
    restoreDisputeConstruction?: () => void;

    /** Dynamic snapshot count storage for named contexts - indexed by context key (set by Assert.storeSnapshotCount) */
    [key: `snapshotCount_${string}`]: number;

    /** Dynamic snapshot count storage for peers - indexed by peer index (set by Context blocks) */
    [key: `peer${number}SnapshotCountBefore`]: number;
}
