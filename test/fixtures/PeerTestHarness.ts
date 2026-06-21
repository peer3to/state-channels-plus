import { NonceManager, Signer, ethers } from "ethers";
import * as sinon from "sinon";
import * as dotenv from "dotenv";
import hre from "hardhat";
import { setImmediate } from "node:timers";
import { EvmStateMachine } from "@/evm";
import P2pEventHooks from "@/P2pEventHooks";
import {
    AStateMachine as AStateMachineContract,
    StateChannelManagerProxy,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import { ForkId, ChannelId, Address, Hash } from "@/types/types";
import { TimeConfig } from "@/types";

import {
    createLogger,
    LocalDiscoveryServer,
    Logger,
    retry,
    EventBarrier,
    createEthersResultProxy
} from "@/utils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { createConfig, Config, config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { type LocalStateMachineDeployer } from "../../scripts/V1/deploy";
import SyncCoordinator from "@test/utils/SyncCoordinator";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import path from "node:path";
import HarnessControlRpc from "./customRpc/harnessControl/HarnessControlRpc";
import type { CustomRpcManifest } from "@/rpc/registry";
import type StateManager from "@/stateManager/StateManager";
import { EVENT_HANDLER_HOOK_NAMES } from "@/eventHandlers/EventHandlerHooks";
import type { RuntimeEventName } from "@/evm/p2pRuntime/RuntimeEventEmitter";

import { LifecycleActions } from "@test/harness/actions/lifecycle/LifecycleActions";
import { JoinActions } from "@test/harness/actions/JoinActions";
import { TransitionActions } from "@test/harness/actions/TransitionActions";
import { NetworkController } from "@test/harness/actions/NetworkController";
import { AssertActions } from "@test/harness/actions/assert/AssertActions";
import { ByzantineActions } from "@test/harness/actions/ByzantineActions";
import { EventActions } from "@test/harness/actions/EventActions";
import { StateQueryActions } from "@test/harness/actions/StateQueryActions";
import { DisputeOrchestrator } from "@test/harness/actions/DisputeOrchestrator";
import { DisputeTamperingActions } from "@test/harness/actions/DisputeTamperingActions";
import { RPCActions } from "@test/harness/actions/RPCActions";
import { RpcStubActions } from "@test/harness/actions/rpcStubActions";
import { ContextActions } from "@test/harness/actions/ContextActions";
import { ScenarioActions } from "@test/harness/actions/ScenarioActions";
import {
    HarnessConstructorOptions,
    HarnessDeploymentConfig,
    HarnessContext,
    TestPeer,
    EventSpies,
    HarnessOptions
} from "@test/harness/core/types";
import { HarnessDebug } from "./HarnessDebug";
import { LogLevel } from "@/utils/logging/Logger";

const DEFAULT_HARNESS_DISPUTE_EXECUTION_GAS_LIMIT = 3_000_000;

/**
 * Main test harness for E2E peer-to-peer testing
 */
export class PeerTestHarness<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc,
    TStateMachine extends AStateMachineContract = AStateMachineContract
> {
    public peers: TestPeer<TCustomRpc, TStateMachine>[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedStateMachineDeployer!: LocalStateMachineDeployer;
    public channelId!: ChannelId;
    public options!: HarnessOptions;
    private harnessConfig!: Partial<Config>;
    private readonly deployment: HarnessDeploymentConfig<TStateMachine>;
    public logger: Logger;
    public syncCoordinator!: SyncCoordinator<TCustomRpc>;
    private autoTimeAdvanceInterval?: NodeJS.Timeout;
    private autoTimeAdvanceTickInProgress = false;
    private restoreAutomineOnCleanup = false;

    /**
     * Test context for cross-block state sharing
     * Used by blocks to store and retrieve test-specific data (e.g., malicious peer index, fork IDs)
     */
    public context = new HarnessContext();

    // barriers
    public connectionBarrier: EventBarrier;
    public eventCountsBarrier: EventBarrier;
    public rpcBarrier: EventBarrier;
    public disconnectionBarrier: EventBarrier;

    // action instances
    public lifecycle!: LifecycleActions<TCustomRpc>;
    public join!: JoinActions<TCustomRpc>;
    public transition!: TransitionActions<TCustomRpc, TStateMachine>;
    public network!: NetworkController<TCustomRpc>;
    public assert!: AssertActions<TCustomRpc>;
    public byzantine!: ByzantineActions<TCustomRpc>;
    public event!: EventActions<TCustomRpc>;
    public query!: StateQueryActions<TCustomRpc>;
    public dispute!: DisputeOrchestrator<TCustomRpc>;
    public tamper!: DisputeTamperingActions<TCustomRpc>;
    public rpc!: RPCActions<TCustomRpc>;
    public rpcStub!: RpcStubActions<TCustomRpc>;
    public contextApi!: ContextActions<TCustomRpc>;
    public scenario!: ScenarioActions<TCustomRpc>;
    public readonly debug: HarnessDebug<TCustomRpc>;

    /**
     * First honest peer's fork ID is considered the active fork ID for the channel.
     */
    /**
     * Per-peer fork-id cache. The live fork id lives host-side behind the
     * runtime port, so it cannot be read synchronously. The cache is refreshed
     * by {@link refreshForkIds} (after channel open/join, transitions, disputes)
     * and opportunistically from forwarded event-handler invocations.
     */
    private forkIdCache = new Map<number, ForkId>();
    private peerSignersRegistered = new Set<number>();

    public get activeForkId(): ForkId | undefined {
        const honestPeers = this.getHonestPeers();

        if (honestPeers.length === 0) {
            throw new Error(
                "No honest peers available to determine active fork ID"
            );
        }

        return this.forkIdCache.get(honestPeers[0].index);
    }

    /**
     * Typed handle to a peer's host-side harness-control RPC services
     * (`query` / `network` / `byzantine` / `stub`). Every peer's custom RPC
     * extends {@link HarnessControlRpc}, so these services are always present at
     * runtime; the cast keeps call sites typed without forcing the harness's
     * `TCustomRpc` generic to name them. Usage:
     * `harness.control(peer).query.getForkId().request()`.
     */
    public control(
        peer: TestPeer<TCustomRpc>
    ): RemoteRpcProxyType<HarnessControlRpc> {
        return peer.p2pInstance
            .hostRpc as unknown as RemoteRpcProxyType<HarnessControlRpc>;
    }

    /**
     * Current fork id of each given peer (defaults to all), queried from hosts.
     * Populates {@link forkIdCache} as a side effect so {@link activeForkId} stays
     * in sync after the query.
     */
    public async peerForkIds(
        peers: TestPeer<TCustomRpc, TStateMachine>[] = this.peers
    ): Promise<ForkId[]> {
        return Promise.all(
            peers.map(async (peer) => {
                const forkId = (await this.control(peer)
                    .query.getForkId()
                    .request()) as ForkId;
                this.forkIdCache.set(peer.index, forkId);
                return forkId;
            })
        );
    }

    /** Refresh the fork-id cache for all peers (or a subset) from the host. */
    public async refreshForkIds(peerIndices?: number[]): Promise<void> {
        const peers =
            peerIndices === undefined
                ? this.peers
                : peerIndices.map((i) => this.peers[i]).filter(Boolean);
        await Promise.all(
            peers.map(async (peer) => {
                try {
                    const forkId = await this.control(peer)
                        .query.getForkId()
                        .request();
                    this.forkIdCache.set(peer.index, forkId as ForkId);
                } catch {
                    // Peer may not be ready (pre-handshake); leave cache as-is.
                }
            })
        );
    }

    constructor({ deployment }: HarnessConstructorOptions<TStateMachine>) {
        dotenv.config({ quiet: true }); // use .env since it's gitignored and it's only for testing - not altering SDK usage
        createConfig({}, testConfig); // Ensure config is initialized for tests
        this.deployment = deployment;

        // Logger starts with config default and is reconfigured in setup().
        this.logger = createLogger(
            {},
            { component: "TestHarness" },
            {
                level: (config.LOG_LEVEL as LogLevel) ?? "error",
                attachErrorListener: false
            }
        );
        this.logger.startPerformanceMonitoring();
        LocalDiscoveryServer.setLogger(this.logger);
        this.connectionBarrier = new EventBarrier(this.logger);
        this.eventCountsBarrier = new EventBarrier(this.logger);
        this.rpcBarrier = new EventBarrier(this.logger);
        this.disconnectionBarrier = new EventBarrier(this.logger);

        // Initialize action instances
        this.lifecycle = new LifecycleActions(this, this.logger);
        this.join = new JoinActions(this);
        this.transition = new TransitionActions(this, this.logger);
        this.network = new NetworkController(this, this.logger);
        this.assert = new AssertActions(this, this.logger);
        this.byzantine = new ByzantineActions(this, this.logger);
        this.event = new EventActions(this, this.logger);
        this.query = new StateQueryActions(this, this.logger);
        this.dispute = new DisputeOrchestrator(this, this.logger);
        this.tamper = new DisputeTamperingActions(this, this.logger);
        this.rpc = new RPCActions(this, this.logger);
        this.rpcStub = new RpcStubActions(this, this.logger);
        this.contextApi = new ContextActions(this, this.logger);
        this.scenario = new ScenarioActions(this, this.logger);
        this.debug = new HarnessDebug(this);
    }

    async setup(numPeers: number, options?: HarnessOptions): Promise<void> {
        if (numPeers < 2 || numPeers > 10) {
            throw new Error("Number of peers must be between 2 and 10");
        }
        // Load `testConfig` at config-file precedence (not as a high-priority
        // override) so `process.env` (RUN_SDK_IN_THREAD, PROVIDER_URL,
        // LOCAL_DISCOVERY_REGISTRY_URL, …) and any explicit `configOverrides`
        // still win over it — and the merged result flows into the worker's
        // setup payload.
        this.harnessConfig = createConfig(
            options?.configOverrides || {},
            testConfig
        );

        const resolvedTimeConfig: TimeConfig = {
            p2pTime: 1,
            agreementTime: 2,
            chainFallbackTime: 2,
            evidenceTime: 3,
            ...(options?.timeConfig || {})
        };

        this.options = {
            logLevel:
                options?.logLevel ?? (config.LOG_LEVEL as LogLevel) ?? "error",
            timeConfig: resolvedTimeConfig,
            channelId:
                options?.channelId ||
                `test-channel-${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e9)}`,
            initialBalance: options?.initialBalance || 500,
            stateMachineGasLimit: options?.stateMachineGasLimit ?? 500000,
            disputeExecutionGasLimit:
                options?.disputeExecutionGasLimit ??
                DEFAULT_HARNESS_DISPUTE_EXECUTION_GAS_LIMIT,
            autoConnect: options?.autoConnect !== false,
            configOverrides: options?.configOverrides || {},
            customPrecompiles: options?.customPrecompiles || [],
            customRpcManifest: options?.customRpcManifest
        };
        if (
            !this.options.timeConfig?.agreementTime ||
            this.options.timeConfig.agreementTime <= 1
        )
            throw new Error(
                "agreementTime must be greater than 1 second for reliable test execution"
            );
        this.syncCoordinator = new SyncCoordinator<TCustomRpc>(
            this.logger,
            this.eventCountsBarrier,
            (peer) => this.control(peer)
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

    public get canAddPeer(): boolean {
        return !!this.channelManager && !!this.sharedStateMachineDeployer;
    }

    private createLocalStateMachineDeployer(
        deployment: Pick<
            HarnessDeploymentConfig<TStateMachine>,
            "deployLocalStateMachine"
        >
    ): LocalStateMachineDeployer {
        const { deployLocalStateMachine } = deployment;

        return async (signer) => {
            const deployedAddress = await deployLocalStateMachine({
                signer,
                stateMachineGasLimit: this.options.stateMachineGasLimit!,
                disputeExecutionGasLimit:
                    this.options.disputeExecutionGasLimit!,
                timeConfig: this.options.timeConfig as TimeConfig,
                harnessConfig: this.harnessConfig
            });

            return deployedAddress;
        };
    }

    private async deployContracts(): Promise<void> {
        const signers = await hre.ethers.getSigners();
        // Dedicated deployer account (not a peer) wrapped in NonceManager, so
        // deploy txs don't collide with peer account 0's nonces on a strict
        // external node.
        const deployerSigner = new NonceManager(signers[signers.length - 1]);
        const deployment = this.deployment;

        this.sharedStateMachineDeployer =
            this.createLocalStateMachineDeployer(deployment);

        const channelManagerAddress = await deployment.deployOnChainContracts({
            signer: deployerSigner,
            stateMachineGasLimit: this.options.stateMachineGasLimit!,
            disputeExecutionGasLimit: this.options.disputeExecutionGasLimit!,
            timeConfig: this.options.timeConfig as TimeConfig,
            harnessConfig: this.harnessConfig
        });

        // Wrap like the SDK wraps its own contracts: converts ethers `Result`s
        // to plain objects on return AND makes call args mutable. Without it,
        // round-tripping a frozen `Result` (e.g. `getStateSnapshot().snapshotData`)
        // back into a `staticCall` throws "Cannot assign to read only property".
        this.channelManager = createEthersResultProxy(
            StateChannelManagerProxy__factory.connect(
                channelManagerAddress,
                deployerSigner
            )
        );
    }

    private resolveSignerSecret(
        index: number,
        address: string
    ): string | undefined {
        const accountsConfig = (hre.network.config as any)?.accounts;
        if (!accountsConfig || typeof accountsConfig !== "object") {
            return undefined;
        }
        const mnemonic = accountsConfig.mnemonic;
        if (typeof mnemonic !== "string" || !mnemonic.length) {
            return undefined;
        }

        const wallet = ethers.HDNodeWallet.fromPhrase(
            mnemonic,
            undefined,
            `m/44'/60'/0'/0/${index}`
        );
        if (wallet.address.toLowerCase() !== address.toLowerCase()) {
            return undefined;
        }
        return wallet.privateKey;
    }

    public async createPeer(index: number, signer: Signer): Promise<void> {
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
            onStatusChanged: sinon.spy(),
            onPostingCalldata: sinon.spy(),
            onPostedCalldata: sinon.spy(),
            disputeStarted: sinon.spy(),
            onInitiatingDispute: sinon.spy(),
            onDisputeUpdate: sinon.spy(),
            onBlockConfirmationProcessed: sinon.spy(),

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
            onSetState: (forkId: ForkId) => {
                peerLogger.debug("State set", { component: "P2pEventHooks" });
                // Peers push their fork id on setState; keep the cache fresh so
                // `activeForkId` reflects updates without an explicit query.
                if (forkId && forkId !== "0x00" && forkId !== "0x0") {
                    this.forkIdCache.set(index, forkId);
                }
                eventSpies.onSetState?.();
                this.eventCountsBarrier.signal();
            },
            onStatusChanged: (oldStatus, newStatus) => {
                peerLogger.debug("Status changed (hook)", {
                    component: "P2pEventHooks",
                    oldStatus,
                    newStatus
                });
                eventSpies.onStatusChanged?.(oldStatus, newStatus);
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
            onDisputeUpdate: (slashes: Address[], timeout?: Address) => {
                peerLogger.info("Dispute updated", {
                    component: "P2pEventHooks",
                    slashes,
                    timeout
                });
                eventSpies.onDisputeUpdate?.(slashes, timeout);
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
            },
            onBlockFinalized: () => {
                this.eventCountsBarrier.signal();
            },
            onBlockConfirmationProcessed: (
                blockHash: Hash,
                keepConnection: boolean
            ) => {
                peerLogger.verbose("Block confirmation processed", {
                    component: "P2pEventHooks",
                    blockHash,
                    keepConnection
                });
                eventSpies.onBlockConfirmationProcessed?.(
                    blockHash,
                    keepConnection
                );
                this.eventCountsBarrier.signal();
            }
        };

        const contractInstanceMock = this.deployment.connectSigner(
            ethers.ZeroAddress,
            signer
        );

        const useWorker = this.harnessConfig.RUN_SDK_IN_THREAD;
        const signerSecret = useWorker
            ? this.resolveSignerSecret(index, address)
            : undefined;

        const p2pInstance = await EvmStateMachine.p2pSetup<
            TStateMachine,
            TCustomRpc
        >(
            signer,
            this.channelManager,
            contractInstanceMock,
            this.sharedStateMachineDeployer,
            {
                peerId: index,
                peerLogger: peerLogger,
                customPrecompiles: this.options.customPrecompiles!,
                customRpcManifest: this.resolveHarnessRpcManifest(),
                signerSecret,
                config: this.harnessConfig
            }
        );

        const peer: TestPeer<TCustomRpc, TStateMachine> = {
            index,
            signer,
            address,
            p2pInstance,
            contractInstance: p2pInstance.p2pContractInstance,
            eventSpies,
            turnBarrier: peerTurnBarrier,
            logger: peerLogger
        };

        // Register the p2p-hook listeners (built above) and the EventHandler
        // spy/barrier listeners on the runtime. All events are forwarded over the
        // port and dispatched on the main thread.
        this.registerPeerEventListeners(peer, hooks);

        this.peers.push(peer);
        this.logger.debug(`Peer ${index} created successfully`);
    }

    /**
     * The custom RPC manifest a peer is built with. Defaults to the
     * {@link HarnessControlRpc} manifest so every peer exposes the harness
     * control surface; a test-supplied manifest (whose class extends
     * {@link HarnessControlRpc}) takes precedence.
     */
    private resolveHarnessRpcManifest(): CustomRpcManifest {
        return (
            this.options.customRpcManifest ?? {
                module: path.resolve(
                    __dirname,
                    "customRpc/harnessControl/HarnessControlRpc.ts"
                )
            }
        );
    }

    /**
     * Register all runtime-event listeners for a peer: the p2p-hook callbacks
     * (already wired to spies/barriers) and an EventHandler listener per
     * mirrored event that drives its spy and signals the event-count barrier.
     */
    private registerPeerEventListeners(
        peer: TestPeer<TCustomRpc, TStateMachine>,
        hooks: P2pEventHooks
    ): void {
        for (const [name, fn] of Object.entries(hooks)) {
            if (typeof fn === "function") {
                peer.p2pInstance.on(name as RuntimeEventName, fn as never);
            }
        }

        const spies = peer.eventSpies;
        for (const name of EVENT_HANDLER_HOOK_NAMES) {
            peer.p2pInstance.on(name, (...args: unknown[]) => {
                const spy = spies[name as keyof EventSpies];
                spy?.(...(args as Parameters<sinon.SinonSpy>));
                this.eventCountsBarrier.signal();
            });
        }
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Starts automatic blockchain time advancement to simulate natural time passing.
     * Mines blocks on a fixed cadence so time progresses even without transactions.
     */
    async startAutoTimeAdvance(options?: {
        intervalSeconds?: number;
        disableAutomine?: boolean;
    }): Promise<void> {
        if (this.autoTimeAdvanceInterval) {
            this.logger.debug("Auto time advance already running");
            return;
        }

        const intervalSeconds = options?.intervalSeconds ?? 2;
        const disableAutomine = options?.disableAutomine ?? true;

        this.logger.debug(
            `Starting auto blockchain mine (every ${intervalSeconds}s)`
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
                    const currentTimestampSeconds = Math.floor(
                        Date.now() / 1000
                    );

                    await hre.ethers.provider.send(
                        "evm_setNextBlockTimestamp",
                        [currentTimestampSeconds]
                    );
                    await hre.ethers.provider.send("evm_mine", []);

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
                            currentTimestampSeconds,
                            timestamp: latestBlock.timestamp,
                            transactionCount: transactionHashes.length,
                            transactionHashes
                        }
                    );

                    void this.eventCountsBarrier.signal();
                },
                {
                    maxRetries: 30,
                    delayMs: 5,
                    useExponentialBackoff: false
                }
            ).finally(() => {
                this.autoTimeAdvanceTickInProgress = false;
            });
        }, intervalSeconds * 1000);
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
        this.context = new HarnessContext();

        // Cleanup discovery server and peer servers
        await LocalDiscoveryServer.cleanup();

        this.logger.dispose();
    }

    getPeer(index: number): TestPeer<TCustomRpc, TStateMachine> {
        const peer = this.peers[index];
        if (!peer) throw new Error(`Peer ${index} not found`);
        return peer;
    }

    getPeerAddresses(): Address[] {
        return this.peers.map((p) => p.address);
    }

    getFilteredPeers(
        peerIndices?: number[]
    ): TestPeer<TCustomRpc, TStateMachine>[] {
        return peerIndices
            ? peerIndices.map((i) => this.getPeer(i))
            : this.peers;
    }

    getHonestPeers(
        excludePeerIndices?: number[]
    ): TestPeer<TCustomRpc, TStateMachine>[] {
        const excludeSet = new Set<number>([
            ...(excludePeerIndices ?? []),
            ...(this.context.maliciousPeerIndices ?? [])
        ]);
        return this.peers.filter((peer) => !excludeSet.has(peer.index));
    }

    async peerWithHighestBlock(
        forkId: ForkId
    ): Promise<TestPeer<TCustomRpc, TStateMachine>> {
        const malicious = new Set(this.context.maliciousPeerIndices ?? []);
        const heights = await Promise.all(
            this.peers.map((peer) =>
                malicious.has(peer.index)
                    ? Promise.resolve(null)
                    : this.control(peer)
                          .query.getLatestBlockHeight(forkId)
                          .request()
            )
        );

        let best: TestPeer<TCustomRpc, TStateMachine> | undefined;
        let bestHeight = Number.NEGATIVE_INFINITY;
        this.peers.forEach((peer, i) => {
            const h = heights[i];
            if (h === null || h === undefined) return;
            if (h > bestHeight) {
                bestHeight = h;
                best = peer;
            }
        });
        return best ?? this.peers[0];
    }

    /** Every harness `peers` entry except leavers and malicious (same nodes as post-`addPeer` spectators). */
    getPeersExcludingMaliciousAndLeavers(): TestPeer<
        TCustomRpc,
        TStateMachine
    >[] {
        const exclude = new Set([
            ...(this.context.leftChannelPeerIndices ?? []),
            ...(this.context.maliciousPeerIndices ?? [])
        ]);
        return this.peers.filter((p) => !exclude.has(p.index));
    }

    getFilteredOrHonestPeers(
        peerIndices?: number[]
    ): TestPeer<TCustomRpc, TStateMachine>[] {
        if (peerIndices) {
            return this.getFilteredPeers(peerIndices);
        }
        return this.getHonestPeers();
    }
    getConfig(): Partial<Config> {
        return this.harnessConfig;
    }

    /**
     * Push every peer's private key to `peer`'s host once, so host-side dispute
     * tamper callbacks can re-sign inner blocks authored by any peer (a peer's
     * host otherwise holds only its own key). Keys are mnemonic-derived.
     */
    /**
     * Drain every peer's host-side detached async work over the port and return
     * any rejections. The orchestrator settles host work this way (instead of
     * reaching into a realm-local global) so it behaves the same inline, in a
     * worker, or remote.
     */
    /**
     * Run `fn(sm, args)` host-side with the live stateManager injected, returning
     * its serializable result. The escape hatch for white-box scenarios that must
     * drive in-process internals (mutex, validationService, local RPC services).
     * `fn` is shipped as source: closure-free, reach everything via `sm`, pass
     * captured values via `args`.
     */
    async execOnHost<
        T,
        A extends Record<string, unknown> = Record<string, never>
    >(
        peer: TestPeer<TCustomRpc, TStateMachine>,
        fn: (sm: StateManager<HarnessControlRpc>, args: A) => T | Promise<T>,
        args: A = {} as A
    ): Promise<T> {
        return (await this.control(peer)
            .scenario.exec(fn.toString(), args)
            .request()) as T;
    }

    async quiesceHosts(): Promise<Error[]> {
        const perPeer = await Promise.all(
            this.peers.map((peer) =>
                peer.p2pInstance
                    .quiesce()
                    .catch((error: unknown) => [
                        error instanceof Error
                            ? error
                            : new Error(String(error))
                    ])
            )
        );
        return perPeer.flat();
    }

    async ensurePeerSignersRegistered(
        peer: TestPeer<TCustomRpc, TStateMachine>
    ): Promise<void> {
        if (this.peerSignersRegistered.has(peer.index)) return;
        const secrets = this.peers
            .map((p) => this.resolveSignerSecret(p.index, p.address))
            .filter((secret): secret is string => !!secret);
        await this.control(peer).signer.registerPeerSigners(secrets).request();
        this.peerSignersRegistered.add(peer.index);
    }
}

export default PeerTestHarness;
