import { ForkId } from "@/types/types";
import { StateSnapshot } from "@/models";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ChannelBalanceStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/StateChannelCommon";
import * as sinon from "sinon";
import { Signer } from "ethers";
import { P2pInstance } from "@/evm";
import StateManager from "@/stateManager";
import { MathStateMachine } from "@typechain-types";
import { EventBarrier, Logger } from "@/utils";
import type { RpcServiceFactoryMap } from "@/rpc";
import { TimeConfig } from "@/types";
import { Config } from "@/utils";

/**
 * Test context fields used by blocks for cross-block state sharing
 * These fields are set by certain blocks and consumed by others
 */
export class HarnessContext {
    /** Original fork ID captured before dispute/fork change (set by Context.captureOriginalFork) */
    originalForkId?: ForkId;

    /** Indices of malicious peers in Byzantine attack scenarios (set by Context.markMaliciousPeer, Byzantine blocks) */
    maliciousPeerIndices: number[] = [];

    /** Excluded from `getPeersForTransitionSyncBarrier` (see `participantLeave`). */
    leftChannelPeerIndices: number[] = [];

    /** Last tampered dispute object (set by Byzantine blocks) */
    tamperedDisputes: DisputeStruct[] = [];

    /** last milestone snapshot before posting snapshot (set by Context.capturePrePostSnapshotContext) */
    lastMilestoneSnapshot?: StateSnapshot;

    /** Channel balance before posting snapshot (set by Context.capturePrePostSnapshotContext) */
    channelBalanceBefore?: ChannelBalanceStructOutput;

    /** Expected withdrawals delta from prepared outbound messages (set by Context.capturePrePostSnapshotContext) */
    expectedWithdrawalsDelta?: BalanceStruct;

    /** Dynamic snapshot count storage for named contexts - indexed by context key (set by Context.storeSnapshotCount) */
    [key: `snapshotCount_${string}`]: number;

    /** Dynamic snapshot count storage for peers - indexed by peer index (set by Context blocks) */
    [key: `peer${number}SnapshotCountBefore`]: number;

    /** Original calldata handler for peers - stored before stubbing (set by Byzantine.stubCalldataHandler) */
    [key: `peer${number}OriginalCalldataHandler`]:
        | ((...args: any[]) => Promise<void>)
        | undefined;

    /** Original broadcast function for peers - stored before stubbing (set by Byzantine.stubBroadcast) */
    [key: `peer${number}OriginalBroadcast`]:
        | ((...args: any[]) => any)
        | undefined;
}

/**
 * Options for configuring the test harness
 */
export type HarnessOptions<
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> = {
    /**
     * ⚙️ LOG LEVEL CONTROL (for cleaner test output)
     *
     * Set to "error" to suppress verbose logs during tests.
     * Set to "debug" or "verbose" for detailed debugging.
     *
     * @example
     * ```ts
     * // Quiet tests (recommended for CI/passing tests)
     * Scenario.startChannel(3, 0, { logLevel: "error" })
     *
     * // Verbose debugging (when investigating failures)
     * Scenario.startChannel(3, 0, { logLevel: "debug" })
     * ```
     *
     * @default undefined (uses LOG_LEVEL env var or "info")
     */
    logLevel?: "debug" | "verbose" | "info" | "warn" | "error";

    timeConfig?: Partial<TimeConfig>;
    channelId?: string;
    initialBalance?: number;
    gasLimit?: number;
    autoConnect?: boolean;
    configOverrides?: Partial<Config>; // Direct config overrides
    rpcServiceFactories?: TFactories;
};

export type TestPeer<
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> = {
    index: number;
    signer: Signer;
    address: string;
    p2pInstance: P2pInstance<MathStateMachine, TFactories>;
    stateManager: StateManager;
    contractInstance: MathStateMachine;
    eventSpies: EventSpies;
    turnBarrier: EventBarrier;
    logger: Logger;
};

/**
 * Spy functions for tracking event calls
 * match with P2pEventHooks and EventHandler methods
 */
export type EventSpies = {
    // P2pEventHooks spies
    onConnection?: sinon.SinonSpy;
    onTurn?: sinon.SinonSpy;
    onSetState?: sinon.SinonSpy;
    onStatusChanged?: sinon.SinonSpy;
    onPostingCalldata?: sinon.SinonSpy;
    onPostedCalldata?: sinon.SinonSpy;
    disputeStarted?: sinon.SinonSpy;
    onInitiatingDispute?: sinon.SinonSpy;
    onDisputeUpdate?: sinon.SinonSpy;

    // EventHandler method spies
    onChannelOpened?: sinon.SinonSpy;
    onStateSnapshotUpdated?: sinon.SinonSpy;
    onBlockCalldataPosted?: sinon.SinonSpy;
    onDisputeCommitted?: sinon.SinonSpy;
    onChainSlashed?: sinon.SinonSpy;
    onDisputeReducedResultCommitted?: sinon.SinonSpy;
    onWithdrawalsUpdated?: sinon.SinonSpy;
    onChannelStorageCleared?: sinon.SinonSpy;
    onDisputeKilled?: sinon.SinonSpy;
    onInboundMessagesProcessed?: sinon.SinonSpy;
};

export type CreateAndResolveDisputeResult<
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> = {
    originalForkId: ForkId;
    newForkId: ForkId;
    maliciousPeerIndices: number[];
    honestPeerIndices: number[];
    honestPeers: Array<TestPeer<TFactories>>;
};
