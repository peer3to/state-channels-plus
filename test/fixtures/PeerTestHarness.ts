import { BytesLike, ethers, Signer } from "ethers";
import { expect } from "chai";
import * as sinon from "sinon";
import { EvmStateMachine, P2pInstance } from "@/evm";
import StateManager from "@/stateManager";
import { LocalDiscoveryServer } from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import { AStateMachine, StateChannelManagerProxy } from "@typechain-types";
import { StateSnapshot } from "@/models";
import { ForkId, Address, ChannelId } from "@/types/types";
import { TimeConfig } from "@/types/time";
import {
    deployMathChannelProxyFixture,
    createJoinChannelTestObject
} from "@test/test_utils/testHelpers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";
import { SignatureUtils, Codec, Type, hash as hashUtil } from "@/utils";
import { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { createConfig, Config } from "@/utils/config";
import testConfig from "../peer3.test.config";

export interface TestPeer<T extends AStateMachine> {
    index: number;
    signer: Signer;
    address: string;
    p2pInstance: P2pInstance<T>;
    stateManager: StateManager;
    contractInstance: T;
    eventSpies: EventSpies;
    joinChannelCommitment?: JoinChannelStruct;
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
    debug?: boolean;
    autoConnect?: boolean;
    configOverrides?: Partial<Config>; // Direct config overrides
}

/**
 * Main test harness for E2E peer-to-peer testing
 */
export class PeerTestHarness<T extends AStateMachine> {
    public peers: TestPeer<T>[] = [];
    public channelManager!: StateChannelManagerProxy;
    private sharedDeployTx!: any;
    public channelId!: ChannelId;
    private ethers!: typeof ethers & HardhatEthersHelpers;
    private options!: Required<HarnessOptions>;
    private discoveryServerStarted = false;
    public activeForkId?: ForkId;
    private harnessConfig!: Config;

    constructor() {}

    async setup(
        numPeers: number,
        ethersInstance: typeof ethers & HardhatEthersHelpers,
        options: HarnessOptions = {}
    ): Promise<void> {
        if (numPeers < 2 || numPeers > 10) {
            throw new Error("Number of peers must be between 2 and 10");
        }

        this.ethers = ethersInstance;
        this.harnessConfig = createConfig({
            ...testConfig,
            ...(options.configOverrides || {})
        });
        this.options = {
            timeConfig: options.timeConfig || {},
            channelId: options.channelId || "test-channel-" + Date.now(),
            initialBalance: options.initialBalance || 500,
            gasLimit: options.gasLimit || 500000,
            debug: options.debug || false,
            autoConnect: options.autoConnect !== false,
            configOverrides: options.configOverrides || {}
        };

        await this.deployContracts();
        this.channelId = this.options.channelId;

        const signers = await this.ethers.getSigners();
        for (let i = 0; i < numPeers; i++) {
            await this.createPeer(i, signers[i]);
        }
    }

    private async deployContracts(): Promise<void> {
        const deployment = await deployMathChannelProxyFixture(this.ethers);
        this.channelManager = deployment.mathChannelManager;
        const mathSMFactory =
            await this.ethers.getContractFactory("MathStateMachine");
        this.sharedDeployTx = await mathSMFactory.getDeployTransaction(
            this.options.gasLimit
        );
    }

    private async createPeer(index: number, signer: Signer): Promise<void> {
        const address = await signer.getAddress();
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
            onConnection: (addr: Address) => eventSpies.onConnection?.(addr),
            onTurn: (addr: Address) => eventSpies.onTurn?.(addr),
            onSetState: () => eventSpies.onSetState?.(),
            onPostingCalldata: () => eventSpies.onPostingCalldata?.(),
            onPostedCalldata: () => eventSpies.onPostedCalldata?.(),
            onInitiatingDispute: () => eventSpies.onInitiatingDispute?.(),
            onDisputeUpdate: (dispute: any) =>
                eventSpies.onDisputeUpdate?.(dispute),
            onJoinChannel: (joinChannelBlock: any) =>
                eventSpies.onJoinChannel?.(joinChannelBlock)
        };

        const mathSMFactory =
            await this.ethers.getContractFactory("MathStateMachine");
        const mathInstance = await mathSMFactory.deploy(this.options.gasLimit);
        const p2pInstance = await EvmStateMachine.p2pSetup<any>(
            signer,
            this.sharedDeployTx,
            this.channelManager,
            mathInstance,
            hooks
        );

        this.peers.push({
            index,
            signer,
            address,
            p2pInstance,
            stateManager: p2pInstance.p2pSigner.p2pManager.stateManager,
            contractInstance: p2pInstance.p2pContractInstance,
            eventSpies
        });
    }

    async openChannel(): Promise<void> {
        await Clock.init(this.peers[0].signer.provider!);

        const signedCommitments = [];
        for (const peer of this.peers) {
            const jc = createJoinChannelTestObject(
                peer.address,
                this.options.channelId
            );
            peer.joinChannelCommitment = jc;
            const signed = await SignatureUtils.signJoinChannel(
                jc,
                peer.signer
            );
            signedCommitments.push(signed);
        }

        for (const peer of this.peers) {
            peer.p2pInstance.p2pSigner.connectToChannel(
                peer.joinChannelCommitment!.channelId
            );
        }

        if (this.options.autoConnect) {
            await this.connectPeers();
        }

        const tx = await this.channelManager.openChannel(
            this.peers[0].joinChannelCommitment!.channelId as BytesLike,
            signedCommitments.map((s) => s.encoded) as BytesLike[],
            signedCommitments.map((s) => s.signature) as BytesLike[]
        );

        await tx.wait();
    }

    async connectPeers(): Promise<void> {
        if (!this.discoveryServerStarted) {
            LocalDiscoveryServer.tryStart();
            this.discoveryServerStarted = true;
        }
        await this.waitForP2PConnections();
    }

    async waitForP2PConnections(timeoutMs: number = 2000): Promise<void> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const connected = this.peers.filter(
                (p) =>
                    p.p2pInstance.p2pSigner.p2pManager.openConnections.length >
                    0
            ).length;

            if (connected >= Math.min(2, this.peers.length)) {
                return;
            }
            await sleep(50);
        }
        throw new Error(
            `P2P connections not established within ${timeoutMs}ms`
        );
    }

    async setupGenesisState(customState?: any): Promise<ForkId> {
        const participants = this.peers.map((p) => p.address);
        const balances = this.peers.map(() => this.options.initialBalance);
        const genesisState = customState || {
            number: 0,
            participants,
            balances
        };

        const genesisStateEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "address[]", "uint256[]"],
            [
                genesisState.number,
                genesisState.participants,
                genesisState.balances
            ]
        );

        const timestamp = Clock.getTimeInSeconds();
        const genesisSnapshotData = {
            originForkId:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            stateMachineStateHash: hashUtil(genesisStateEncoded),
            participants,
            latestJoinChannelBlockHash:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            latestExitChannelBlockHash:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            totalDeposits: {
                amount: participants.length * this.options.initialBalance,
                data: "0x00"
            },
            totalWithdrawals: { amount: 0, data: "0x00" }
        };

        const forkId = hashUtil(
            Codec.encode(genesisSnapshotData, Type.SnapshotData)
        );
        const genesisSnapshot = {
            forkId,
            blockHeight: BigInt(0),
            timestamp,
            snapshotData: genesisSnapshotData
        };

        for (const peer of this.peers) {
            await peer.stateManager.setState(
                genesisStateEncoded,
                forkId,
                timestamp
            );
            peer.stateManager.storage.stateSnapshots.storeStateSnapshot(
                StateSnapshot.from(genesisSnapshot)
            );
        }

        this.activeForkId = forkId;
        return forkId;
    }

    async submitTransaction(
        peerIndex: number,
        txFn: (contract: T) => Promise<any>
    ): Promise<void> {
        const peer = this.peers[peerIndex];
        if (!peer) throw new Error(`Peer ${peerIndex} not found`);

        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        // Automatic state synchronization - wait for all peers to sync
        await this.waitForSync();

        return result;
    }

    async waitForSync(timeout: number = 1500): Promise<void> {
        if (this.peers.length < 2) return;

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

            // Check if all peers have the same block hash
            let allSynced = true;
            for (let i = 1; i < this.peers.length; i++) {
                const peerBlock =
                    this.peers[i].stateManager.storage.blocks.getLatestBlock(
                        forkId
                    );
                if (!peerBlock || peerBlock.hash !== firstBlock.hash) {
                    allSynced = false;
                    break;
                }
            }

            if (allSynced) return;
            await sleep(50);
        }

        throw new Error(
            `All ${this.peers.length} peers failed to synchronize within ${timeout}ms`
        );
    }

    async waitForEventProcessing(timeout: number = 100): Promise<void> {
        await sleep(timeout);
    }

    async cleanup(): Promise<void> {
        for (const peer of this.peers) {
            try {
                peer.contractInstance.removeAllListeners();
                await peer.stateManager.dispose();
                Object.values(peer.eventSpies).forEach((spy) =>
                    spy?.resetHistory()
                );
            } catch (error) {
                console.error(`Error cleaning up peer ${peer.index}:`, error);
            }
        }
        this.peers = [];
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

    private log(...args: any[]): void {
        if (this.options?.debug) {
            console.log("[PeerTestHarness]", ...args);
        }
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default PeerTestHarness;
