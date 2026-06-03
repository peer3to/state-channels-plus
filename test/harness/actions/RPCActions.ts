import { ethers } from "ethers";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { LocalDiscoveryServer, Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import { hash as fakeHash } from "@test/factory";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import { InlinePeer } from "@test/harness/core/InlinePeer";

/**
 * Actions for RPC service testing
 * Provides access to RPC services and helper methods for test blocks
 */
export class RPCActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    // Inline-only: live localRpc service instances are not on PeerHandle.
    private getInlineRecord(peerIndex: number) {
        const handle = this.harness.getPeerHandle(peerIndex) as InlinePeer;
        return handle.peer;
    }

    getRemoteRpc(peerIndex: number) {
        return this.getInlineRecord(peerIndex).stateManager.p2pManager
            .remoteRpc;
    }

    getLocalRpc(peerIndex: number) {
        return this.getInlineRecord(peerIndex).stateManager.p2pManager.localRpc;
    }
    /**
     * (alias) Get the transport in fromPeerIndex p2pManager towards toPeerIndex
     */
    getTransport(
        fromPeerIndex: number,
        toPeerIndex: number
    ): ATransport | undefined {
        return this.harness.query.getTransport(fromPeerIndex, toPeerIndex);
    }
    /**
     * Check if handshake is completed between two peers
     */
    async isHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address
    ): Promise<boolean> {
        return this.harness
            .getPeerHandle(peerIndex)
            .queryInternals.isHandshakeCompletedWith(otherPeerAddress);
    }

    /**
     * Wait for handshake to complete using connection barrier (event-driven)
     */
    private async waitForHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address,
        timeoutMs: number = 5000
    ): Promise<void> {
        await this.harness.connectionBarrier.waitFor(
            () => this.isHandshakeCompleted(peerIndex, otherPeerAddress),
            {
                timeoutMs,
                timeoutMessage: `Handshake between peer ${peerIndex} and ${otherPeerAddress} not completed within ${timeoutMs}ms`
            }
        );
    }

    /**
     * Check if a peer has acknowledged a disputed fork
     */
    async didPeerAcknowledgeDisputedFork(
        requestingPeerIndex: number,
        respondingPeerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        const handle = this.harness.getPeerHandle(requestingPeerIndex);
        return handle.queryInternals.didPeerAcknowledgeDisputedFork(
            respondingPeerAddress,
            forkId
        );
    }

    /**
     * Join a peer to the channel and wait for handshake completion
     * Encapsulates both connection and handshake verification
     */
    async joinPeerToChannel(
        newPeerIndex: number,
        observingPeerIndex: number
    ): Promise<void> {
        const handle = this.harness.getPeerHandle(newPeerIndex);
        await handle.network.tryOpenConnectionToChannel(
            this.harness.channelId!.toString()
        );
        // Worker peers already dialed discovery during p2pSetup.
        if (!handle.__workerBackend) {
            const newPeer = this.harness.getPeer(newPeerIndex);
            await LocalDiscoveryServer.connectToPeers(
                newPeer.stateManager.p2pManager.self,
                this.harness.channelId!,
                newPeer.address
            );
        }
        await this.waitForHandshakeCompleted(
            observingPeerIndex,
            handle.address
        );
    }

    async requestDisputeAcknowledgment(options: {
        peerIndex: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { peerIndex, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }
        const handle = this.harness.getPeerHandle(peerIndex);
        await handle.queryInternals.requestDisputeAcknowledgment(
            this.harness.channelId!,
            activeForkId
        );
    }

    async sendFakeDisputeRequest(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromAddr = this.harness.getPeerHandle(fromPeer).address;
        await toHandle.queryInternals.onDisputeAcknowledgmentRequest(
            fromAddr,
            this.harness.channelId!,
            fakeForkId
        );
    }

    async simulateBuildOnDisputedFork(options: {
        buildingPeer: number;
        observingPeer: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { buildingPeer, observingPeer, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const buildingPeerHandle = this.harness.getPeerHandle(buildingPeer);
        const observingPeerHandle = this.harness.getPeerHandle(observingPeer);
        const buildingPeerAddress = buildingPeerHandle.address.toString();

        await this.waitForHandshakeCompleted(
            observingPeer,
            buildingPeerHandle.address
        );

        const buildingLatestBlock =
            await buildingPeerHandle.blocks.queryLatestBlockConfirmation(
                activeForkId
            );

        if (!buildingLatestBlock) {
            throw new Error(`No latest block found for fork ${activeForkId}`);
        }

        await observingPeerHandle.queryInternals.blockForkIsDisputed(
            buildingLatestBlock,
            buildingPeerAddress
        );
    }

    async connectPeers(peerIndices: number[]): Promise<void> {
        await this.harness.network.connectPeers(peerIndices);
    }

    async newPeerJoins(options: {
        newPeerIndex: number;
        observingPeerIndex: number;
    }): Promise<void> {
        await this.joinPeerToChannel(
            options.newPeerIndex,
            options.observingPeerIndex
        );
    }

    async sendInvalidTimeHandshakeRequest(options: {
        fromPeer: number;
        toPeer: number;
        timeOffset: number;
    }): Promise<void> {
        const { fromPeer, toPeer, timeOffset } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromAddr = this.harness.getPeerHandle(fromPeer).address;
        const agreementTime =
            this.harness.options.timeConfig?.agreementTime ?? 0;
        const invalidTime =
            Clock.getTimeInSeconds() + agreementTime + timeOffset;
        await toHandle.queryInternals.onInitHandshakeRequest(
            fromAddr,
            fakeHash(),
            invalidTime
        );
    }

    async initiateHandshake(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const toAddr = this.harness.getPeerHandle(toPeer).address;
        await fromHandle.queryInternals.initHandshakeTo(toAddr);
    }

    async sendSlowHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
        delaySeconds: number;
    }): Promise<void> {
        const { fromPeer, toPeer, delaySeconds } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const fromAddr = fromHandle.address;

        const challenge =
            await toHandle.queryInternals.getInitChallenge(fromAddr);
        if (!challenge)
            throw new Error("No challenge found - initiate handshake first");

        const agreementTime =
            this.harness.options.timeConfig?.agreementTime ?? 0;
        const slowResponseTime =
            challenge.initTime + agreementTime + delaySeconds;
        const signature = await fromHandle.signer.signMessage(
            ethers.getBytes(challenge.randomChallengeHash)
        );
        const fromPreferred =
            await fromHandle.queryInternals.getPreferredTransportType();

        await toHandle.queryInternals.onInitHandshakeResponse(
            fromAddr,
            signature,
            slowResponseTime,
            fromPreferred
        );
    }

    async sendUnsolicitedHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const fromAddr = fromHandle.address;

        const challenge =
            await toHandle.queryInternals.getInitChallenge(fromAddr);
        if (challenge)
            throw new Error(
                "Challenge already exists - this wouldn't be unsolicited"
            );

        const signature = await fromHandle.signer.signMessage(
            ethers.getBytes(fakeHash())
        );
        const fromPreferred =
            await fromHandle.queryInternals.getPreferredTransportType();
        await toHandle.queryInternals.onInitHandshakeResponse(
            fromAddr,
            signature,
            Clock.getTimeInSeconds(),
            fromPreferred
        );
    }

    async clearHandshakeChallenge(options: {
        peerIndex: number;
        targetPeer: number;
    }): Promise<void> {
        const { peerIndex, targetPeer } = options;
        const handle = this.harness.getPeerHandle(peerIndex);
        const targetAddr = this.harness.getPeerHandle(targetPeer).address;
        await handle.queryInternals.clearInitChallenge(targetAddr);
    }

    async sendValidHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const fromAddr = fromHandle.address;

        const challenge =
            await toHandle.queryInternals.getInitChallenge(fromAddr);
        if (!challenge)
            throw new Error("No challenge found - initiate handshake first");

        const signature = await fromHandle.signer.signMessage(
            ethers.getBytes(challenge.randomChallengeHash)
        );
        const fromPreferred =
            await fromHandle.queryInternals.getPreferredTransportType();
        await toHandle.queryInternals.onInitHandshakeResponse(
            fromAddr,
            signature,
            Clock.getTimeInSeconds(),
            fromPreferred
        );
    }

    async initiateHandshakeWithoutResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const toAddr = this.harness.getPeerHandle(toPeer).address;
        await fromHandle.queryInternals.initHandshakeTo(toAddr);
    }

    async sendDuplicateAcknowledgmentResponse(options: {
        respondingPeer: number;
        requestingPeer: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { respondingPeer, requestingPeer, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const requestingPeerHandle = this.harness.getPeerHandle(requestingPeer);
        const respondingHandle = this.harness.getPeerHandle(respondingPeer);
        await respondingHandle.queryInternals.respondToDisputeAcknowledgment(
            requestingPeerHandle.address,
            this.harness.channelId!,
            activeForkId
        );
    }

    async requestFakeDisputeWithSpiedDisconnect(options: {
        requestingPeer: number;
    }): Promise<void> {
        // Install disconnect filters so only disconnects targeting the requester proceed.
        const { requestingPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const requestingPeerHandle = this.harness.getPeerHandle(requestingPeer);
        const skipAddress = requestingPeerHandle.address;

        for (let i = 0; i < this.harness.peerCount; i++) {
            if (i === requestingPeer) continue;
            const peer = this.harness.getPeerHandle(i);
            await peer.network.installDisconnectFilter(
                (addr) => addr !== skipAddress
            );
        }

        await requestingPeerHandle.queryInternals.requestDisputeAcknowledgment(
            this.harness.channelId!,
            fakeForkId
        );
    }
}
