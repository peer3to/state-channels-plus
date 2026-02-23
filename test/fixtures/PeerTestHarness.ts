import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { Signer } from "ethers";
import * as sinon from "sinon";
import * as dotenv from "dotenv";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { setImmediate } from "node:timers";
import { EvmStateMachine } from "@/evm";
import P2pEventHooks from "@/P2pEventHooks";
import { MathStateMachine, StateChannelManagerProxy } from "@typechain-types";
import { ForkId, ChannelId, Address, Hash } from "@/types/types";

import {
    createLogger,
    LocalDiscoveryServer,
    Logger,
    retry,
    EventBarrier
} from "@/utils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { createConfig, Config, config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { deployFullStack } from "../../scripts/V1/deploy";
import SyncCoordinator from "@test/utils/SyncCoordinator";
import type { RpcServiceFactoryMap } from "@/rpc/registry";

import { ChannelActions } from "@test/harness/actions/ChannelActions";
import { TransitionActions } from "@test/harness/actions/TransitionActions";
import { NetworkController } from "@test/harness/actions/NetworkController";
import { AssertActions } from "@test/harness";
import { ByzantineActions } from "@test/harness/actions/ByzantineActions";
import { EventActions } from "@test/harness/actions/EventActions";
import { StateQueryActions } from "@test/harness/actions/StateQueryActions";
import { DisputeOrchestrator } from "@test/harness/actions/DisputeOrchestrator";
import { DisputeTamperingActions } from "@test/harness/actions/DisputeTamperingActions";
import { RPCActions } from "@test/harness/actions/RPCActions";
import { ContextActions } from "@test/harness/actions/ContextActions";
import { ScenarioActions } from "@test/harness/actions/ScenarioActions";
import { HarnessContext } from "@test/harness";
import { TestPeer, EventSpies, HarnessOptions } from "@test/harness/core/types";
import { LogLevel } from "@/utils/logging/Logger";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

// peformance monitoring
const h = monitorEventLoopDelay();
h.enable();
let last = performance.eventLoopUtilization();

/**
 * Main test harness for E2E peer-to-peer testing
 */
export class PeerTestHarness<
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> {
    public static defaultLogLevel?:
        | "debug"
        | "verbose"
        | "info"
        | "warn"
        | "error";

    public static setDefaultLogLevel(
        level: "debug" | "verbose" | "info" | "warn" | "error" | undefined
    ) {
        PeerTestHarness.defaultLogLevel = level;
    }

    public peers: TestPeer<TFactories>[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedDeployTx!: unknown;
    public channelId!: ChannelId;
    public options!: Required<HarnessOptions<TFactories>>;
    public activeForkId?: ForkId;
    private harnessConfig!: Partial<Config>;
    public logger: Logger;
    public syncCoordinator!: SyncCoordinator;
    private autoTimeAdvanceInterval?: NodeJS.Timeout;
    private autoTimeAdvanceTickInProgress = false;
    private restoreAutomineOnCleanup = false;

    /**
     * Test context for cross-block state sharing
     * Used by blocks to store and retrieve test-specific data (e.g., malicious peer index, fork IDs)
     */
    public context: HarnessContext = {};

    // barriers
    public connectionBarrier: EventBarrier;
    public eventCountsBarrier: EventBarrier;
    public rpcBarrier: EventBarrier;
    public disconnectionBarrier: EventBarrier;

    // action instances
    public readonly channelActions!: ChannelActions;
    public readonly transitionActions!: TransitionActions;
    public readonly networkController!: NetworkController;
    public readonly assertActions!: AssertActions;
    public readonly byzantineActions!: ByzantineActions;
    public readonly eventActions!: EventActions;
    public readonly stateQuery!: StateQueryActions;
    public readonly disputeOrchestrator!: DisputeOrchestrator;
    public readonly disputeTampering!: DisputeTamperingActions;
    public readonly rpcActions!: RPCActions;
    public readonly contextActions!: ContextActions;
    public readonly scenarioActions!: ScenarioActions;

    // ergonomic aliases for action-first tests
    public readonly channel!: ChannelActions;
    public readonly transition!: TransitionActions;
    public readonly network!: NetworkController;
    public readonly assert!: AssertActions;
    public readonly byzantine!: ByzantineActions;
    public readonly event!: EventActions;
    public readonly query!: StateQueryActions;
    public readonly dispute!: DisputeOrchestrator;
    public readonly tamper!: DisputeTamperingActions;
    public readonly rpc!: RPCActions;
    public readonly contextApi!: ContextActions;
    public readonly scenario!: ScenarioActions;

    constructor() {
        // toJSON can't serialize BigInts, so we need to override it
        if (typeof (BigInt.prototype as any).toJSON !== "function") {
            (BigInt.prototype as any).toJSON = function () {
                return Number(this);
            };
        }
        dotenv.config(); // use .env since it's gitignored and it's only for testing - not altering SDK usage
        createConfig(); // Ensure config is initialized for tests

        // Logger starts with default level - will be reconfigured in setup()
        this.logger = createLogger(
            {},
            { component: "TestHarness" },
            { level: config.LOG_LEVEL as LogLevel, attachErrorListener: false }
        );
        setInterval(() => {
            const elu = performance.eventLoopUtilization(last);
            last = performance.eventLoopUtilization();
            const dMean = h.mean / 1e6; // convert to ms
            const d50 = h.percentile(50) / 1e6;
            const d90 = h.percentile(90) / 1e6;
            const d99 = h.percentile(99) / 1e6;
            const dMax = h.max / 1e6;
            this.logger.verbose(
                `Event Loop mean delay: ${dMean}ms, max: ${dMax}ms, utilization: ${elu.utilization}`,
                {
                    dMean,
                    d50,
                    d90,
                    d99,
                    dMax,
                    utilization: elu.utilization
                }
            );
            h.reset();
        }, 1000);
        LocalDiscoveryServer.setLogger(this.logger);
        this.connectionBarrier = new EventBarrier(this.logger);
        this.eventCountsBarrier = new EventBarrier(this.logger);
        this.rpcBarrier = new EventBarrier(this.logger);
        this.disconnectionBarrier = new EventBarrier(this.logger);

        // Initialize action instances
        this.channelActions = new ChannelActions(this, this.logger);
        this.transitionActions = new TransitionActions(this, this.logger);
        this.networkController = new NetworkController(this, this.logger);
        this.assertActions = new AssertActions(this, this.logger);
        this.byzantineActions = new ByzantineActions(this, this.logger);
        this.eventActions = new EventActions(this, this.logger);
        this.stateQuery = new StateQueryActions(this, this.logger);
        this.disputeOrchestrator = new DisputeOrchestrator(this, this.logger);
        this.disputeTampering = new DisputeTamperingActions(this, this.logger);
        this.rpcActions = new RPCActions(this, this.logger);
        this.contextActions = new ContextActions(this, this.logger);
        this.scenarioActions = new ScenarioActions(this, this.logger);

        this.channel = this.channelActions;
        this.transition = this.transitionActions;
        this.network = this.networkController;
        this.assert = this.assertActions;
        this.byzantine = this.byzantineActions;
        this.event = this.eventActions;
        this.query = this.stateQuery;
        this.dispute = this.disputeOrchestrator;
        this.tamper = this.disputeTampering;
        this.rpc = this.rpcActions;
        this.contextApi = this.contextActions;
        this.scenario = this.scenarioActions;
    }

    async setup(
        numPeers: number,
        options?: HarnessOptions<TFactories>
    ): Promise<void> {
        if (numPeers < 2 || numPeers > 10) {
            throw new Error("Number of peers must be between 2 and 10");
        }
        this.harnessConfig = {
            ...testConfig,
            ...(options?.configOverrides || {})
        };
        this.options = {
            logLevel:
                options?.logLevel ??
                (config.LOG_LEVEL as LogLevel) ??
                PeerTestHarness.defaultLogLevel ??
                "info", // Use global default if not specified
            timeConfig: options?.timeConfig || {},
            channelId:
                options?.channelId ||
                `test-channel-${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e9)}`,
            initialBalance: options?.initialBalance || 500,
            gasLimit: options?.gasLimit || 500000,
            autoConnect: options?.autoConnect !== false,
            configOverrides: options?.configOverrides || {},
            rpcServiceFactories: (options?.rpcServiceFactories ??
                {}) as TFactories
        };

        this.syncCoordinator = new SyncCoordinator(
            this.logger,
            this.eventCountsBarrier
        );

        await this.deployContracts();
        const signers = await hre.ethers.getSigners();
        for (let i = 0; i < numPeers; i++) {
            await this.createPeer(i, signers[i]);
        }

        this.logger.info("Test harness setup completed");
    }

    setChannelId(channelId: ChannelId) {
        this.channelId = channelId;
        this.logger.updateSharedContext({ channelId: String(channelId) });
    }

    /**
     * Create a new peer after `setup()` has already run.
     * If a channel is already open (i.e. `this.channelId` is set), the peer is also connected to that channel.
     */
    public async addPeer(signer?: Signer): Promise<TestPeer<TFactories>> {
        if (!this.channelManager || !this.sharedDeployTx) {
            throw new Error("Harness not initialized; call setup() first");
        }

        const index = this.peers.length;
        const signers = await hre.ethers.getSigners();
        const resolvedSigner = signer ?? signers[index];
        if (!resolvedSigner) {
            throw new Error(
                `No signer available to create peer at index ${index}`
            );
        }

        await this.createPeer(index, resolvedSigner);
        const peer = this.peers[index];
        if (!peer) {
            throw new Error(`Failed to create peer ${index}`);
        }

        // If a channel is already known, connect the new peer to it.
        if (this.channelId) {
            await peer.p2pInstance.p2pSigner.connectToChannel(this.channelId);
        }

        return peer as TestPeer<TFactories>;
    }

    private async deployContracts(): Promise<void> {
        const mathSMFactory =
            await hre.ethers.getContractFactory("MathStateMachine");
        const mathInstance = await mathSMFactory.deploy(this.options.gasLimit);
        await mathInstance.waitForDeployment();

        this.sharedDeployTx = await mathSMFactory.getDeployTransaction(
            this.options.gasLimit
        );

        const [hardhatSigner] = await hre.ethers.getSigners();

        const deployment = await deployFullStack(hardhatSigner, {
            stateMachineArtifact: MathStateMachineArtifact,
            consumerFacetArtifact: MathConsumerFacetArtifact,
            stateMachineArgs: [this.options.gasLimit],
            consumerFacetArgs: [],
            timeConfig: this.options.timeConfig
        });

        this.channelManager = deployment.contract;
    }

    private async createPeer(index: number, signer: Signer): Promise<void> {
        const address = await signer.getAddress();

        const peerLogger = createLogger(
            {
                peerId: index,
                peerAddress: address
            },
            { component: `PeerTestHarness` },
            { level: this.options.logLevel, attachErrorListener: false } // Use same log level as harness
        );

        this.logger.debug(`Creating peer ${index} at ${address}`);

        const peerTurnBarrier = new EventBarrier(peerLogger);

        const eventSpies: EventSpies = {
            // P2pEventHooks spies
            onConnection: sinon.spy(),
            onTurn: sinon.spy(),
            onSetState: sinon.spy(),
            onPostingCalldata: sinon.spy(),
            onPostedCalldata: sinon.spy(),
            disputeStarted: sinon.spy(),
            onInitiatingDispute: sinon.spy(),
            onDisputeUpdate: sinon.spy(),

            // EventHandler method spies
            onChannelOpened: sinon.spy(),
            onStateSnapshotUpdated: sinon.spy(),
            onBlockCalldataPosted: sinon.spy(),
            onDisputeCommitted: sinon.spy(),
            onChainSlashed: sinon.spy(),
            onDisputeReducedResultCommitted: sinon.spy(),
            onWithdrawalsUpdated: sinon.spy(),
            onChannelStorageCleared: sinon.spy(),
            onDisputeKilled: sinon.spy(),
            onInboundMessagesProcessed: sinon.spy()
        };

        const hooks: P2pEventHooks = {
            onConnection: (addr: Address, isChannelOpened: boolean) => {
                peerLogger.verbose(`Connection established with ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onConnection?.(addr, isChannelOpened);
                this.connectionBarrier.signal();
                this.eventCountsBarrier.signal();
            },
            onDisconnection: (addr: Address) => {
                peerLogger.verbose(`Disconnection from ${addr}`, {
                    component: "P2pEventHooks"
                });
                this.disconnectionBarrier.signal();
                this.eventCountsBarrier.signal();
            },
            onTurn: (
                addr: Address,
                _turnTime: number,
                _agreementTime: number,
                _chainFallbackTime: number
            ) => {
                peerLogger.verbose(`Turn received from ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onTurn?.(addr);
                peerTurnBarrier.signal();
                this.eventCountsBarrier.signal();
            },
            onSetState: () => {
                peerLogger.debug("State set", { component: "P2pEventHooks" });
                eventSpies.onSetState?.();
                this.eventCountsBarrier.signal();
            },
            onPostingCalldata: () => {
                peerLogger.debug("Posting calldata to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostingCalldata?.();
                this.eventCountsBarrier.signal();
            },
            onPostedCalldata: () => {
                peerLogger.debug("Calldata posted to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostedCalldata?.();
                this.eventCountsBarrier.signal();
            },
            onDisputeStarted: (maxDuration: number) => {
                peerLogger.debug("Dispute started", {
                    component: "P2pEventHooks",
                    maxDuration
                });
                eventSpies.disputeStarted?.(maxDuration);
                this.eventCountsBarrier.signal();
            },
            onInitiatingDispute: (
                disputeHash: Hash,
                dispute: DisputeStruct
            ) => {
                peerLogger.info(
                    `Initiating dispute - DisputeHash:${disputeHash}`,
                    {
                        component: "P2pEventHooks"
                    }
                );
                eventSpies.onInitiatingDispute?.(disputeHash, dispute);
                this.eventCountsBarrier.signal();
            },
            onDisputeUpdate: (dispute: DisputeStruct) => {
                peerLogger.info("Dispute updated", {
                    component: "P2pEventHooks"
                });
                eventSpies.onDisputeUpdate?.(dispute);
                this.eventCountsBarrier.signal();
            },
            onDisputeAcknowledgment: (addr: Address) => {
                peerLogger.verbose(
                    `Dispute acknowledgment received from ${addr}`,
                    {
                        component: "P2pEventHooks"
                    }
                );
                this.rpcBarrier.signal();
                this.eventCountsBarrier.signal();
            }
        };

        // Deploy MathStateMachine for this peer
        const mathSMFactory =
            await hre.ethers.getContractFactory("MathStateMachine");
        const mathInstance = await mathSMFactory.deploy(this.options.gasLimit);

        const p2pInstance = await EvmStateMachine.p2pSetup<
            MathStateMachine,
            TFactories
        >(signer, this.sharedDeployTx, this.channelManager, mathInstance, {
            peerId: index,
            peerLogger: peerLogger,
            p2pEventHooks: hooks,
            rpcServiceFactories: this.options.rpcServiceFactories,
            config: this.harnessConfig
        });

        const peer: TestPeer<TFactories> = {
            index,
            signer,
            address,
            p2pInstance,
            stateManager: p2pInstance.p2pSigner.p2pManager.stateManager,
            contractInstance: p2pInstance.p2pContractInstance,
            eventSpies,
            turnBarrier: peerTurnBarrier,
            logger: peerLogger
        };

        // Wrap EventHandler methods with spies (without replacing the original functionality)
        this.wrapEventHandlerWithSpies(peer);

        this.peers.push(peer);
        this.logger.debug(`Peer ${index} created successfully`);
    }

    private wrapEventHandlerWithSpies(peer: TestPeer<TFactories>): void {
        const eventHandler = peer.stateManager.eventHandler;
        const spies = peer.eventSpies;
        const eventCountsBarrier = this.eventCountsBarrier;

        // Create a proxy that intercepts EventHandler method calls and calls both the spy and original method
        const eventHandlerProxy = new Proxy(eventHandler, {
            get(target, prop, receiver) {
                const originalMethod = Reflect.get(target, prop, receiver);

                // Only intercept EventHandler methods that have corresponding spies
                if (typeof originalMethod === "function" && prop in spies) {
                    return async function (...args: unknown[]) {
                        // Call the spy first to record the call
                        const spy = spies[prop as keyof EventSpies];
                        spy?.(...(args as Parameters<sinon.SinonSpy>));

                        // Then call the original method
                        await Reflect.apply(originalMethod, target, args);
                        return eventCountsBarrier.signal();
                    };
                }

                return originalMethod;
            }
        });

        // Replace the eventHandler in both the stateManager and stateChannelEventListener with our proxy
        peer.stateManager.eventHandler = eventHandlerProxy;
        peer.stateManager.stateChannelEventListener.eventHandler =
            eventHandlerProxy;
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Starts automatic blockchain time advancement to simulate natural time passing.
     * Mines blocks on a fixed cadence so time progresses even without transactions.
     */
    async startAutoTimeAdvance(options?: {
        intervalMs?: number;
        stepSeconds?: number;
        disableAutomine?: boolean;
    }): Promise<void> {
        if (this.autoTimeAdvanceInterval) {
            this.logger.debug("Auto time advance already running");
            return;
        }

        const intervalMs = options?.intervalMs ?? 2000;
        const stepSeconds = options?.stepSeconds ?? 2;
        const disableAutomine = options?.disableAutomine ?? true;

        this.logger.debug(
            `Starting auto blockchain time advance (every ${intervalMs}ms, step ${stepSeconds}s)`
        );

        if (disableAutomine) {
            await hre.ethers.provider.send("evm_setAutomine", [false]);
            this.restoreAutomineOnCleanup = true;
        }

        this.autoTimeAdvanceInterval = setInterval(() => {
            if (this.autoTimeAdvanceTickInProgress) return;
            this.autoTimeAdvanceTickInProgress = true;
            void retry(
                async () => {
                    await time.increase(stepSeconds);

                    const latestBlock =
                        await hre.ethers.provider.getBlock("latest");

                    if (!latestBlock) {
                        this.logger.verbose(
                            "Auto time advance mined block, but latest block was unavailable"
                        );
                        return;
                    }

                    const transactionHashes = (
                        latestBlock.transactions || []
                    ).map((tx) => String(tx));

                    this.logger.debug(
                        `Auto-mined block ${latestBlock.number} txCount: ${transactionHashes.length}`,
                        {
                            blockNumber: latestBlock.number,
                            timestamp: latestBlock.timestamp,
                            transactionCount: transactionHashes.length,
                            transactionHashes
                        }
                    );
                },
                {
                    maxRetries: 30,
                    delayMs: 5,
                    useExponentialBackoff: false
                }
            ).finally(() => {
                this.autoTimeAdvanceTickInProgress = false;
            });
        }, intervalMs);
    }
    async cleanup(): Promise<void> {
        this.logger.debug("Starting cleanup...");

        // Stop auto time advancement
        if (this.autoTimeAdvanceInterval) {
            clearInterval(this.autoTimeAdvanceInterval);
            this.autoTimeAdvanceInterval = undefined;
        }
        this.autoTimeAdvanceTickInProgress = false;

        if (this.restoreAutomineOnCleanup) {
            try {
                await hre.ethers.provider.send("evm_setAutomine", [true]);
            } catch {
                // ignore
            }
            this.restoreAutomineOnCleanup = false;
        }

        if (this.channelManager) {
            this.channelManager.removeAllListeners();
        }

        this.connectionBarrier.clear();
        this.eventCountsBarrier.clear();

        const disposePromises: Promise<unknown>[] = [];

        for (const peer of this.peers) {
            try {
                peer.logger.verbose("Cleaning up peer", {
                    component: "TestHarness"
                });

                disposePromises.push(peer.p2pInstance.dispose());

                Object.values(peer.eventSpies).forEach((spy) =>
                    spy?.resetHistory()
                );

                peer.logger.verbose("Peer cleanup completed", {
                    component: "TestHarness"
                });
            } catch (error) {
                peer.logger.error(`Error during cleanup: ${error}`, {
                    component: "TestHarness"
                });
            }
        }

        await Promise.allSettled(disposePromises);

        await new Promise((resolve) => setImmediate(resolve));

        this.peers = [];

        // Fully reset the context object to ensure no properties leak between tests
        this.context = {};

        // Cleanup discovery server and peer servers
        await LocalDiscoveryServer.cleanup();

        this.logger.dispose();
    }

    getPeer(index: number): TestPeer<TFactories> {
        const peer = this.peers[index];
        if (!peer) throw new Error(`Peer ${index} not found`);
        return peer;
    }

    getPeerAddresses(): Address[] {
        return this.peers.map((p) => p.address);
    }

    getFilteredPeers(peerIndices?: number[]): TestPeer<TFactories>[] {
        return peerIndices
            ? peerIndices.map((i) => this.getPeer(i))
            : this.peers;
    }

    getHonestPeers(excludePeerIndices?: number[]): TestPeer<TFactories>[] {
        const excludeSet = new Set<number>([
            ...(excludePeerIndices ?? []),
            ...(this.context.maliciousPeerIndices ?? [])
        ]);
        return this.peers.filter((peer) => !excludeSet.has(peer.index));
    }
    getConfig(): Partial<Config> {
        return this.harnessConfig;
    }

    async waitForForkChange(
        options: {
            expectedForkId?: ForkId;
            excludeForkIds?: ForkId[];
            peerIndices?: number[];
            timeoutMs?: number;
        } = {}
    ): Promise<boolean> {
        const {
            expectedForkId,
            excludeForkIds = [],
            peerIndices,
            timeoutMs = 10000
        } = options;

        const peersToCheck = peerIndices
            ? peerIndices.map((i) => this.peers[i])
            : this.peers;

        const { ZeroHash } = await import("ethers");
        const excludeSet = new Set([...excludeForkIds, ZeroHash]);

        const condition = () => {
            const peerForks = peersToCheck
                .map((p) => p.stateManager.forkId)
                .filter((fid) => !excludeSet.has(fid));

            if (peerForks.length === 0) return false;

            if (expectedForkId) {
                const isGood = peerForks.every((fid) => fid === expectedForkId);
                if (isGood) this.activeForkId = expectedForkId;
                return isGood;
            } else {
                // All peers have moved to same new fork
                const uniqueForks = new Set(peerForks);
                const isGood =
                    uniqueForks.size === 1 &&
                    peerForks.length === peersToCheck.length;
                if (isGood) this.activeForkId = peerForks[0];
                return isGood;
            }
        };

        // Check immediately
        if (condition()) return true;

        // Use event barrier (fires on state changes)
        try {
            await this.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Fork change not detected within ${timeoutMs}ms`
            });
            return true;
        } catch (error) {
            const barrierError = error as EventBarrierCapturedError;
            this.logger.error("waitForForkChange waitFor failed", {
                error,
                capturedBarrierStack: barrierError.capturedBarrierStack,
                expectedForkId,
                peerIndices,
                timeoutMs
            });
            return false;
        }
    }
}

export default PeerTestHarness;
