import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { BytesLike, Signer, ethers } from "ethers";
import { expect } from "chai";
import * as sinon from "sinon";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { setImmediate } from "node:timers";
import { EvmStateMachine, P2pInstance } from "@/evm";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { AStateMachine, StateChannelManagerProxy } from "@typechain-types";
import {
    ForkId,
    ChannelId,
    Address,
    BlockHeight,
    Hash,
    Bytes
} from "@/types/types";
import { TimeConfig } from "@/types/time";
import {
    createOpenChannelTestObject,
    createJoinChannelTestObject
} from "@test/test_utils/testHelpers";
import { pollUntil } from "@test/test_utils/pollUntil";
import {
    createLogger,
    LocalDiscoveryServer,
    Logger,
    SignatureUtils,
    Codec,
    Type,
    hash,
    retry,
    EventBarrier
} from "@/utils";
import Block from "@/models/Block";
import {
    JoinChannelStruct,
    BlockStruct,
    TransactionStruct,
    SignedBlockStruct,
    MessageBlockStruct,
    MessageStruct,
    BalanceStruct,
    OpenChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    TimeoutStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import Clock from "@/Clock";
import { createConfig, Config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { deployFullStack } from "../../scripts/V1/deploy";
import SyncCoordinator, {
    WaitForPeersInSyncOptions
} from "@test/utils/SyncCoordinator";
import { ZeroHash } from "ethers";
import { ATransport } from "@/transport";
import PeerProfile from "@/PeerProfile";
import type { RpcServiceFactoryMap } from "@/rpc/registry";
import DisputeManager, {
    ConstructDisputeResult
} from "@/disputeManager/DisputeManager";

export interface TestPeer<
    T extends AStateMachine,
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
export interface HarnessOptions<TFactories extends RpcServiceFactoryMap = {}> {
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
    TFactories extends RpcServiceFactoryMap = {}
> {
    public peers: TestPeer<T, TFactories>[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedDeployTx!: any;
    public channelId!: ChannelId;
    private options!: Required<HarnessOptions<TFactories>>;
    public activeForkId?: ForkId;
    private harnessConfig!: Partial<Config>;
    private logger: Logger;
    private syncCoordinator!: SyncCoordinator;
    private autoTimeAdvanceInterval?: NodeJS.Timeout;

    // barriers
    private connectionBarrier: EventBarrier;
    private eventCountsBarrier: EventBarrier;

    constructor() {
        // toJSON can't serialize BigInts, so we need to override it
        if (typeof (BigInt.prototype as any).toJSON !== "function") {
            (BigInt.prototype as any).toJSON = function () {
                return Number(this);
            };
        }
        createConfig(); // Ensure config is initialized -> load env for tests
        this.logger = createLogger({ component: "TestHarness" });
        this.connectionBarrier = new EventBarrier(this.logger);
        this.eventCountsBarrier = new EventBarrier(this.logger);
    }

    async setup<const TNewFactories extends RpcServiceFactoryMap = {}>(
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
    public async waitForTurn(peer: TestPeer<T, TFactories>, timeoutMs = 3000) {
        try {
            await peer.turnBarrier.waitFor(
                () => peer.stateManager.isMyTurn?.() ?? false,
                {
                    timeoutMs,
                    timeoutMessage: `Turn not received within ${timeoutMs}ms`
                }
            );
            this.logger.debug(`Peer ${peer.index} turn`);
        } catch (e) {
            this.logger.error(`Peer ${peer.index} turn wait timed out`);
            throw e;
        }
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

        const PeerLogger = createLogger({
            peerId: index,
            peerAddress: address
        });

        this.logger.debug(`Creating peer ${index} at ${address}`);

        const peerTurnBarrier = new EventBarrier(PeerLogger);

        const eventSpies: EventSpies = {
            // P2pEventHooks spies
            onConnection: sinon.spy(),
            onTurn: sinon.spy(),
            onSetState: sinon.spy(),
            onPostingCalldata: sinon.spy(),
            onPostedCalldata: sinon.spy(),
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
            onTurn: (addr: Address) => {
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
        const harness = this;

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
                        return harness.eventCountsBarrier.signal();
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

    private async submitOpenChannel(
        openChannel: OpenChannelStruct,
        signatures: BytesLike[]
    ): Promise<ForkId> {
        this.channelId = openChannel.channelId;

        this.logger.debug(`Channel created with ID: ${openChannel.channelId}`);

        // Connect peers to the channel
        for (const peer of this.peers) {
            await peer.p2pInstance.p2pSigner.connectToChannel(
                openChannel.channelId
            );
            peer.logger.verbose(
                `Connected to channel ${openChannel.channelId}`,
                {
                    component: "TestHarness"
                }
            );
        }

        if (this.options.autoConnect) {
            await this.connectAllPeers();
        }

        this.logger.debug(
            "Submitting channel open transaction to blockchain..."
        );
        const tx = await this.channelManager.open({
            encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
            signatures
        });

        await Promise.all([tx.wait(), sleep(100)]);

        const isValidForkId = (forkId: ForkId | undefined): boolean =>
            !!forkId && forkId !== "0x00" && forkId !== "0x0";

        const getPeerForkIds = () =>
            this.peers.map((peer) => peer.stateManager.forkId);

        this.logger.debug("Waiting for fork ID to be set on all peers...");

        await pollUntil(
            () => {
                const peerForkIds = getPeerForkIds();
                const allValidAndSame =
                    peerForkIds.every(isValidForkId) &&
                    peerForkIds.every((id) => id === peerForkIds[0]);

                if (allValidAndSame) {
                    this.activeForkId = peerForkIds[0] as ForkId;
                    return true;
                }
                return false;
            },
            {
                timeoutMs: 2000,
                pollIntervalMs: 50,
                timeoutMessage:
                    "Failed to get fork ID on all peers after waiting 2000ms. Channel opening may have failed."
            }
        );

        // Wait for state machine to be properly initialized with participants on ALL peers
        this.logger.debug(
            "Waiting for state machine initialization on all peers..."
        );

        const allPeersInitialized = await pollUntil(
            async () => {
                try {
                    // Check if ALL peers have participants initialized
                    let initializedCount = 0;
                    let expectedParticipantCount = 0;

                    for (const peer of this.peers) {
                        const participants =
                            await peer.stateManager.diamondStateMachine.getParticipants();
                        if (participants && participants.length > 0) {
                            initializedCount++;
                            expectedParticipantCount = participants.length;
                        }
                    }

                    // All peers must have participants initialized
                    if (initializedCount === this.peers.length) {
                        this.logger.debug(
                            `State initialized on all ${this.peers.length} peers with ${expectedParticipantCount} participants each`
                        );
                        return true;
                    } else {
                        this.logger.debug(
                            `State initialization: ${initializedCount}/${this.peers.length} peers ready`
                        );
                        return false;
                    }
                } catch (error) {
                    // If we can't get participants yet, keep waiting
                    return false;
                }
            },
            {
                timeoutMs: 2000,
                pollIntervalMs: 50,
                throwOnTimeout: false
            }
        );

        if (!allPeersInitialized) {
            this.logger.warn(
                "State machine not fully initialized on all peers after 2000ms, continuing anyway..."
            );
        }

        if (!this.activeForkId) {
            throw new Error("Fork ID was not set after polling completed");
        }

        this.logger.info(
            `Channel opened successfully with fork ID: ${this.activeForkId}`
        );
        return this.activeForkId;
    }

    async openChannel(): Promise<ForkId> {
        this.logger.info("Opening channel...");
        await Clock.init(this.peers[0].signer.provider!);
        const openChannel = this.buildOpenChannelStruct();
        const signatures = await this.signOpenChannelStruct(openChannel);
        return this.submitOpenChannel(openChannel, signatures);
    }

    /**
     * Open a channel using only a subset of peer signatures (useful for negative tests).
     * This will submit the transaction and return the forkId on success; callers can
     * expect reverts when signatures are insufficient.
     */
    async openChannelWithSigners(
        args: BuildOpenChannelArgs = {},
        signerIndices: number[] | "all" = "all"
    ): Promise<ForkId> {
        if (signerIndices === "all") {
            signerIndices = this.peers.map((peer) => peer.index);
        }
        this.logger.info(
            `Opening channel with signers [${signerIndices.join(", ")}]...`
        );
        await Clock.init(this.peers[0].signer.provider!);

        const openChannel = this.buildOpenChannelStruct(args);
        const signatures = await this.signOpenChannelStruct(
            openChannel,
            signerIndices
        );

        return this.submitOpenChannel(openChannel, signatures);
    }

    async connectAllPeers(): Promise<void> {
        this.logger.debug("Connecting peers...");
        const started = await LocalDiscoveryServer.tryStart();
        if (started) {
            this.logger.verbose("Discovery server started");
        }
        await this.waitForP2PConnections();
        this.logger.debug("All peers connected successfully");
    }

    async connectPeers(peerIndices: number[]): Promise<void> {
        const started = await LocalDiscoveryServer.tryStart();
        if (started) {
            this.logger.verbose("Discovery server started");
        }

        // Connect each peer in the subset
        await Promise.all(
            peerIndices.map((index) =>
                this.peers[
                    index
                ].stateManager.p2pManager.tryOpenConnectionToChannel(
                    this.channelId!.toString()
                )
            )
        );

        await this.waitForP2PConnections();
    }

    async waitForP2PConnections(timeoutMs?: number): Promise<void> {
        const isGitHubActionsEnv = process.env.GITHUB_ACTIONS === "true";
        const defaultTimeout = isGitHubActionsEnv ? 15000 : 5000;
        const actualTimeout = timeoutMs ?? defaultTimeout;

        const condition = () =>
            this.peers.filter(
                (p) =>
                    p.p2pInstance.p2pSigner.p2pManager.openConnections.length >
                    0
            ).length >= Math.min(2, this.peers.length);

        if (await condition()) return;

        await this.connectionBarrier.waitFor(condition, {
            timeoutMs: actualTimeout,
            timeoutMessage: `P2P connections not established within ${actualTimeout}ms`
        });
    }

    async submitTransaction(
        peer: TestPeer<T, TFactories>,
        txFn: (contract: T) => Promise<any>,
        options: SubmitTransactionOptions = { waitForSync: true }
    ): Promise<void> {
        if (options.waitForTurn) {
            await this.waitForTurn(peer);
        }
        // Execute transaction
        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (options.waitForSync) {
            await this.syncCoordinator.waitForPeersInSync(
                this.peers,
                this.forkId,
                {
                    peerIndices: options.waitForPeers
                }
            );
        }

        return result;
    }
    async submitNextTransaction(
        txFn: (contract: T) => Promise<any>,
        options: SubmitTransactionOptions = { waitForTurn: true }
    ): Promise<void> {
        const nextPeer = await this.getNextPeerToWrite();

        if (options.waitForTurn) {
            await this.waitForTurn(nextPeer);
        }

        await this.submitTransaction(nextPeer, txFn, {
            waitForSync: options.waitForSync ?? true,
            waitForPeers: options.waitForPeers
        });
    }

    async waitForSync(options: WaitForPeersInSyncOptions = {}): Promise<void> {
        await this.syncCoordinator.waitForPeersInSync(
            this.peers,
            this.forkId,
            options
        );
    }

    async waitForEventProcessing(timeout: number = 100): Promise<void> {
        await sleep(timeout);
    }

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

        // Cleanup discovery server and peer servers
        await LocalDiscoveryServer.cleanup();
    }

    assertAllPeersInSync(options: AssertAllPeersInSyncOptions = {}): void {
        const { expectedState, peerIndices } = options;
        const indicesToCheck =
            peerIndices ??
            Array.from({ length: this.peers.length }, (_, i) => i);

        if (indicesToCheck.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const syncStatus = this.syncCoordinator.checkPeersInSync(
            this.peers,
            this.forkId,
            peerIndices
        );

        if (!syncStatus.inSync) {
            const details = syncStatus.syncDetails
                .map(
                    (d) =>
                        `Peer ${d.peerIndex}: hash=${d.blockHash} height=${d.height}`
                )
                .join("; ");
            throw new Error(`Peers not in sync - ${details}`);
        }

        // Check state machine state synchronization
        const firstPeerIndex = indicesToCheck[0];
        const firstPeerState = this.getStateMachineState(
            firstPeerIndex,
            this.forkId
        );

        for (let i = 1; i < indicesToCheck.length; i++) {
            const peerIndex = indicesToCheck[i];
            const peerState = this.getStateMachineState(peerIndex, this.forkId);

            expect(peerState).to.deep.equal(
                firstPeerState,
                `Peer ${peerIndex} state does not match Peer ${firstPeerIndex}`
            );
        }

        if (expectedState !== undefined) {
            expect(firstPeerState).to.deep.equal(
                expectedState,
                "Peer states do not match expected state"
            );
        }
    }

    assertEventCalled(
        peerIndex: number,
        eventName: keyof EventSpies,
        minTimes: number = 1
    ): void {
        const peer = this.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const spy = peer.eventSpies[eventName];
        if (!spy)
            throw new Error(
                `Event ${eventName} spy not found for peer ${peerIndex}`
            );
        expect(spy.callCount).to.be.at.least(
            minTimes,
            `Event ${eventName} should have been called at least ${minTimes} times for peer ${peerIndex}`
        );
    }

    getEventCallCount(peerIndex: number, eventName: keyof EventSpies): number {
        const peer = this.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);
        const spy = peer.eventSpies[eventName];
        return spy ? spy.callCount : 0;
    }

    async waitForEventCounts(
        eventName: keyof EventSpies,
        expectedCounts: Array<{ peerId: number; expectedCount: number }>,
        timeoutMs: number = 10000,
        { mode = "exact" }: { mode?: "exact" | "atLeast" } = { mode: "exact" }
    ): Promise<boolean> {
        const condition = () => {
            for (const { peerId, expectedCount } of expectedCounts) {
                const actualCount = this.getEventCallCount(peerId, eventName);
                if (
                    (mode === "exact" && actualCount !== expectedCount) ||
                    (mode === "atLeast" && actualCount < expectedCount)
                ) {
                    return false;
                }
            }
            return true;
        };

        try {
            await this.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `${String(eventName)} counts not reached within ${timeoutMs}ms`
            });
            return true;
        } catch {
            return false;
        }
    }

    getEventArgs(
        peerIndex: number,
        eventName: keyof EventSpies,
        callIndex: number = 0
    ): any {
        const peer = this.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const spy = peer.eventSpies[eventName];
        if (!spy)
            throw new Error(
                `Event ${eventName} spy not found for peer ${peerIndex}`
            );
        if (callIndex >= spy.callCount) {
            throw new Error(
                `Event ${eventName} was only called ${spy.callCount} times, cannot get call ${callIndex}`
            );
        }
        return spy.getCall(callIndex).args;
    }

    assertEventHandlerCalledTotalTimes(
        eventName: keyof EventSpies,
        expectedTotalCalls: number
    ): void {
        const totalCalls = this.peers.reduce((sum, peer) => {
            return sum + this.getEventCallCount(peer.index, eventName);
        }, 0);

        expect(totalCalls).to.equal(
            expectedTotalCalls,
            `Expected ${eventName} to be called ${expectedTotalCalls} times total across all peers, but was called ${totalCalls} times`
        );
    }

    resetEventSpies(peerIndex?: number): void {
        if (peerIndex !== undefined) {
            const peer = this.peers[peerIndex];
            if (!peer) throw new Error(`Peer ${peerIndex} not found`);
            Object.values(peer.eventSpies).forEach((spy) =>
                spy?.resetHistory()
            );
        } else {
            this.peers.forEach((peer) => {
                Object.values(peer.eventSpies).forEach((spy) =>
                    spy?.resetHistory()
                );
            });
        }
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

    getStateMachineState(peerIndex: number, forkId: ForkId): any {
        const peer = this.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            const genesisSnapshot =
                peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    forkId
                );
            return genesisSnapshot ? "genesis" : null;
        }

        const stateSnapshot =
            peer.stateManager.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );
        return stateSnapshot ? stateSnapshot.snapshotData : null;
    }

    async getStateMachineStateHash(peerIndex: number): Promise<string> {
        try {
            const peer = this.peers[peerIndex];
            if (!peer) return "peer_not_found";

            const latestBlock = peer.stateManager.storage.blocks.getLatestBlock(
                this.forkId
            );
            if (!latestBlock) return "no_block";

            return latestBlock.stateSnapshotHash?.toString() || "no_state_hash";
        } catch (error) {
            return `error: ${error}`;
        }
    }

    async getNextPeerToWrite(): Promise<TestPeer<T, TFactories>> {
        try {
            const nextAddress =
                await this.peers[0].stateManager.diamondStateMachine.getNextToWrite();

            this.logger.verbose(`getNextPeerToWrite returned: ${nextAddress}`);

            const nextPeer = this.peers.find(
                (peer) => peer.address === nextAddress
            );
            if (!nextPeer) {
                // Enhanced error reporting
                const stateHash = await this.getStateMachineStateHash(0);
                const peerAddresses = this.peers.map((p) => p.address);

                const latestBlock =
                    this.peers[0].stateManager.storage.blocks.getLatestBlock(
                        this.forkId
                    );
                const forkId = this.peers[0].stateManager.forkId;

                // Check participants on all peers for diagnostics
                const participantStates = await Promise.all(
                    this.peers.map(async (peer, i) => {
                        try {
                            const participants =
                                await peer.stateManager.diamondStateMachine.getParticipants();
                            return `Peer ${i}: ${participants.length} participants`;
                        } catch (err) {
                            return `Peer ${i}: error getting participants`;
                        }
                    })
                );

                throw new Error(
                    `No peer found with address ${nextAddress}. Available peers: ${peerAddresses.join(", ")}. ForkId: ${forkId}, StateHash: ${stateHash}, LatestBlockHeight: ${latestBlock?.height ?? "none"}. Participant states: ${participantStates.join(", ")}`
                );
            }

            return nextPeer;
        } catch (error) {
            this.logger.error(`getNextPeerToWrite failed: ${error}`);
            throw error;
        }
    }

    /**
     * Simulates a peer becoming unresponsive by disconnecting it from P2P network
     */
    async simulatePeerTimeout(peerIndex: number): Promise<void> {
        const peer = this.getPeer(peerIndex);

        // Disconnect the peer from all P2P connections
        const connections =
            peer.p2pInstance.p2pSigner.p2pManager.openConnections;
        for (const connection of connections) {
            peer.p2pInstance.p2pSigner.p2pManager.disconnectConnection(
                connection
            );
        }

        peer.logger.warn("Disconnected to simulate timeout");
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

    private async getParticipantPeerIndices(
        providerPeerIndex: number = 0
    ): Promise<number[]> {
        const provider = this.getPeer(providerPeerIndex);
        const participants =
            await provider.stateManager.diamondStateMachine.getParticipants();
        const participantSet = new Set(
            participants.map((a) => a.toString().toLowerCase())
        );

        return this.peers
            .map((p) => p.index)
            .filter((idx) =>
                participantSet.has(this.getPeer(idx).address.toLowerCase())
            );
    }

    /**
     * Creates a dispute via the provided action, then waits until:
     * - disputes are committed on-chain (observed via onDisputeCommitted events)
     * - honest peers converge on a new fork (fork reduction settled)
     */
    async createAndResolveDispute(
        disputeAction: () => Promise<void>,
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            honestPeerIndices?: number[];
            resetEventSpies?: boolean;
            disputesCommittedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            expectedDisputesCommittedPerPeer?: number;
            disputesCommittedMode?: "exact" | "atLeast";
            assertMaliciousRemoved?: boolean;
        }
    ): Promise<CreateAndResolveDisputeResult<T, TFactories>> {
        const originalForkId = options?.forkId || this.forkId;
        const honestPeerIndices =
            options?.honestPeerIndices ??
            (await this.getParticipantPeerIndices()).filter(
                (i) => i !== maliciousPeerIndex
            );

        if (honestPeerIndices.length < 1) {
            throw new Error(
                `Need at least 1 honest peer to resolve dispute (got ${honestPeerIndices.length})`
            );
        }

        if (options?.resetEventSpies !== false) {
            this.resetEventSpies();
        }

        await disputeAction();

        const disputesCommittedTimeoutMs =
            options?.disputesCommittedTimeoutMs ?? 5000;

        const expectedDisputesCommittedPerPeer =
            options?.expectedDisputesCommittedPerPeer ?? 1;

        const disputesCommitted = await this.waitForEventCounts(
            "onDisputeCommitted",
            honestPeerIndices.map((peerId) => ({
                peerId,
                expectedCount: expectedDisputesCommittedPerPeer
            })),
            disputesCommittedTimeoutMs,
            { mode: options?.disputesCommittedMode ?? "atLeast" }
        );

        if (!disputesCommitted) {
            throw new Error(
                `Disputes not committed across peers within ${String(
                    disputesCommittedTimeoutMs
                )}ms`
            );
        }

        const forkSettled = await this.waitForCondition(() => {
            const forkIds = honestPeerIndices.map(
                (idx) => this.getPeer(idx).stateManager.forkId
            );
            const uniqueForks = new Set(forkIds);
            const allMoved =
                forkIds.length > 0 &&
                forkIds.every(
                    (forkId) => forkId !== originalForkId && forkId !== ZeroHash
                );
            return allMoved && uniqueForks.size === 1;
        }, options?.forkSettleTimeoutMs ?? 10000);

        if (!forkSettled) {
            throw new Error(
                `Fork did not settle within ${String(
                    options?.forkSettleTimeoutMs ?? 10000
                )}ms`
            );
        }

        const honestPeers = honestPeerIndices.map((idx) => this.getPeer(idx));
        const newForkId = honestPeers[0]!.stateManager.forkId;

        if (newForkId === originalForkId || newForkId === ZeroHash) {
            throw new Error(
                `Expected new forkId after reduction (got ${newForkId})`
            );
        }

        if (options?.assertMaliciousRemoved ?? true) {
            const maliciousAddress = this.getPeer(maliciousPeerIndex).address;
            for (const peer of honestPeers) {
                const participants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                expect(participants).to.have.lengthOf(honestPeers.length);
                expect(participants).to.not.include(maliciousAddress);
            }
        }

        return {
            originalForkId,
            newForkId,
            maliciousPeerIndex,
            honestPeerIndices,
            honestPeers
        };
    }

    async createAndResolveInvalidStateTransitionDispute(
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            honestPeerIndices?: number[];
            resetEventSpies?: boolean;
            disputesCommittedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            disputesCommittedMode?: "exact" | "atLeast";
            expectedDisputesCommittedPerPeer?: number;
            assertMaliciousRemoved?: boolean;
        }
    ): Promise<CreateAndResolveDisputeResult<T, TFactories>> {
        return this.createAndResolveDispute(
            async () => {
                await this.submitInvalidStateTransitionBlock(
                    maliciousPeerIndex,
                    {
                        forkId: options?.forkId || this.forkId
                    }
                );
            },
            maliciousPeerIndex,
            options
        );
    }

    /**
     * Helper for tests that induce a fork via a double-sign block, then wait until
     * honest peers converge on the reduced fork.
     *
     * This intentionally does NOT wait on dispute event-counts; those can be flaky
     * and the spectate fork-traversal scenario only needs:
     * - original fork becomes disputed on-chain
     * - honest peers move to the same non-zero forkId != originalForkId
     */
    async createAndResolveDoubleSignFork(
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            honestPeerIndices?: number[];
            providerPeerIndex?: number;
            resetEventSpies?: boolean;
            waitForForkDisputedTimeoutMs?: number;
            forkSettleTimeoutMs?: number;
            disposeMaliciousPeer?: boolean;
        }
    ): Promise<CreateAndResolveForkResult<T, TFactories>> {
        const originalForkId = options?.forkId || this.forkId;
        const honestPeerIndices =
            options?.honestPeerIndices ??
            (
                await this.getParticipantPeerIndices(
                    options?.providerPeerIndex ?? 0
                )
            ).filter((i) => i !== maliciousPeerIndex);

        if (honestPeerIndices.length < 2) {
            throw new Error(
                `Need at least 2 honest peers to resolve fork (got ${honestPeerIndices.length})`
            );
        }

        if (options?.resetEventSpies !== false) {
            this.resetEventSpies();
        }

        await this.submitDoubleSignBlock(maliciousPeerIndex, {
            forkId: originalForkId
        });

        const providerPeerIndex =
            options?.providerPeerIndex ?? honestPeerIndices[0]!;
        const provider = this.getPeer(providerPeerIndex);

        const forkDisputed = await this.waitForCondition(
            async () => {
                return await provider.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                    this.channelId,
                    originalForkId
                );
            },
            options?.waitForForkDisputedTimeoutMs ?? 15000,
            250
        );

        if (!forkDisputed) {
            throw new Error(
                `Fork was not disputed within ${String(
                    options?.waitForForkDisputedTimeoutMs ?? 15000
                )}ms`
            );
        }

        if (options?.disposeMaliciousPeer ?? true) {
            await this.getPeer(maliciousPeerIndex).p2pInstance.dispose();
        }

        const forkSettled = await this.waitForCondition(() => {
            const forkIds = honestPeerIndices.map(
                (idx) => this.getPeer(idx).stateManager.forkId
            );
            const uniqueForks = new Set(forkIds);
            const allMoved =
                forkIds.length > 0 &&
                forkIds.every(
                    (forkId) => forkId !== originalForkId && forkId !== ZeroHash
                );
            return allMoved && uniqueForks.size === 1;
        }, options?.forkSettleTimeoutMs ?? 20000);

        if (!forkSettled) {
            throw new Error(
                `Fork did not settle within ${String(
                    options?.forkSettleTimeoutMs ?? 20000
                )}ms`
            );
        }

        const honestPeers = honestPeerIndices.map((idx) => this.getPeer(idx));
        const reducedForkId = honestPeers[0]!.stateManager.forkId;

        if (reducedForkId === originalForkId || reducedForkId === ZeroHash) {
            throw new Error(
                `Expected reduced forkId after settlement (got ${reducedForkId})`
            );
        }

        return {
            originalForkId,
            reducedForkId,
            maliciousPeerIndex,
            honestPeerIndices,
            honestPeers
        };
    }

    private getPreviousBlockHash(
        peer: TestPeer<T, TFactories>,
        forkId: ForkId,
        height?: BlockHeight
    ): Hash {
        if (height !== undefined) {
            const previousBlockOrSnapshot =
                peer.stateManager.storage.getPreviousBlockOrSnapshot({
                    forkId,
                    height
                });
            return previousBlockOrSnapshot.block
                ? previousBlockOrSnapshot.block.hash
                : previousBlockOrSnapshot.stateSnapshot!.hash;
        }

        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        return (
            previousBlock?.hash ||
            peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.hash ||
            ethers.ZeroHash
        );
    }

    private getStateSnapshotHash(
        peer: TestPeer<T, TFactories>,
        forkId: ForkId,
        previousBlock?: Block
    ): Hash {
        return previousBlock
            ? previousBlock.stateSnapshotHash
            : peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                  forkId
              )?.hash || ethers.ZeroHash;
    }

    async postJunkCalldataOnChain(
        peerIndex: number,
        options: {
            height: BlockHeight;
            forkId?: ForkId;
            encodedData?: Bytes;
        }
    ): Promise<BlockStruct> {
        const peer = this.getPeer(peerIndex);
        const forkId = options.forkId || this.forkId;
        const height = options.height;

        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        const previousBlockHash = this.getPreviousBlockHash(peer, forkId);
        const stateSnapshotHash = this.getStateSnapshotHash(
            peer,
            forkId,
            previousBlock
        );

        const encodedData: Bytes =
            options.encodedData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(height),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: encodedData,
                data: encodedData
            }
        };

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        // Create invalid signature by corrupting the hash
        const encodedBlock = Codec.encode(blockStruct, Type.Block);
        const blockHash = hash(encodedBlock);
        const corruptedBlockHash = hash(blockHash);
        const invalidSignature = await peer.signer.signMessage(
            ethers.getBytes(corruptedBlockHash)
        );

        const signedBlock: SignedBlockStruct = {
            encodedBlock: encodedBlock,
            signature: invalidSignature
        };

        const maxTimestamp = Clock.getTimeInSeconds() + 1000;

        this.logger.debug(
            `Peer ${peerIndex} posting junk calldata with invalid signature for height ${height}`,
            { forkId }
        );

        const tx =
            await peer.stateManager.stateChannelManagerContract.postBlockCalldata(
                signedBlock,
                maxTimestamp
            );
        await tx.wait();

        this.logger.info(`Junk calldata posted on-chain by peer ${peerIndex}`);

        return blockStruct;
    }

    getTimeoutStruct(
        peerIndex: number,
        forkId: ForkId
    ): TimeoutStruct | undefined {
        const peer = this.getPeer(peerIndex);
        return peer.stateManager.storage.timeout.getTimeout(forkId);
    }

    async verifyAllPeersAcknowledged(
        requestingPeerIndex: number,
        forkId: ForkId,
        timeoutMs: number = 5000,
        excludePeerIndices: number[] = []
    ): Promise<boolean> {
        const requestingPeer = this.getPeer(requestingPeerIndex);
        const requestingPeerService =
            requestingPeer.stateManager.p2pManager.localRpc
                .isForkDisputedService;

        const condition = () => {
            const connections =
                requestingPeer.stateManager.p2pManager.openConnections;

            if (connections.length === 0) return false;

            const allAcked = connections.every((transport) => {
                const profile =
                    requestingPeer.stateManager.p2pManager.profileManager.getProfileByTransport(
                        transport
                    );
                const peerIndex = this.peers.findIndex(
                    (p) => p.address === profile?.evmAddress
                );

                // Skip excluded peers
                if (
                    peerIndex !== -1 &&
                    excludePeerIndices.includes(peerIndex)
                ) {
                    return true;
                }

                const peerAddress = transport.peerAddress
                    ? transport.peerAddress
                    : profile?.evmAddress
                      ? requestingPeer.stateManager.p2pManager.profileManager.normalizeEvmAddress(
                            profile.evmAddress
                        )
                      : undefined;
                if (!peerAddress) return false;

                return requestingPeerService.didPeerAcknowledgeDisputedFork(
                    peerAddress,
                    forkId
                );
            });
            return allAcked;
        };

        return await this.waitForCondition(condition, timeoutMs);
    }

    getPeerTransport(
        fromPeerIndex: number,
        toPeerIndex: number
    ): ATransport | undefined {
        const fromPeer = this.getPeer(fromPeerIndex);
        const toPeer = this.getPeer(toPeerIndex);

        const findTransport = (
            sourcePeer: TestPeer<AStateMachine>,
            targetAddress: string
        ) =>
            sourcePeer.stateManager.p2pManager.openConnections.find((t) => {
                const profile =
                    sourcePeer.stateManager.p2pManager.profileManager.getProfileByTransport(
                        t
                    );
                return profile?.evmAddress === targetAddress;
            });

        const directTransport = findTransport(fromPeer, toPeer.address);
        if (directTransport) {
            return directTransport;
        }

        return findTransport(toPeer, fromPeer.address);
    }

    async waitForPeerTransport(
        fromPeerIndex: number,
        toPeerIndex: number,
        timeoutMs: number = 5000
    ): Promise<ATransport> {
        const fromPeer = this.getPeer(fromPeerIndex);
        const toPeer = this.getPeer(toPeerIndex);
        let resolvedTransport: ATransport | undefined;

        const condition = () => {
            const transport =
                fromPeer.stateManager.p2pManager.openConnections.find((t) => {
                    const profile =
                        fromPeer.stateManager.p2pManager.profileManager.getProfileByTransport(
                            t
                        );
                    return profile?.evmAddress === toPeer.address;
                });

            if (transport) {
                resolvedTransport = transport;
                return true;
            }

            return false;
        };

        const found = await this.waitForCondition(condition, timeoutMs, 50);
        if (!found || !resolvedTransport) {
            throw new Error(
                `Transport from peer ${fromPeerIndex} to peer ${toPeerIndex} not available within ${timeoutMs}ms`
            );
        }
        return resolvedTransport!;
    }

    getConnectionCount(peerIndex: number): number {
        const peer = this.getPeer(peerIndex);
        return peer.stateManager.p2pManager.openConnections.length;
    }

    getProfile(
        peerIndex: number,
        evmAddress: Address
    ): PeerProfile | undefined {
        const peer = this.getPeer(peerIndex);
        return peer.stateManager.p2pManager.profileManager.getProfileByEvmAddress(
            evmAddress
        );
    }

    async submitForgedInboundMessageBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.getPeer(peerIndex);
        const forkId = options?.forkId || this.activeForkId!;

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        const previousBlockHash = this.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );
        const stateSnapshotHash = this.getStateSnapshotHash(
            peer,
            forkId,
            previousBlock
        );

        const previousStateSnapshot =
            peer.stateManager.storage.getPreviousStateSnapshot({
                forkId,
                height: nextBlockHeight
            });
        if (!previousStateSnapshot) {
            throw new Error(
                `Unable to compute previous snapshot for fork ${forkId}`
            );
        }

        const latestInboundHash = (previousStateSnapshot.snapshotData
            .latestInboundMessageBlockHash ?? ZeroHash) as Hash;
        const latestInboundHeightValue =
            previousStateSnapshot.snapshotData
                .latestInboundMessageBlockHeight ?? 0n;
        const latestInboundHeight =
            typeof latestInboundHeightValue === "bigint"
                ? latestInboundHeightValue
                : BigInt(latestInboundHeightValue);
        const forgedInboundHeight = latestInboundHeight + 1n;

        const forgedMessage: MessageStruct = {
            messageType: ethers.hexlify(ethers.randomBytes(32)) as Bytes,
            participant: peer.address,
            balance: {
                amount: 1n,
                data: "0x"
            },
            data: ethers.hexlify(ethers.randomBytes(32)) as Bytes
        };

        const totalBalance: BalanceStruct = {
            amount: forgedMessage.balance.amount,
            data: "0x"
        };

        const forgedMessageBlock: MessageBlockStruct = {
            previousBlockHash: latestInboundHash || (ZeroHash as Hash),
            blockHeight: forgedInboundHeight,
            messages: [forgedMessage],
            totalBalance,
            timestamp: BigInt(Clock.getTimeInSeconds())
        };

        const contractInterface = (peer.contractInstance as any).interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        const blockTimestampBase = previousBlock
            ? previousBlock.timestamp + 1
            : Clock.getTimeInSeconds();

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(blockTimestampBase)
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash,
            previousBlockHash,
            messageBlocks: [forgedMessageBlock]
        };

        const forgedBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting forged inbound message block at height ${forgedBlock.height}`,
            { forkId }
        );

        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(forgedBlock.blockConfirmationStruct)
            .broadcast();

        return forgedBlock;
    }

    async submitDoubleSignBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
        }
    ): Promise<{
        conflictingBlock: Block;
        originalBlock: Block;
    }> {
        const peer = this.getPeer(peerIndex);
        const forkId = options?.forkId || this.forkId;

        this.logger.debug(
            `Peer ${peerIndex} creating double-sign block for fork ${forkId}`
        );

        const originalBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!originalBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        this.logger.debug(
            `Original block found: height=${originalBlock.height}, hash=${originalBlock.hash}`
        );

        // Create conflicting block with same coordinates but different content
        const conflictingTransactionData: Bytes =
            options?.transactionData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const conflictingStateSnapshotHash: Hash = hash(
            ethers.randomBytes(32)
        ) as Hash;

        const conflictingBlockStruct: BlockStruct = {
            transaction: {
                header: {
                    channelId: originalBlock.channelId,
                    participant: originalBlock.author,
                    forkId: originalBlock.forkId,
                    transactionCnt: BigInt(originalBlock.height),
                    timestamp: originalBlock.timestamp
                },
                body: {
                    encodedData: conflictingTransactionData,
                    data: conflictingTransactionData
                }
            },
            stateSnapshotHash: conflictingStateSnapshotHash,
            previousBlockHash: originalBlock.previousBlockHash,
            messageBlocks: []
        };

        const conflictingBlock = await Block.fromBlockStruct(
            conflictingBlockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting double-sign block: height=${conflictingBlock.height}, hash=${conflictingBlock.hash}`
        );

        // Broadcast
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(conflictingBlock.blockConfirmationStruct)
            .broadcast();

        this.logger.info(`Double-sign block broadcasted by peer ${peerIndex}`);

        return {
            conflictingBlock,
            originalBlock
        };
    }

    async submitInvalidStateTransitionBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
            wrongStateSnapshotHash?: Hash;
        }
    ): Promise<Block> {
        const peer = this.getPeer(peerIndex);
        const forkId = options?.forkId || this.forkId;

        this.logger.debug(
            `Peer ${peerIndex} creating invalid state transition block for fork ${forkId}`
        );

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlockHash = this.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        // Create a valid transaction
        let transactionData: Bytes;
        if (options?.transactionData) {
            transactionData = options.transactionData;
        } else {
            const contractInterface = (peer.contractInstance as any).interface;
            transactionData = contractInterface.encodeFunctionData("add", [
                1
            ]) as Bytes;
        }

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const wrongStateSnapshotHash: Hash =
            options?.wrongStateSnapshotHash || (ZeroHash as Hash);

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: wrongStateSnapshotHash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid state transition block: height=${invalidBlock.height}, hash=${invalidBlock.hash}, wrongStateSnapshotHash=${wrongStateSnapshotHash}`
        );

        // Broadcast the invalid block from the specified peer
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(invalidBlock.blockConfirmationStruct)
            .broadcast();

        this.logger.info(
            `Invalid state transition block broadcasted by peer ${peerIndex}`
        );

        return invalidBlock;
    }

    /**
     * Build and post a tampered dispute from a peer (used to exercise DisputeValidationService rejection paths).
     * Caller is responsible for providing the tamper function that mutates the dispute or confirmation.
     */
    async postTamperedDispute(
        authorPeerIndex: number,
        tamper: (dispute: any, confirmation: any) => void,
        forkId?: ForkId
    ): Promise<{ dispute: any; disputeConfirmation: any }> {
        const peer = this.getPeer(authorPeerIndex);
        const targetForkId = forkId || this.forkId;

        const { dispute, disputeConfirmation } =
            await peer.stateManager.disputeManager.constructDispute(
                targetForkId
            );

        // Apply tampering (e.g., wrong auditingDataHash, bogus timeout participant, etc.)
        tamper(dispute, disputeConfirmation);

        // Re-sign the tampered dispute as the author (threshold is not enforced here; we only need author sig)
        const tamperedSig = await SignatureUtils.signDispute(
            dispute,
            peer.signer
        );
        disputeConfirmation.signedDispute = {
            encodedDispute: tamperedSig.encoded,
            signature: tamperedSig.signature as BytesLike
        };
        disputeConfirmation.signatures = [];

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );
        const txResp = await this.channelManager
            .connect(peer.signer)
            .uploadDispute(disputeConfirmation);
        await txResp.wait();

        return { dispute, disputeConfirmation };
    }

    withConstructDisputeTampering(
        peerOrIndex: number | TestPeer<T>,
        tamper: (
            result: ConstructDisputeResult
        ) => Promise<ConstructDisputeResult>
    ): {
        restore: () => void;
        dispute: Promise<DisputeStruct>;
    } {
        let disputeResolver!: (dispute: DisputeStruct) => void;
        const disputePromise = new Promise<DisputeStruct>((resolve) => {
            disputeResolver = resolve;
        });

        const peer =
            typeof peerOrIndex === "number"
                ? this.getPeer(peerOrIndex)
                : peerOrIndex;

        const disputeManager: DisputeManager = peer.stateManager.disputeManager;
        const originalConstructDispute =
            disputeManager.constructDispute.bind(disputeManager);

        disputeManager.constructDispute = async (targetForkId: ForkId) => {
            const res = await originalConstructDispute(targetForkId);
            const tamperedRes = await tamper(res);
            disputeResolver(tamperedRes.dispute);
            return tamperedRes;
        };

        return {
            restore: () => {
                disputeManager.constructDispute = originalConstructDispute;
            },
            dispute: disputePromise
        };
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default PeerTestHarness;
