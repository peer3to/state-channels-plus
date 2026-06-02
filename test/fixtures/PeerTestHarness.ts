import { Signer, ethers } from "ethers";
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
    EventBarrier
} from "@/utils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { createConfig, Config, config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { type LocalStateMachineDeployer } from "../../scripts/V1/deploy";
import SyncCoordinator from "@test/utils/SyncCoordinator";
import MainRpcService from "@/rpc/MainRpcService";

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
import { InlinePeer } from "@test/harness/core/InlinePeer";
import type {
    LocalDiamondView,
    PeerHandle
} from "@test/harness/core/PeerHandle";
import { StubCallbackRegistry } from "@test/harness/core/StubCallbackRegistry";
import { WorkerPeer } from "@test/harness/core/WorkerPeer";
import {
    SpyMirror,
    makeWorkerEventSpy,
    type WorkerEventSpy
} from "@test/harness/core/SpyMirror";
import { PeerWorker } from "@test/harness/threaded/PeerWorker";
import { HttpHardhatNode } from "@test/harness/threaded/HttpHardhatNode";
import { HarnessDebug } from "./HarnessDebug";
import { LogLevel } from "@/utils/logging/Logger";

const DEFAULT_HARNESS_DISPUTE_EXECUTION_GAS_LIMIT = 3_000_000;

/**
 * Main test harness for E2E peer-to-peer testing
 */
export class PeerTestHarness<
    TCustomRpc extends MainRpcService = MainRpcService,
    TStateMachine extends AStateMachineContract = AStateMachineContract
> {
    public peers: TestPeer<TCustomRpc, TStateMachine>[] = [];
    public peerHandles: PeerHandle[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedStateMachineDeployer!: LocalStateMachineDeployer;
    public channelId!: ChannelId;
    public options!: HarnessOptions<TCustomRpc>;
    private harnessConfig!: Partial<Config>;
    private readonly deployment: HarnessDeploymentConfig<TStateMachine>;
    private readonly deploymentModule?: string;
    public logger: Logger;
    public syncCoordinator!: SyncCoordinator;
    private autoTimeAdvanceInterval?: NodeJS.Timeout;
    private autoTimeAdvanceTickInProgress = false;
    private restoreAutomineOnCleanup = false;
    // Started when dedicatedPeerThread; workers dial chainProviderUrl.
    private httpHardhatNode?: HttpHardhatNode;
    private chainProviderUrl?: string;
    private spawnedWorkers: PeerWorker[] = [];

    // Orchestrator-side tamper closures; worker calls back via harness.tamperDispute.
    public tamperFnsByPeer = new Map<
        number,
        (
            dispute: unknown,
            disputeConfirmation: unknown,
            auditingData: unknown
        ) =>
            | void
            | Promise<void>
            | {
                  dispute: unknown;
                  disputeConfirmation: unknown;
                  auditingData: unknown;
              }
            | Promise<{
                  dispute: unknown;
                  disputeConfirmation: unknown;
                  auditingData: unknown;
              }>
    >();

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
    public lifecycle!: LifecycleActions;
    public join!: JoinActions;
    public transition!: TransitionActions;
    public network!: NetworkController;
    public assert!: AssertActions;
    public byzantine!: ByzantineActions;
    public event!: EventActions;
    public query!: StateQueryActions;
    public dispute!: DisputeOrchestrator;
    public tamper!: DisputeTamperingActions;
    public rpc!: RPCActions;
    public rpcStub!: RpcStubActions;
    public contextApi!: ContextActions;
    public scenario!: ScenarioActions;
    public readonly debug: HarnessDebug;

    /**
     * First honest peer's fork ID is considered the active fork ID for the channel.
     */
    public get activeForkId(): ForkId | undefined {
        const honestPeers = this.getHonestPeers();

        if (honestPeers.length === 0) {
            throw new Error(
                "No honest peers available to determine active fork ID"
            );
        }

        if (this.options.dedicatedPeerThread) {
            // Worker peers have no inline stateManager; forkId comes from the handle cache.
            return this.peerHandles[honestPeers[0].index]?.forkId;
        }
        return honestPeers[0].stateManager.forkId;
    }

    constructor({
        deployment,
        deploymentModule
    }: HarnessConstructorOptions<TStateMachine>) {
        // JSON.stringify cannot serialize BigInt.
        if (typeof (BigInt.prototype as any).toJSON !== "function") {
            (BigInt.prototype as any).toJSON = function () {
                return Number(this);
            };
        }
        dotenv.config(); // use .env since it's gitignored and it's only for testing - not altering SDK usage
        createConfig(testConfig); // Ensure config is initialized for tests
        this.deployment = deployment;
        this.deploymentModule = deploymentModule;

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

    async setup(
        numPeers: number,
        options?: HarnessOptions<TCustomRpc>
    ): Promise<void> {
        if (numPeers < 2 || numPeers > 10) {
            throw new Error("Number of peers must be between 2 and 10");
        }
        this.harnessConfig = {
            ...testConfig,
            ...(options?.configOverrides || {})
        };

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
            customRpc: options?.customRpc,
            customRpcOptions: options?.customRpcOptions,

            dedicatedPeerThread:
                options?.dedicatedPeerThread ??
                process.env.HARNESS_DEDICATED_PEER_THREAD === "true"
        };
        if (
            !this.options.timeConfig?.agreementTime ||
            this.options.timeConfig.agreementTime <= 1
        )
            throw new Error(
                "agreementTime must be greater than 1 second for reliable test execution"
            );
        this.syncCoordinator = new SyncCoordinator(
            this.logger,
            this.eventCountsBarrier
        );
        if (this.options.dedicatedPeerThread) {
            this.syncCoordinator.setProbe({
                loadTip: (peerIndex, forkId) =>
                    this.getPeerHandle(peerIndex).queryLatestBlock(forkId),
                didEveryoneSignBlock: async (peerIndex, blockHash) =>
                    this.getPeerHandle(peerIndex).queryDidEveryoneSignBlock(
                        blockHash
                    )
            });
        }

        await this.deployContracts();
        if (this.options.dedicatedPeerThread) {
            this.httpHardhatNode = new HttpHardhatNode();
            const { url } = await this.httpHardhatNode.start();
            this.chainProviderUrl = url;
            await LocalDiscoveryServer.tryStart();
        }
        const signers = await hre.ethers.getSigners();
        await Promise.all(
            Array.from({ length: numPeers }, (_, i) =>
                this.createPeer(i, signers[i])
            )
        );

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
        const [hardhatSigner] = await hre.ethers.getSigners();
        const deployment = this.deployment;

        this.sharedStateMachineDeployer =
            this.createLocalStateMachineDeployer(deployment);

        const channelManagerAddress = await deployment.deployOnChainContracts({
            signer: hardhatSigner,
            stateMachineGasLimit: this.options.stateMachineGasLimit!,
            disputeExecutionGasLimit: this.options.disputeExecutionGasLimit!,
            timeConfig: this.options.timeConfig as TimeConfig,
            harnessConfig: this.harnessConfig
        });

        this.channelManager = StateChannelManagerProxy__factory.connect(
            channelManagerAddress,
            hardhatSigner
        );
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
            onSetState: () => {
                peerLogger.debug("State set", { component: "P2pEventHooks" });
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

        // Worker peers run p2pSetup in-process; skip here to avoid discovery registry races.
        let peer: TestPeer<TCustomRpc, TStateMachine>;
        if (this.options.dedicatedPeerThread) {
            peer = {
                index,
                signer,
                address,
                p2pInstance: undefined as never,
                stateManager: undefined as never,
                contractInstance: undefined as never,
                eventSpies,
                turnBarrier: peerTurnBarrier,
                logger: peerLogger
            };
            // Worker events arrive via SpyMirror instead of these hooks.
            void hooks;
        } else {
            const contractInstanceMock = this.deployment.connectSigner(
                ethers.ZeroAddress,
                signer
            );

            const p2pInstance = await EvmStateMachine.p2pSetup<
                TStateMachine,
                TCustomRpc,
                any
            >(
                signer,
                this.channelManager,
                contractInstanceMock,
                this.sharedStateMachineDeployer,
                {
                    peerId: index,
                    peerLogger: peerLogger,
                    p2pEventHooks: hooks,
                    customPrecompiles: this.options.customPrecompiles!,
                    customRpc: this.options.customRpc,
                    customRpcOptions: this.options.customRpcOptions,
                    config: this.harnessConfig
                }
            );

            peer = {
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

            this.wrapEventHandlerWithSpies(peer);
        }

        this.peers[index] = peer;
        this.peerHandles[index] = await this.createPeerHandle(peer);

        this.logger.debug(`Peer ${index} created successfully`);
    }

    private async createPeerHandle(
        peer: TestPeer<TCustomRpc, TStateMachine>
    ): Promise<PeerHandle> {
        if (!this.options.dedicatedPeerThread) {
            return new InlinePeer(peer as unknown as TestPeer);
        }
        if (!this.chainProviderUrl) {
            throw new Error(
                "PeerTestHarness: dedicatedPeerThread set but chainProviderUrl missing"
            );
        }
        const registryPort = LocalDiscoveryServer.getDiscoveryPort();
        if (!registryPort) {
            throw new Error(
                "PeerTestHarness: LocalDiscoveryServer.tryStart() did not produce a port"
            );
        }
        const pk = await this.resolveSignerPk(peer.index);
        const worker = await PeerWorker.spawn({
            index: peer.index,
            signerPk: pk,
            channelId: this.options.channelId!,
            discoveryRegistryPort: registryPort,
            channelManagerAddress: this.channelManager.target as string,
            harnessConfig: {
                timeConfig: this.options.timeConfig as never,
                configOverrides: this.harnessConfig as Record<string, unknown>,
                stateMachineGasLimit: this.options.stateMachineGasLimit!,
                disputeExecutionGasLimit: this.options.disputeExecutionGasLimit!
            },
            logConfig: { level: this.options.logLevel! },
            chainProviderUrl: this.chainProviderUrl,
            deploymentModule: this.requireDeploymentModule()
        });
        this.spawnedWorkers.push(worker);

        const stubCallbackRegistry = new StubCallbackRegistry();
        const rpcServer = worker.getRpcServer();
        rpcServer.register("harness.invokeStubCallback", async (args) => {
            const { id, args: callArgs } = (args ?? {}) as {
                id?: string;
                args?: readonly unknown[];
            };
            if (!id) throw new Error("harness.invokeStubCallback: missing id");
            return await stubCallbackRegistry.invokeStub(id, callArgs ?? []);
        });
        rpcServer.register("harness.invokeFilterCallback", async (args) => {
            const { id, message } = (args ?? {}) as {
                id?: string;
                message?: string;
            };
            if (!id)
                throw new Error("harness.invokeFilterCallback: missing id");
            if (message === undefined)
                throw new Error(
                    "harness.invokeFilterCallback: missing message"
                );
            return await stubCallbackRegistry.invokeFilter(id, message);
        });

        rpcServer.register("harness.tamperDispute", async (args) => {
            const { peerIndex, dispute, disputeConfirmation, auditingData } =
                (args ?? {}) as {
                    peerIndex: number;
                    dispute: unknown;
                    disputeConfirmation: unknown;
                    auditingData: unknown;
                };
            const fn = this.tamperFnsByPeer.get(peerIndex);
            if (!fn) return { dispute, disputeConfirmation, auditingData };
            const ret = await fn(dispute, disputeConfirmation, auditingData);
            if (ret && typeof ret === "object" && "dispute" in ret) {
                return ret;
            }

            return { dispute, disputeConfirmation, auditingData };
        });

        const mirror = new SpyMirror(this.eventCountsBarrier);
        worker.getRpcClient().on("spy", (payload: unknown) => {
            const frame = payload as Parameters<SpyMirror["ingest"]>[0];
            mirror.ingest(frame);
            switch (frame.name) {
                case "onConnection":
                    void this.connectionBarrier.signal();
                    break;
                case "onDisconnection":
                    void this.disconnectionBarrier.signal();
                    break;
                case "onTurn":
                    void peer.turnBarrier.signal();
                    break;
            }
        });
        // Orchestrator sinon spies never fire in worker mode; mirror-backed spies report pushed counts.
        const workerSpies = peer.eventSpies as unknown as Record<
            string,
            WorkerEventSpy
        >;
        for (const name of Object.keys(peer.eventSpies)) {
            workerSpies[name] = makeWorkerEventSpy(mirror, peer.index, name);
        }
        return new WorkerPeer({
            index: peer.index,
            address: peer.address,
            signer: peer.signer,
            logger: peer.logger,
            eventSpies: peer.eventSpies,
            turnBarrier: peer.turnBarrier,
            rpc: worker.getRpcClient(),
            mirror,
            stubCallbackRegistry,
            onDispose: async () => {
                await worker.dispose();
            }
        });
    }

    private requireDeploymentModule(): string {
        if (!this.deploymentModule) {
            throw new Error(
                "PeerTestHarness: dedicatedPeerThread requires deploymentModule on the harness ctor"
            );
        }
        return this.deploymentModule;
    }

    // Derive the same private key Hardhat uses for getSigners()[i].
    private async resolveSignerPk(peerIndex: number): Promise<string> {
        const network = hre.network.config as unknown as {
            accounts?: { mnemonic?: string } | string[];
        };
        const acc = network.accounts;
        if (Array.isArray(acc)) {
            const pk = acc[peerIndex];
            if (!pk)
                throw new Error(
                    `PeerTestHarness.resolveSignerPk: no account at index ${peerIndex}`
                );
            return pk;
        }
        const mnemonic = acc?.mnemonic;
        if (!mnemonic) {
            throw new Error(
                "PeerTestHarness.resolveSignerPk: hre.network.config.accounts.mnemonic missing"
            );
        }
        const wallet = ethers.HDNodeWallet.fromPhrase(
            mnemonic,
            undefined,
            `m/44'/60'/0'/0/${peerIndex}`
        );
        return wallet.privateKey;
    }

    getPeerHandle(index: number): PeerHandle {
        const handle = this.peerHandles[index];
        if (!handle) throw new Error(`PeerHandle ${index} not found`);
        return handle;
    }

    private wrapEventHandlerWithSpies(
        peer: TestPeer<TCustomRpc, TStateMachine>
    ): void {
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

        peer.stateManager.eventHandler = eventHandlerProxy;
        peer.stateManager.stateChannelEventListener.eventHandler =
            eventHandlerProxy;
    }

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

                if (peer.p2pInstance) {
                    disposePromises.push(peer.p2pInstance.dispose());
                }

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

        // Dispose workers before the HTTP node so RPC sockets release first.
        if (this.spawnedWorkers.length) {
            await Promise.allSettled(
                this.spawnedWorkers.map((w) => w.dispose())
            );
            this.spawnedWorkers = [];
        }
        if (this.httpHardhatNode) {
            await this.httpHardhatNode.close();
            this.httpHardhatNode = undefined;
            this.chainProviderUrl = undefined;
        }

        await new Promise((resolve) => setImmediate(resolve));

        this.peers = [];
        this.peerHandles = [];

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
        return this.peerHandles.map((h) => h.address);
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
        let best: TestPeer<TCustomRpc, TStateMachine> | undefined;
        let bestHeight = Number.NEGATIVE_INFINITY;
        for (const peer of this.peers) {
            if (malicious.has(peer.index)) continue;
            let h: number | undefined;
            if (this.options.dedicatedPeerThread) {
                const latest = await this.getPeerHandle(
                    peer.index
                ).queryLatestBlock(forkId);
                h = latest?.height;
            } else {
                h =
                    peer.stateManager.storage.blocks.getLatestBlock(
                        forkId
                    )?.height;
            }
            if (h === undefined) continue;
            if (h > bestHeight) {
                bestHeight = h;
                best = peer;
            }
        }
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

    localDiamondView(peerIndex: number): LocalDiamondView {
        const handle = this.getPeerHandle(peerIndex);
        return {
            async getLatestBlockFromStateProof(stateProof) {
                return await handle.queryLatestBlockFromStateProof(stateProof);
            },
            async getDisputeWindows(channelId, forkIds) {
                return handle.queryDisputeWindows({
                    channelId: channelId as string,
                    forkIds: forkIds as string[]
                });
            }
        };
    }
}

export default PeerTestHarness;
