import { BytesLike, Signer } from "ethers";
import { expect } from "chai";
import * as sinon from "sinon";
import hre from "hardhat";
import { EvmStateMachine, P2pInstance } from "@/evm";
import StateManager from "@/stateManager";
import { createLogger, LocalDiscoveryServer, Logger } from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import { AStateMachine, StateChannelManagerProxy } from "@typechain-types";
import { ForkId, ChannelId, Address } from "@/types/types";
import { TimeConfig } from "@/types/time";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { SignatureUtils, Codec, Type } from "@/utils";
import { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { createConfig, Config } from "@/utils/config";
import testConfig from "../peer3.test.config";
import { deploy } from "../../scripts/V1/deploy";

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
 * match with P2pEventHooks
 */
export interface EventSpies {
    onConnection?: sinon.SinonSpy;
    onTurn?: sinon.SinonSpy;
    onSetState?: sinon.SinonSpy;
    onPostingCalldata?: sinon.SinonSpy;
    onPostedCalldata?: sinon.SinonSpy;
    onInitiatingDispute?: sinon.SinonSpy;
    onDisputeUpdate?: sinon.SinonSpy;
    onJoinChannel?: sinon.SinonSpy;
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

        // Parse CLI arguments to set log level (--debug, --info, --warn, --error)
        parseLogLevelFromArgs();

        await this.deployContracts();
        this.channelId = this.options.channelId;

        const signers = await hre.ethers.getSigners();
        for (let i = 0; i < numPeers; i++) {
            await this.createPeer(i, signers[i]);
        }

        this.logger.info("Test harness setup completed");
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

        this.logger.info(`Creating peer ${index} at ${address}`);

        const eventSpies: EventSpies = {
            onConnection: sinon.spy(),
            onTurn: sinon.spy(),
            onSetState: sinon.spy(),
            onPostingCalldata: sinon.spy(),
            onPostedCalldata: sinon.spy(),
            onInitiatingDispute: sinon.spy(),
            onDisputeUpdate: sinon.spy(),
            onJoinChannel: sinon.spy()
        };

        const hooks: P2pEventHooks = {
            onConnection: (addr: Address) => {
                PeerLogger.debug(`Connection established with ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onConnection?.(addr);
            },
            onTurn: (addr: Address) => {
                PeerLogger.debug(`Turn received from ${addr}`, {
                    component: "P2pEventHooks"
                });
                eventSpies.onTurn?.(addr);
            },
            onSetState: () => {
                PeerLogger.debug("State set", { component: "P2pEventHooks" });
                eventSpies.onSetState?.();
            },
            onPostingCalldata: () => {
                PeerLogger.info("Posting calldata to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostingCalldata?.();
            },
            onPostedCalldata: () => {
                PeerLogger.info("Calldata posted to blockchain", {
                    component: "P2pEventHooks"
                });
                eventSpies.onPostedCalldata?.();
            },
            onInitiatingDispute: () => {
                PeerLogger.warn("Initiating dispute", {
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

        this.peers.push(peer);
        this.logger.info(`Peer ${index} created successfully`);
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

        this.logger.info(`Channel created with ID: ${openChannel.channelId}`);

        // Connect peers to the channel
        for (const peer of this.peers) {
            peer.p2pInstance.p2pSigner.connectToChannel(openChannel.channelId);
            peer.logger.debug(`Connected to channel ${openChannel.channelId}`, {
                component: "TestHarness"
            });
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

        this.logger.info(
            "Submitting channel open transaction to blockchain..."
        );
        const tx = await this.channelManager.open({
            encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
            signatures: signatures
        });

        await Promise.all([tx.wait(), sleep(100)]);
        this.activeForkId = this.peers[0].stateManager.forkId;
        this.logger.info(
            `Channel opened successfully with fork ID: ${this.activeForkId}`
        );
        return this.activeForkId;
    }

    async connectPeers(): Promise<void> {
        this.logger.info("Connecting peers...");
        if (!this.discoveryServerStarted) {
            LocalDiscoveryServer.tryStart();
            this.discoveryServerStarted = true;
            this.logger.debug("Discovery server started");
        }
        await this.waitForP2PConnections();
        this.logger.info("All peers connected successfully");
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
        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (options.waitForPeers && options.waitForPeers.length > 0) {
            await this.waitForSpecificPeersSync(options.waitForPeers);
        } else {
            options.waitForSync && (await this.waitForSync());
        }

        return result;
    }
    async submitNextTransaction(
        txFn: (contract: T) => Promise<any>
    ): Promise<void> {
        const nextPeer = await this.getNextPeerToWrite();
        await this.submitTransaction(nextPeer, txFn);
    }

    async waitForSync(timeout: number = 3000): Promise<void> {
        if (this.peers.length < 2) return;

        const startTime = Date.now();
        let pollInterval = 50; // Start with 50ms
        const maxPollInterval = 200; // Cap at 200ms

        while (Date.now() - startTime < timeout) {
            const forkId =
                this.activeForkId || this.peers[0].stateManager.forkId;
            const firstBlock =
                this.peers[0].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );

            if (!firstBlock) {
                await sleep(pollInterval);
                continue;
            }

            // Check if all peers have the same block hash
            let allSynced = true;
            let syncedPeers = 0;

            for (let i = 1; i < this.peers.length; i++) {
                const peerBlock =
                    this.peers[i].stateManager.storage.blocks.getLatestBlock(
                        forkId
                    );
                if (!peerBlock || peerBlock.hash !== firstBlock.hash) {
                    allSynced = false;
                } else {
                    syncedPeers++;
                }
            }

            if (allSynced) return;

            // Adaptive polling: increase interval if most peers are synced
            if (syncedPeers > this.peers.length / 2) {
                pollInterval = Math.min(pollInterval * 1.1, maxPollInterval);
            } else {
                pollInterval = Math.max(pollInterval * 0.9, 25); // Minimum 25ms
            }

            await sleep(pollInterval);
        }

        throw new Error(
            `All ${this.peers.length} peers failed to synchronize within ${timeout}ms`
        );
    }

    async waitForSpecificPeersSync(
        peerIndices: number[],
        timeoutMs?: number
    ): Promise<void> {
        if (peerIndices.length === 0) return;
        const isGitHubActionsEnv = process.env.GITHUB_ACTIONS === "true";

        const defaultTimeout = isGitHubActionsEnv ? 15000 : 5000;
        const timeout = timeoutMs ?? defaultTimeout;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const forkId =
                this.activeForkId || this.peers[0].stateManager.forkId;
            const firstBlock =
                this.peers[0].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );

            if (!firstBlock) {
                await sleep(50);
                continue;
            }

            // Check if all specified peers have the same block hash
            let allSynced = true;
            for (const peerIndex of peerIndices) {
                const peerBlock =
                    this.peers[
                        peerIndex
                    ].stateManager.storage.blocks.getLatestBlock(forkId);
                if (!peerBlock || peerBlock.hash !== firstBlock.hash) {
                    allSynced = false;
                    break;
                }
            }

            if (allSynced) return;
            await sleep(50);
        }

        throw new Error(
            `Peers at indices [${peerIndices.join(", ")}] failed to synchronize within ${timeout}ms`
        );
    }

    async waitForEventProcessing(timeout: number = 100): Promise<void> {
        await sleep(timeout);
    }

    async cleanup(): Promise<void> {
        this.logger.info("Starting cleanup...");
        for (const peer of this.peers) {
            try {
                peer.logger.debug("Cleaning up peer", {
                    component: "TestHarness"
                });
                peer.contractInstance.removeAllListeners();
                // Gracefully close P2P connections
                peer.p2pInstance.p2pSigner.p2pManager.openConnections.forEach(
                    (connection) => {
                        peer.p2pInstance.p2pSigner.p2pManager.disconnectConnection(
                            connection
                        );
                    }
                );
                await peer.p2pInstance.dispose();
                Object.values(peer.eventSpies).forEach((spy) =>
                    spy?.resetHistory()
                );
                peer.logger.debug("Peer cleanup completed", {
                    component: "TestHarness"
                });
            } catch (error) {
                peer.logger.error(`Error during cleanup: ${error}`, {
                    component: "TestHarness"
                });
            }
        }
        this.peers = [];

        // Clean up discovery server and peer servers
        if (this.discoveryServerStarted) {
            const { LocalDiscoveryServer } = await import(
                "@/utils/LocalDiscoveryServer"
            );
            LocalDiscoveryServer.cleanup();
            this.discoveryServerStarted = false;
            this.logger.debug("Discovery server cleaned up");
        }

        // Wait for cleanup to complete
        await sleep(100);

        this.logger.info("Cleanup completed");
    }

    assertAllPeersInSync(expectedState?: any): void {
        if (this.peers.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const forkId = this.activeForkId || this.getActiveForkId();
        const firstPeerState = this.getStateMachineState(0, forkId);

        for (let i = 1; i < this.peers.length; i++) {
            const peerState = this.getStateMachineState(i, forkId);
            expect(peerState).to.deep.equal(
                firstPeerState,
                `Peer ${i} state does not match Peer 0`
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

    getActiveForkId(): ForkId {
        if (this.activeForkId) return this.activeForkId;
        throw new Error(
            "Active fork ID not set. Call setupGenesisState first."
        );
    }

    async getNextPeerToWrite(): Promise<TestPeer<T>> {
        const nextAddress =
            await this.peers[0].stateManager.diamondStateMachine.getNextToWrite();

        const nextPeer = this.peers.find(
            (peer) => peer.address === nextAddress
        );
        if (!nextPeer) {
            throw new Error(`No peer found with address ${nextAddress}`);
        }

        return nextPeer;
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
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default PeerTestHarness;
