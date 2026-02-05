import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { BytesLike, Signer } from "ethers";
import * as sinon from "sinon";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { setImmediate } from "node:timers";
import { EvmStateMachine, P2pInstance } from "@/evm";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { AStateMachine, StateChannelManagerProxy } from "@typechain-types";
import { ForkId, ChannelId, Address, Hash, Bytes } from "@/types/types";
import { TimeConfig } from "@/types/time";
import {
    createOpenChannelTestObject,
    createJoinChannelTestObject
} from "@test/test_utils/testHelpers";
import {
    createLogger,
    LocalDiscoveryServer,
    Logger,
    SignatureUtils,
    Codec,
    Type,
    retry,
    EventBarrier,
    sleep
} from "@/utils";
import {
    JoinChannelStruct,
    OpenChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import Clock from "@/Clock";
import { createConfig, Config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { deployFullStack } from "../../scripts/V1/deploy";
import SyncCoordinator from "@test/utils/SyncCoordinator";
import { ZeroHash } from "ethers";
import type { RpcServiceFactoryMap } from "@/rpc/registry";

import { ChannelActions } from "@test/harness/actions/ChannelActions";
import { TransitionActions } from "@test/harness/actions/TransitionActions";
import { SyncActions } from "@test/harness/actions/SyncActions";
import { NetworkController } from "@test/harness/actions/NetworkController";
import { AssertActions } from "@test/harness/actions/AssertActions";
import { ByzantineActions } from "@test/harness/actions/ByzantineActions";
import { EventActions } from "@test/harness/actions/EventActions";
import { StateQueryActions } from "@test/harness/actions/StateQueryActions";
import { DisputeOrchestrator } from "@test/harness/actions/DisputeOrchestrator";

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
    joinChannelCommitment?: JoinChannelStruct;
    turnBarrier: EventBarrier;
    logger: Logger;
}

/**
 * Spy functions for tracking event calls
 * match with P2pEventHooks and EventHandler methods
 */
export interface EventSpies {
    // P2pEventHooks spies
    onConnection?: sinon.SinonSpy;
    onTurn?: sinon.SinonSpy;
    onSetState?: sinon.SinonSpy;
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
}

/**
 * Options for configuring the test harness
 */
export interface HarnessOptions<
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> {
    /**
     * ⚙️ LOG LEVEL CONTROL (for cleaner test output)
     *
     * Set to "error" to suppress verbose logs during tests.
     * Set to "debug" or "verbose" for detailed debugging.
     *
     * @example
     * ```ts
     * // Quiet tests (recommended for CI/passing tests)
     * Scenario.emptyChannel(3, { logLevel: "error" })
     *
     * // Verbose debugging (when investigating failures)
     * Scenario.emptyChannel(3, { logLevel: "debug" })
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
}

export type SubmitTransactionOptions = {
    waitForSync?: boolean;
    waitForPeers?: number[];
    waitForTurn?: boolean;
};

export type AssertAllPeersInSyncOptions = {
    expectedState?: Bytes;
    peerIndices?: number[];
};

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

export type CreateAndResolveForkResult<
    T extends AStateMachine,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    TFactories extends RpcServiceFactoryMap = {}
> = {
    originalForkId: ForkId;
    reducedForkId: ForkId;
    maliciousPeerIndex: number;
    honestPeerIndices: number[];
    honestPeers: Array<TestPeer<T, TFactories>>;
};

type BuildOpenChannelArgs = {
    participantAddresses?: string[];
    initialBalance?: number;
    channelId?: string;
    deadlineTimestamp?: number;
};

type BuildOpenChannelRequestArgs = BuildOpenChannelArgs & {
    signerIndices?: number[];
};

type BuildJoinChannelRequestArgs = {
    participantSigner: Signer;
    channelId?: string;
    deadlineTimestamp?: number;
    thresholdSignerIndices?: number[] | "all";
};

/**
 * Main test harness for E2E peer-to-peer testing
 */
export class PeerTestHarness<
    T extends AStateMachine,
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

    public peers: TestPeer<T, TFactories>[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedDeployTx!: any;
    public channelId!: ChannelId;
    public options!: Required<HarnessOptions<TFactories>>;
    public activeForkId?: ForkId;
    private harnessConfig!: Partial<Config>;
    public logger: Logger;
    private syncCoordinator!: SyncCoordinator;
    private autoTimeAdvanceInterval?: NodeJS.Timeout;

    // barriers
    public connectionBarrier: EventBarrier;
    public eventCountsBarrier: EventBarrier;

    // action instances
    public readonly channelActions!: ChannelActions;
    public readonly transitionActions!: TransitionActions;
    public readonly syncActions!: SyncActions;
    public readonly networkController!: NetworkController;
    public readonly assertActions!: AssertActions;
    public readonly byzantineActions!: ByzantineActions;
    public readonly eventActions!: EventActions;
    public readonly stateQuery!: StateQueryActions;
    public readonly disputeOrchestrator!: DisputeOrchestrator;

    constructor() {
        // toJSON can't serialize BigInts, so we need to override it
        if (typeof (BigInt.prototype as any).toJSON !== "function") {
            (BigInt.prototype as any).toJSON = function () {
                return Number(this);
            };
        }
        createConfig(); // Ensure config is initialized -> load env for tests

        // Logger starts with default level - will be reconfigured in setup()
        this.logger = createLogger({}, { component: "TestHarness" });
        LocalDiscoveryServer.setLogger(this.logger);
        this.connectionBarrier = new EventBarrier(this.logger);
        this.eventCountsBarrier = new EventBarrier(this.logger);

        // Initialize action instances
        (this as any).channelActions = new ChannelActions(this, this.logger);
        (this as any).transitionActions = new TransitionActions(
            this,
            this.logger
        );
        (this as any).syncActions = new SyncActions(this, this.logger);
        (this as any).networkController = new NetworkController(
            this,
            this.logger
        );
        (this as any).assertActions = new AssertActions(this, this.logger);
        (this as any).byzantineActions = new ByzantineActions(
            this,
            this.logger
        );
        (this as any).eventActions = new EventActions(this, this.logger);
        (this as any).stateQuery = new StateQueryActions(this, this.logger);
        (this as any).disputeOrchestrator = new DisputeOrchestrator(
            this,
            this.logger
        );
    }

    async setup<
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        const TNewFactories extends RpcServiceFactoryMap = {}
    >(
        numPeers: number,
        options?: HarnessOptions<TNewFactories>
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
                options?.logLevel ?? PeerTestHarness.defaultLogLevel ?? "info", // Use global default if not specified
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

        // Reconfigure logger with user-specified log level
        if (this.options.logLevel) {
            this.logger = createLogger(
                {},
                { component: "TestHarness" },
                { level: this.options.logLevel }
            );
            LocalDiscoveryServer.setLogger(this.logger);
        }

        this.syncCoordinator = new SyncCoordinator(this.logger);

        await this.deployContracts();
        const signers = await hre.ethers.getSigners();
        for (let i = 0; i < numPeers; i++) {
            await this.createPeer(i, signers[i]);
        }

        // Start automatic blockchain time advancement
        this.startAutoTimeAdvance();

        this.logger.info("Test harness setup completed");
    }

    /**
     * Create a new peer after `setup()` has already run.
     * If a channel is already open (i.e. `this.channelId` is set), the peer is also connected to that channel.
     */
    public async addPeer(signer?: Signer): Promise<TestPeer<T, TFactories>> {
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

        return peer as TestPeer<T, TFactories>;
    }

    private get forkId(): ForkId {
        // Always prefer the latest fork ID observed on the peers; keep
        // activeForkId in sync so callers that access it directly remain valid.
        const currentPeerForkId = this.peers[0]?.stateManager?.forkId;

        if (currentPeerForkId && currentPeerForkId !== ZeroHash) {
            if (this.activeForkId !== currentPeerForkId) {
                this.logger.debug(`Updating active forkId`, {
                    from: this.activeForkId,
                    to: currentPeerForkId
                });
                this.activeForkId = currentPeerForkId;
            }
            return currentPeerForkId;
        }

        if (this.activeForkId && this.activeForkId !== ZeroHash) {
            return this.activeForkId;
        }

        throw new Error("Fork ID unavailable");
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

        const PeerLogger = createLogger(
            {
                peerId: index,
                peerAddress: address
            },
            { component: `PeerTestHarness` },
            { level: this.options.logLevel } // Use same log level as harness
        );

        this.logger.debug(`Creating peer ${index} at ${address}`);

        const peerTurnBarrier = new EventBarrier(PeerLogger);

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
                PeerLogger.verbose(`Connection established with ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onConnection?.(addr, isChannelOpened);
                this.connectionBarrier.signal();
                this.eventCountsBarrier.signal();
            },
            onTurn: (
                addr: Address,
                _turnTime: number,
                _agreementTime: number,
                _chainFallbackTime: number
            ) => {
                PeerLogger.verbose(`Turn received from ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onTurn?.(addr);
                peerTurnBarrier.signal();
                this.eventCountsBarrier.signal();
            },
            onSetState: () => {
                PeerLogger.debug("State set", { component: "P2pEventHooks" });
                eventSpies.onSetState?.();
                this.eventCountsBarrier.signal();
            },
            onPostingCalldata: () => {
                PeerLogger.debug("Posting calldata to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostingCalldata?.();
                this.eventCountsBarrier.signal();
            },
            onPostedCalldata: () => {
                PeerLogger.debug("Calldata posted to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostedCalldata?.();
                this.eventCountsBarrier.signal();
            },
            onDisputeStarted: (maxDuration: number) => {
                PeerLogger.debug("Dispute started", {
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
                PeerLogger.info(
                    `Initiating dispute - DisputeHash:${disputeHash}`,
                    {
                        component: "P2pEventHooks"
                    }
                );
                eventSpies.onInitiatingDispute?.(disputeHash, dispute);
                this.eventCountsBarrier.signal();
            },
            onDisputeUpdate: (dispute: any) => {
                PeerLogger.info("Dispute updated", {
                    component: "P2pEventHooks"
                });
                eventSpies.onDisputeUpdate?.(dispute);
                this.eventCountsBarrier.signal();
            }
        };

        // Deploy MathStateMachine for this peer
        const mathSMFactory =
            await hre.ethers.getContractFactory("MathStateMachine");
        const mathInstance = await mathSMFactory.deploy(this.options.gasLimit);

        const p2pInstance = await EvmStateMachine.p2pSetup<any, TFactories>(
            signer,
            this.sharedDeployTx,
            this.channelManager,
            mathInstance,
            {
                peerId: index,
                peerLogger: PeerLogger,
                p2pEventHooks: hooks,
                rpcServiceFactories: this.options.rpcServiceFactories,
                config: this.harnessConfig
            }
        );

        const peer: TestPeer<T, TFactories> = {
            index,
            signer,
            address,
            p2pInstance,
            stateManager: p2pInstance.p2pSigner.p2pManager.stateManager,
            contractInstance: p2pInstance.p2pContractInstance,
            eventSpies,
            turnBarrier: peerTurnBarrier,
            logger: PeerLogger
        };

        // Wrap EventHandler methods with spies (without replacing the original functionality)
        this.wrapEventHandlerWithSpies(peer);

        this.peers.push(peer);
        this.logger.debug(`Peer ${index} created successfully`);
    }

    private wrapEventHandlerWithSpies(peer: TestPeer<T, TFactories>): void {
        const eventHandler = peer.stateManager.eventHandler;
        const spies = peer.eventSpies;
        const eventCountsBarrier = this.eventCountsBarrier;

        // Create a proxy that intercepts EventHandler method calls and calls both the spy and original method
        const eventHandlerProxy = new Proxy(eventHandler, {
            get(target, prop, receiver) {
                const originalMethod = Reflect.get(target, prop, receiver);

                // Only intercept EventHandler methods that have corresponding spies
                if (typeof originalMethod === "function" && prop in spies) {
                    return function (...args: any[]) {
                        // Call the spy first to record the call
                        const spy = spies[prop as keyof EventSpies];
                        spy?.(...args);

                        // Then call the original method
                        Reflect.apply(originalMethod, target, args);
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

    private buildOpenChannelStruct(
        args: BuildOpenChannelArgs = {}
    ): OpenChannelStruct {
        const participantAddresses =
            args.participantAddresses ?? this.peers.map((p) => p.address);

        const openChannel = createOpenChannelTestObject(participantAddresses, {
            channelId: args.channelId ?? this.options.channelId,
            initialBalance: args.initialBalance ?? this.options.initialBalance
        });

        if (args.deadlineTimestamp) {
            openChannel.deadlineTimestamp = args.deadlineTimestamp;
        }

        return openChannel;
    }

    private async signOpenChannelStruct(
        openChannel: OpenChannelStruct,
        signerIndices?: number[]
    ): Promise<BytesLike[]> {
        const indices = signerIndices ?? this.peers.map((peer) => peer.index);
        const signatures = await Promise.all(
            indices.map((i) =>
                SignatureUtils.signOpenChannel(
                    openChannel,
                    this.peers[i].signer
                ).then((s) => s.signature as BytesLike)
            )
        );
        return signatures;
    }

    /**
     * Build an encoded open-channel request plus signatures without submitting it.
     * Useful for tests that need to assert on failure cases (e.g., missing signatures).
     */
    async buildOpenChannelRequest(
        args: BuildOpenChannelRequestArgs = {}
    ): Promise<{
        openChannel: OpenChannelStruct;
        encodedOpenChannel: BytesLike;
        signatures: BytesLike[];
    }> {
        await Clock.init(this.peers[0].signer.provider!);

        const openChannel = this.buildOpenChannelStruct(args);
        const signatures = await this.signOpenChannelStruct(
            openChannel,
            args.signerIndices
        );

        return {
            openChannel,
            encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
            signatures
        };
    }

    /**
     * Build a join-channel confirmation and signatures without submitting it.
     */
    async buildJoinChannelRequest(args: BuildJoinChannelRequestArgs): Promise<{
        joinChannel: JoinChannelStruct;
        signedJoinChannel: { encodedJoinChannel: Bytes; signature: Bytes };
        signatures: Bytes[];
    }> {
        const participantAddress = await args.participantSigner.getAddress();
        const channelId =
            args.channelId ||
            this.channelId?.toString() ||
            this.options.channelId;

        const joinChannel = createJoinChannelTestObject(
            participantAddress,
            channelId
        );

        if (args.deadlineTimestamp) {
            joinChannel.deadlineTimestamp = args.deadlineTimestamp;
        }

        const signedJoin = await SignatureUtils.signJoinChannel(
            joinChannel,
            args.participantSigner
        );

        const signerIndices =
            args.thresholdSignerIndices === "all" ||
            args.thresholdSignerIndices === undefined
                ? this.peers.map((p) => p.index)
                : args.thresholdSignerIndices;

        const signatures = await Promise.all(
            signerIndices.map((i) =>
                SignatureUtils.signJoinChannel(
                    joinChannel,
                    this.peers[i].signer
                ).then((s) => s.signature as Bytes)
            )
        );

        return {
            joinChannel,
            signedJoinChannel: {
                encodedJoinChannel: signedJoin.encoded as Bytes,
                signature: signedJoin.signature as Bytes
            },
            signatures
        };
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Starts automatic blockchain time advancement to simulate natural time passing.
     * Advances chain time by 1 second every second.
     */
    startAutoTimeAdvance(intervalMs: number = 1000): void {
        if (this.autoTimeAdvanceInterval) {
            this.logger.debug("Auto time advance already running");
            return;
        }

        this.logger.debug(
            `Starting auto blockchain time advance (every ${intervalMs}ms)`
        );

        this.autoTimeAdvanceInterval = setInterval(
            () =>
                retry(() => time.increase(1), {
                    maxRetries: 30,
                    delayMs: 5,
                    useExponentialBackoff: false
                }),
            intervalMs
        );
    }
    async cleanup(): Promise<void> {
        this.logger.debug("Starting cleanup...");

        // Stop auto time advancement
        if (this.autoTimeAdvanceInterval) {
            clearInterval(this.autoTimeAdvanceInterval);
            this.autoTimeAdvanceInterval = undefined;
        }

        if (this.channelManager) {
            this.channelManager.removeAllListeners();
        }

        this.connectionBarrier.clear();
        this.eventCountsBarrier.clear();

        const disposePromises: Promise<any>[] = [];

        for (const peer of this.peers) {
            try {
                peer.logger.verbose("Cleaning up peer", {
                    component: "TestHarness"
                });
                peer.contractInstance.removeAllListeners();

                // Close P2P connections
                const connections = [
                    ...peer.p2pInstance.p2pSigner.p2pManager.openConnections
                ];
                for (const connection of connections) {
                    try {
                        connection.close();
                    } catch (error) {
                        peer.logger.warn(`Error closing connection: ${error}`);
                    }
                }
                peer.p2pInstance.p2pSigner.p2pManager.openConnections = [];

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

        // Clear context properties stored by Context and Event blocks
        delete (this as any).honestPeerIndices;
        delete (this as any).maliciousPeerIndex;
        delete (this as any).originalForkId;
        delete (this as any).newForkId;
        delete (this as any).lastMaliciousPeerIndex;

        // Cleanup discovery server and peer servers
        await LocalDiscoveryServer.cleanup();
    }

    getPeer(index: number): TestPeer<T, TFactories> {
        const peer = this.peers[index];
        if (!peer) throw new Error(`Peer ${index} not found`);
        return peer;
    }

    getPeerAddresses(): Address[] {
        return this.peers.map((p) => p.address);
    }

    getConfig(): Partial<Config> {
        return this.harnessConfig;
    }

    /**
     * Waits for a specific condition with timeout
     */
    async waitForCondition(
        condition: () => boolean | Promise<boolean>,
        timeoutMs: number = 10000,
        pollIntervalMs: number = 100
    ): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            if (await condition()) {
                return true;
            }
            await sleep(pollIntervalMs);
        }

        return false;
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
                return peerForks.every((fid) => fid === expectedForkId);
            } else {
                // All peers have moved to same new fork
                const uniqueForks = new Set(peerForks);
                return (
                    uniqueForks.size === 1 &&
                    peerForks.length === peersToCheck.length
                );
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
        } catch {
            return false;
        }
    }
}

export default PeerTestHarness;
