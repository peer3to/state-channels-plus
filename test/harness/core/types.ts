import { ForkId } from "@/types/types";
import { StateSnapshot } from "@/models";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ChannelBalanceStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/StateChannelCommon";
import * as sinon from "sinon";
import { Signer } from "ethers";
import { P2pInstance, type EvmCustomPrecompileManifest } from "@/evm";
import StateManager from "@/stateManager";
import { AStateMachine as AStateMachineContract } from "@typechain-types";
import { EventBarrier, Logger } from "@/utils";
import type { CustomRpcConstructor } from "@/rpc";
import MainRpcService from "@/rpc/MainRpcService";
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

    /** Excluded from `getPeersExcludingMaliciousAndLeavers` (see `participantLeave`). */
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
}

export type HarnessDeploymentParams = {
    signer: Signer;
    stateMachineGasLimit: number;
    disputeExecutionGasLimit: number;
    timeConfig: TimeConfig;
    harnessConfig: Partial<Config>;
};

export type HarnessOnChainContractsDeploymentParams = HarnessDeploymentParams;

export type HarnessLocalStateMachineDeploymentParams = HarnessDeploymentParams;

export type HarnessDeploymentConfig<
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    /**
     * Deploy the on-chain state machine implementation, facets, and manager,
     * then return the deployed manager address.
     */
    deployOnChainContracts: (
        params: HarnessOnChainContractsDeploymentParams
    ) => Promise<string>;
    /**
     * Deploy the state machine in the provided local EVM instance and return
     * the deployed local state machine address.
     */
    deployLocalStateMachine: (
        params: HarnessLocalStateMachineDeploymentParams
    ) => Promise<string>;
    /**
     * Connect the provided signer to a state machine contract instance.
     */
    connectSigner: (address: string, signer: Signer) => TContract;
};

export type HarnessConstructorOptions<
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    deployment: HarnessDeploymentConfig<TContract>;
    // Module path that exports the HarnessDeploymentConfig as its default export.
    // Required when dedicatedPeerThread=true.
    deploymentModule?: string;
};

/**
 * Options for configuring the test harness
 */
export type HarnessOptions<TCustomRpc extends MainRpcService = MainRpcService> =
    {
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
         * @default undefined (uses LOG_LEVEL from config or "error")
         */
        logLevel?: "debug" | "verbose" | "info" | "warn" | "error";

        timeConfig?: Partial<TimeConfig>;
        channelId?: string;
        initialBalance?: number;
        stateMachineGasLimit?: number;
        disputeExecutionGasLimit?: number;
        autoConnect?: boolean;
        configOverrides?: Partial<Config>; // Direct config overrides
        customRpc?: CustomRpcConstructor<any, any>;
        customRpcOptions?: any;
        customPrecompiles?: EvmCustomPrecompileManifest[];
        dedicatedPeerThread?: boolean;
    };

export type TestPeer<
    TCustomRpc extends MainRpcService = MainRpcService,
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    index: number;
    signer: Signer;
    address: string;
    p2pInstance: P2pInstance<TContract, TCustomRpc>;
    stateManager: StateManager<TCustomRpc>;
    contractInstance: TContract;
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
    onBlockConfirmationProcessed?: sinon.SinonSpy;

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
    TCustomRpc extends MainRpcService = MainRpcService,
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    originalForkId: ForkId;
    newForkId: ForkId;
    maliciousPeerIndices: number[];
    honestPeerIndices: number[];
    honestPeers: Array<TestPeer<TCustomRpc, TContract>>;
};
