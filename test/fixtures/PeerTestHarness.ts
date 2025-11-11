import { BytesLike, Signer, ethers } from "ethers";
import { expect } from "chai";
import * as sinon from "sinon";
import hre from "hardhat";
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
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import {
    createLogger,
    LocalDiscoveryServer,
    Logger,
    SignatureUtils,
    Codec,
    Type,
    hash
} from "@/utils";
import Block from "@/models/Block";
import {
    JoinChannelStruct,
    BlockStruct,
    TransactionStruct,
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { TimeoutStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import Clock from "@/Clock";
import { createConfig, Config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { deploy } from "../../scripts/V1/deploy";
import SyncCoordinator from "@test/utils/SyncCoordinator";
import { ZeroHash } from "ethers";

export interface TestPeer<T extends AStateMachine> {
    index: number;
    signer: Signer;
    address: string;
    p2pInstance: P2pInstance<T>;
    stateManager: StateManager;
    contractInstance: T;
    eventSpies: EventSpies;
    joinChannelCommitment?: JoinChannelStruct;
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
    onJoinChannel?: sinon.SinonSpy;

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
    onJoinChannelProcessed?: sinon.SinonSpy;
}

/**
 * Options for configuring the test harness
 */
export interface HarnessOptions {
    timeConfig?: Partial<TimeConfig>;
    channelId?: string;
    initialBalance?: number;
    gasLimit?: number;
    autoConnect?: boolean;
    configOverrides?: Partial<Config>; // Direct config overrides
}

export type SubmitTransactionOptions = {
    waitForSync?: boolean;
    waitForPeers?: number[];
};

export type AssertAllPeersInSyncOptions = {
    expectedState?: Bytes;
    peerIndices?: number[];
};

/**
 * Main test harness for E2E peer-to-peer testing
 */
export class PeerTestHarness<T extends AStateMachine> {
    public peers: TestPeer<T>[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedDeployTx!: any;
    public channelId!: ChannelId;
    private options!: Required<HarnessOptions>;
    private discoveryServerStarted = false;
    public activeForkId?: ForkId;
    private harnessConfig!: Config;
    private logger: Logger;
    private syncCoordinator!: SyncCoordinator;

    constructor() {
        this.logger = createLogger({ component: "TestHarness" });
    }

    async setup(numPeers: number, options: HarnessOptions = {}): Promise<void> {
        if (numPeers < 2 || numPeers > 10) {
            throw new Error("Number of peers must be between 2 and 10");
        }
        this.harnessConfig = createConfig({
            ...testConfig,
            ...(options.configOverrides || {})
        });
        this.options = {
            timeConfig: options.timeConfig || {},
            channelId: options.channelId || "test-channel-" + Date.now(),
            initialBalance: options.initialBalance || 500,
            gasLimit: options.gasLimit || 500000,
            autoConnect: options.autoConnect !== false,
            configOverrides: options.configOverrides || {}
        };
        this.syncCoordinator = new SyncCoordinator(this.logger);

        await this.deployContracts();
        this.channelId = this.options.channelId;

        const signers = await hre.ethers.getSigners();
        for (let i = 0; i < numPeers; i++) {
            await this.createPeer(i, signers[i]);
        }

        this.logger.info("Test harness setup completed");
    }

    private get forkId(): ForkId {
        return this.activeForkId || this.peers[0].stateManager.forkId;
    }

    private async deployContracts(): Promise<void> {
        const mathSMFactory =
            await hre.ethers.getContractFactory("MathStateMachine");
        const mathInstance = await mathSMFactory.deploy(this.options.gasLimit);
        await mathInstance.waitForDeployment();
        const stateMachineAddress = await mathInstance.getAddress();

        this.sharedDeployTx = await mathSMFactory.getDeployTransaction(
            this.options.gasLimit
        );

        // Deploy MathConsumerFacet
        const mathConsumerFactory =
            await hre.ethers.getContractFactory("MathConsumerFacet");
        const mathConsumerInstance = await mathConsumerFactory.deploy();
        await mathConsumerInstance.waitForDeployment();
        const consumerFacetAddress = await mathConsumerInstance.getAddress();

        const [hardhatSigner] = await hre.ethers.getSigners();

        const deployment = await deploy(
            stateMachineAddress,
            consumerFacetAddress,
            hardhatSigner
        );

        this.channelManager = deployment.contract;
    }

    private async createPeer(index: number, signer: Signer): Promise<void> {
        const address = await signer.getAddress();

        const PeerLogger = createLogger({
            peerId: index,
            peerAddress: address
        });

        this.logger.debug(`Creating peer ${index} at ${address}`);

        const eventSpies: EventSpies = {
            // P2pEventHooks spies
            onConnection: sinon.spy(),
            onTurn: sinon.spy(),
            onSetState: sinon.spy(),
            onPostingCalldata: sinon.spy(),
            onPostedCalldata: sinon.spy(),
            onInitiatingDispute: sinon.spy(),
            onDisputeUpdate: sinon.spy(),
            onJoinChannel: sinon.spy(),

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
            onJoinChannelProcessed: sinon.spy()
        };

        const hooks: P2pEventHooks = {
            onConnection: (addr: Address) => {
                PeerLogger.verbose(`Connection established with ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onConnection?.(addr);
            },
            onTurn: (addr: Address) => {
                PeerLogger.verbose(`Turn received from ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onTurn?.(addr);
            },
            onSetState: () => {
                PeerLogger.debug("State set", { component: "P2pEventHooks" });
                eventSpies.onSetState?.();
            },
            onPostingCalldata: () => {
                PeerLogger.debug("Posting calldata to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostingCalldata?.();
            },
            onPostedCalldata: () => {
                PeerLogger.debug("Calldata posted to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostedCalldata?.();
            },
            onInitiatingDispute: () => {
                PeerLogger.info("Initiating dispute", {
                    component: "P2pEventHooks"
                });
                eventSpies.onInitiatingDispute?.();
            },
            onDisputeUpdate: (dispute: any) => {
                PeerLogger.info("Dispute updated", {
                    component: "P2pEventHooks"
                });
                eventSpies.onDisputeUpdate?.(dispute);
            },
            onJoinChannel: (joinChannelBlock: any) => {
                PeerLogger.info("Joined channel", {
                    component: "P2pEventHooks"
                });
                eventSpies.onJoinChannel?.(joinChannelBlock);
            }
        };

        // Deploy MathStateMachine for this peer
        const mathSMFactory =
            await hre.ethers.getContractFactory("MathStateMachine");
        const mathInstance = await mathSMFactory.deploy(this.options.gasLimit);

        const p2pInstance = await EvmStateMachine.p2pSetup<any>(
            signer,
            this.sharedDeployTx,
            this.channelManager,
            mathInstance,
            hooks,
            this.options.timeConfig, // Pass timeConfig override for testing
            index, // Pass peer index for logging
            PeerLogger
        );

        const peer: TestPeer<any> = {
            index,
            signer,
            address,
            p2pInstance,
            stateManager: p2pInstance.p2pSigner.p2pManager.stateManager,
            contractInstance: p2pInstance.p2pContractInstance,
            eventSpies,
            logger: PeerLogger
        };

        // Wrap EventHandler methods with spies (without replacing the original functionality)
        this.wrapEventHandlerWithSpies(peer);

        this.peers.push(peer);
        this.logger.debug(`Peer ${index} created successfully`);
    }

    private wrapEventHandlerWithSpies(peer: TestPeer<T>): void {
        const eventHandler = peer.stateManager.eventHandler;
        const spies = peer.eventSpies;

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
                        return Reflect.apply(originalMethod, target, args);
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

    async openChannel(): Promise<ForkId> {
        this.logger.info("Opening channel...");
        await Clock.init(this.peers[0].signer.provider!);

        const openChannel = createOpenChannelTestObject(
            this.peers.map((p) => p.address),
            {
                channelId: this.options.channelId,
                initialBalance: this.options.initialBalance
            }
        );

        this.logger.debug(`Channel created with ID: ${openChannel.channelId}`);

        // Connect peers to the channel
        for (const peer of this.peers) {
            peer.p2pInstance.p2pSigner.connectToChannel(openChannel.channelId);
            peer.logger.verbose(
                `Connected to channel ${openChannel.channelId}`,
                {
                    component: "TestHarness"
                }
            );
        }

        if (this.options.autoConnect) {
            await this.connectPeers();
        }

        const signatures = await Promise.all(
            this.peers.map(
                async (peer) =>
                    (
                        await SignatureUtils.signOpenChannel(
                            openChannel,
                            peer.signer
                        )
                    ).signature as BytesLike
            )
        );

        for (const peer of this.peers) {
            peer.stateManager.setStatus(Status.PARTICIPATING);
        }

        this.logger.debug(
            "Submitting channel open transaction to blockchain..."
        );
        const tx = await this.channelManager.open({
            encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
            signatures: signatures
        });

        await Promise.all([tx.wait(), sleep(100)]);

        // Get fork ID from the first peer that has it set
        let forkId: ForkId | undefined;
        for (const peer of this.peers) {
            const peerForkId = peer.stateManager.forkId;
            if (peerForkId && peerForkId !== "0x00" && peerForkId !== "0x0") {
                forkId = peerForkId;
                break;
            }
        }

        if (!forkId) {
            // If no peer has a valid fork ID, wait a bit more and try again
            await sleep(50);
            for (const peer of this.peers) {
                const peerForkId = peer.stateManager.forkId;
                if (
                    peerForkId &&
                    peerForkId !== "0x00" &&
                    peerForkId !== "0x0"
                ) {
                    forkId = peerForkId;
                    break;
                }
            }
        }

        this.activeForkId = forkId as ForkId;
        this.logger.info(
            `Channel opened successfully with fork ID: ${this.activeForkId}`
        );
        return this.activeForkId;
    }

    async connectPeers(): Promise<void> {
        this.logger.debug("Connecting peers...");
        if (!this.discoveryServerStarted) {
            LocalDiscoveryServer.tryStart();
            this.discoveryServerStarted = true;
            this.logger.verbose("Discovery server started");
        }
        await this.waitForP2PConnections();
        this.logger.debug("All peers connected successfully");
    }

    async waitForP2PConnections(timeoutMs?: number): Promise<void> {
        const isGitHubActionsEnv = process.env.GITHUB_ACTIONS === "true";
        const defaultTimeout = isGitHubActionsEnv ? 15000 : 5000;
        const actualTimeout = timeoutMs ?? defaultTimeout;
        const pollInterval = 50;
        const stableDurationThreshold = 200;

        const startTime = Date.now();
        let lastConnectionCount = 0;
        let stableDuration = 0;

        while (Date.now() - startTime < actualTimeout) {
            const connected = this.peers.filter(
                (p) =>
                    p.p2pInstance.p2pSigner.p2pManager.openConnections.length >
                    0
            ).length;

            // Require stable connections for 200ms before considering established
            if (connected === lastConnectionCount) {
                stableDuration += pollInterval;
            } else {
                stableDuration = 0;
                lastConnectionCount = connected;
            }

            if (
                connected >= Math.min(2, this.peers.length) &&
                stableDuration > stableDurationThreshold
            ) {
                return;
            }
            await sleep(50);
        }
        throw new Error(
            `P2P connections not established within ${actualTimeout}ms`
        );
    }

    async submitTransaction(
        peer: TestPeer<T>,
        txFn: (contract: T) => Promise<any>,
        options: SubmitTransactionOptions = { waitForSync: true }
    ): Promise<void> {
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
        txFn: (contract: T) => Promise<any>
    ): Promise<void> {
        const nextPeer = await this.getNextPeerToWrite();
        await this.submitTransaction(nextPeer, txFn);
    }

    async waitForSync(timeout?: number): Promise<void> {
        await this.syncCoordinator.waitForPeersInSync(this.peers, this.forkId, {
            timeout
        });
    }

    async waitForEventProcessing(timeout: number = 100): Promise<void> {
        await sleep(timeout);
    }

    async cleanup(): Promise<void> {
        this.logger.debug("Starting cleanup...");

        // Cleanup peers
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

                await peer.p2pInstance.dispose();
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
        this.peers = [];

        // Cleanup discovery server and peer servers
        if (this.discoveryServerStarted) {
            LocalDiscoveryServer.cleanup();
            this.discoveryServerStarted = false;
            this.logger.verbose("Discovery server cleaned up");
        }
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
        timeoutMs: number = 10000
    ): Promise<boolean> {
        return this.waitForCondition(() => {
            for (const { peerId, expectedCount } of expectedCounts) {
                const actualCount = this.getEventCallCount(peerId, eventName);
                if (actualCount !== expectedCount) {
                    return false;
                }
            }
            return true;
        }, timeoutMs);
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

    getPeer(index: number): TestPeer<T> {
        const peer = this.peers[index];
        if (!peer) throw new Error(`Peer ${index} not found`);
        return peer;
    }

    getPeerAddresses(): Address[] {
        return this.peers.map((p) => p.address);
    }

    getConfig(): Config {
        return this.harnessConfig;
    }

    getStateMachineState(peerIndex: number, forkId: ForkId): any {
        const peer = this.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            const genesisSnapshot =
                peer.stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
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

    async getNextPeerToWrite(): Promise<TestPeer<T>> {
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
                throw new Error(
                    `No peer found with address ${nextAddress}. Available peers: ${peerAddresses.join(", ")}. ForkId: ${this.forkId}, StateHash: ${stateHash}`
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

    private getPreviousBlockHash(
        peer: TestPeer<T>,
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
            peer.stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                forkId
            )?.hash ||
            ethers.ZeroHash
        );
    }

    private getStateSnapshotHash(
        peer: TestPeer<T>,
        forkId: ForkId,
        previousBlock?: Block
    ): Hash {
        return previousBlock
            ? previousBlock.stateSnapshotHash
            : peer.stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
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
        const forkId = options.forkId || this.activeForkId!;
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
            previousBlockHash: previousBlockHash
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
        const forkId = options?.forkId || this.activeForkId!;

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
            previousBlockHash: originalBlock.previousBlockHash
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
        const forkId = options?.forkId || this.activeForkId!;

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
            previousBlockHash: previousBlockHash
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
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default PeerTestHarness;
