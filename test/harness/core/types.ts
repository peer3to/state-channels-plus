// @spec-test-coverage-ignore: shared harness context and type declarations exercised by owning mapped test declarations
import { ForkId } from "@/types/types";
import { StateSnapshot } from "@/models";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ChannelBalanceStructOutput } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import * as sinon from "sinon";
import { Signer } from "ethers";
import { P2pInstance, type EvmCustomPrecompileManifest } from "@/evm";
import { AStateMachine as AStateMachineContract } from "@typechain-types";
import { EventBarrier, Logger } from "@/utils";
import type { CustomRpcManifest } from "@/rpc";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
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

    /** Honest peers intentionally unavailable to synchronization barriers. */
    afkPeerIndices: number[] = [];

    /** Excluded from `getActiveHonestPeers` (see `participantLeave`). */
    leftChannelPeerIndices: number[] = [];

    /** Last tampered dispute object (set by Byzantine blocks) */
    tamperedDisputes: DisputeStruct[] = [];

    /** last milestone snapshot before posting snapshot (set by Context.capturePrePostSnapshotContext) */
    lastMilestoneSnapshot?: StateSnapshot;

    /** Channel balance before posting snapshot (set by Context.capturePrePostSnapshotContext) */
    channelBalanceBefore?: ChannelBalanceStructOutput;

    /** Expected withdrawals delta (Codec-encoded `Type.Balance`) from prepared outbound messages (set by Context.capturePrePostSnapshotContext) */
    encodedExpectedWithdrawalsDelta?: string;

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

export type HarnessDeploymentParams = {
    signer: Signer;
    stateMachineGasLimit: number;
    disputeExecutionGasLimit: number;
    timeConfig: TimeConfig;
    harnessConfig: Partial<Config>;
    /** Node-cached config-independent SCM facets to reuse (see `deploy`). */
    facetAddresses?: string[];
};

export type HarnessOnChainContractsDeploymentParams = HarnessDeploymentParams;

export type HarnessLocalStateMachineDeploymentParams = HarnessDeploymentParams;

export type HarnessDeploymentConfig<
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    /**
     * Extra identity for the deployed stack, folded into the node-level
     * deployment cache key. MUST include every consumer-side parameter baked
     * into the deployed state machine (e.g. poker's maxPlayers) — otherwise a
     * cache hit could hand back a stack built with different parameters.
     */
    getDeploymentCacheKeyFragment?: () => string;
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
};

/**
 * Options for configuring the test harness
 */
export type HarnessOptions = {
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
    /** Maximum SDK peers to boot at once. Defaults to all requested peers. */
    peerSetupConcurrency?: number;
    configOverrides?: Partial<Config>; // Direct config overrides
    customRpcManifest?: CustomRpcManifest;
    customPrecompiles?: EvmCustomPrecompileManifest[];
};

export type TestPeer<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc,
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    index: number;
    signer: Signer;
    address: string;
    p2pInstance: P2pInstance<TContract, TCustomRpc>;
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
    onAbort?: sinon.SinonSpy;
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
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc,
    TContract extends AStateMachineContract = AStateMachineContract
> = {
    originalForkId: ForkId;
    newForkId: ForkId;
    maliciousPeerIndices: number[];
    afkPeerIndices: number[];
    honestPeerIndices: number[];
    honestPeers: Array<TestPeer<TCustomRpc, TContract>>;
};
