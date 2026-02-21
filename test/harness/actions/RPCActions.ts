import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import IsForkDisputedService from "@/rpc/services/isForkDisputedService/IsForkDisputedService";
import InitHandshakeService from "@/rpc/services/initHandshake/InitHandshakeService";
import { hash as fakeHash } from "@test/factory";
import Clock from "@/Clock";
import { ethers } from "ethers";

/**
 * Actions for RPC service testing
 * Provides access to RPC services and helper methods for test blocks
 */
export class RPCActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Get IsForkDisputed RPC service for a peer
     */
    getIsForkDisputedService(peerIndex: number): IsForkDisputedService {
        return this.harness.getPeer(peerIndex).stateManager.p2pManager.localRpc
            .isForkDisputedService;
    }

    /**
     * Get InitHandshake RPC service for a peer
     */
    getInitHandshakeService(peerIndex: number): InitHandshakeService {
        return this.harness.getPeer(peerIndex).stateManager.p2pManager.localRpc
            .initHandshakeService;
    }

    /**
     * Check if handshake is completed between two peers
     */
    isHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address
    ): boolean {
        const profile = this.harness.stateQuery.getProfile(
            peerIndex,
            otherPeerAddress
        );
        return profile?.getIsHandshakeCompleted() ?? false;
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
    didPeerAcknowledgeDisputedFork(
        requestingPeerIndex: number,
        respondingPeerAddress: Address,
        forkId: ForkId
    ): boolean {
        const service = this.getIsForkDisputedService(requestingPeerIndex);
        return service.didPeerAcknowledgeDisputedFork(
            respondingPeerAddress.toString(),
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
        const newPeer = this.harness.getPeer(newPeerIndex);
        await newPeer.stateManager.p2pManager.tryOpenConnectionToChannel(
            this.harness.channelId!.toString()
        );
        await this.waitForHandshakeCompleted(
            observingPeerIndex,
            newPeer.address
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

        const service = this.getIsForkDisputedService(peerIndex);
        await service.requestDisputeAcknowledgment(
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
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const receivingService = this.getIsForkDisputedService(toPeer);
        await receivingService
            .createRPCMethods(transport)
            .onDisputeAcknowledgmentRequest(
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

        const buildingPeerObj = this.harness.getPeer(buildingPeer);
        const observingPeerObj = this.harness.getPeer(observingPeer);

        const transport = await this.harness.stateQuery.waitForPeerTransport(
            observingPeer,
            buildingPeer,
            5000
        );

        const buildingLatestBlock =
            buildingPeerObj.stateManager.storage.blocks.getLatestBlock(
                activeForkId
            );

        if (!buildingLatestBlock) {
            throw new Error(`No latest block found for fork ${activeForkId}`);
        }

        const buildingPeerAddress =
            transport.peerAddress ?? buildingPeerObj.address;

        await observingPeerObj.stateManager.blockValidationStrategy.blockForkIsDisputed(
            buildingLatestBlock,
            buildingPeerAddress
        );
    }

    async connectPeers(peerIndices: number[]): Promise<void> {
        await this.harness.networkController.connectPeers(peerIndices);
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
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const receivingService = this.getInitHandshakeService(toPeer);
        const agreementTime =
            this.harness.peers[toPeer].stateManager.timeConfig.agreementTime;
        const invalidTime =
            Clock.getTimeInSeconds() + agreementTime + timeOffset;

        await receivingService
            .createRPCMethods(transport)
            .onInitHandshakeRequest(fakeHash(), invalidTime);
    }

    async initiateHandshake(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            fromPeer,
            toPeer,
            5000
        );

        const service = this.getInitHandshakeService(fromPeer);
        service.initHandshake(transport);
    }

    async sendSlowHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
        delaySeconds: number;
    }): Promise<void> {
        const { fromPeer, toPeer, delaySeconds } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const initiatingService = this.getInitHandshakeService(toPeer);
        const challenge = initiatingService.getChallenge(transport);

        if (!challenge) {
            throw new Error("No challenge found - initiate handshake first");
        }

        const fromPeerObj = this.harness.getPeer(fromPeer);
        const agreementTime =
            this.harness.peers[toPeer].stateManager.timeConfig.agreementTime;
        const slowResponseTime =
            challenge.initTime + agreementTime + delaySeconds;

        const signature =
            await fromPeerObj.stateManager.p2pManager.p2pSigner.signMessage(
                challenge.randomChallengeHash
            );

        const rpcHandler = initiatingService.createRPCMethods(transport);
        await rpcHandler.onInitHandshakeResponse(
            signature,
            slowResponseTime,
            fromPeerObj.stateManager.p2pManager.preferredTransport
        );
    }

    async sendInvalidSignatureHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const fromPeerObj = this.harness.getPeer(fromPeer);
        const initiatingService = this.getInitHandshakeService(toPeer);

        const wrongMessage = ethers.randomBytes(32);
        const invalidSignature =
            await fromPeerObj.signer.signMessage(wrongMessage);

        const rpcHandler = initiatingService.createRPCMethods(transport);
        await rpcHandler.onInitHandshakeResponse(
            invalidSignature,
            Clock.getTimeInSeconds(),
            fromPeerObj.stateManager.p2pManager.preferredTransport
        );
    }

    async sendUnsolicitedHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const fromPeerObj = this.harness.getPeer(fromPeer);
        const initiatingService = this.getInitHandshakeService(toPeer);
        const challenge = initiatingService.getChallenge(transport);
        if (challenge) {
            throw new Error(
                "Challenge already exists - this wouldn't be unsolicited"
            );
        }

        const signature =
            await fromPeerObj.stateManager.p2pManager.p2pSigner.signMessage(
                fakeHash()
            );

        const rpcHandler = initiatingService.createRPCMethods(transport);
        await rpcHandler.onInitHandshakeResponse(
            signature,
            Clock.getTimeInSeconds(),
            fromPeerObj.stateManager.p2pManager.preferredTransport
        );
    }

    async clearHandshakeChallenge(options: {
        peerIndex: number;
        targetPeer: number;
    }): Promise<void> {
        const { peerIndex, targetPeer } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            peerIndex,
            targetPeer,
            5000
        );

        const service = this.getInitHandshakeService(peerIndex);
        service.mapTransportToChallenge.delete(transport);
    }

    async sendValidHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const initService = this.getInitHandshakeService(toPeer);
        const challenge = initService.getChallenge(transport);

        if (!challenge) {
            throw new Error("No challenge found - initiate handshake first");
        }

        const respondingPeer = this.harness.getPeer(fromPeer);
        const signature =
            await respondingPeer.stateManager.p2pManager.p2pSigner.signMessage(
                challenge.randomChallengeHash
            );

        await initService
            .createRPCMethods(transport)
            .onInitHandshakeResponse(
                signature,
                Clock.getTimeInSeconds(),
                respondingPeer.stateManager.p2pManager.preferredTransport
            );
    }

    async initiateHandshakeWithoutResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.stateQuery.waitForPeerTransport(
            fromPeer,
            toPeer,
            5000
        );

        const initService = this.getInitHandshakeService(fromPeer);
        initService.initHandshake(transport);
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

        const requestingPeerObj = this.harness.getPeer(requestingPeer);
        const service = this.getIsForkDisputedService(respondingPeer);

        await service.respondToDisputeAcknowledgment(
            requestingPeerObj.address,
            this.harness.channelId!,
            activeForkId
        );
    }

    async requestFakeDisputeWithSpiedDisconnect(options: {
        requestingPeer: number;
    }): Promise<void> {
        const { requestingPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const requestingPeerObj = this.harness.getPeer(requestingPeer);
        const service = this.getIsForkDisputedService(requestingPeer);

        for (let i = 0; i < this.harness.peers.length; i++) {
            if (i === requestingPeer) continue;

            const peer = this.harness.getPeer(i);
            const originalDisconnect =
                peer.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress.bind(
                    peer.stateManager.p2pManager
                );

            peer.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                (addr) => {
                    if (addr === requestingPeerObj.address) {
                        return;
                    }
                    return originalDisconnect(addr);
                };
        }

        service.requestDisputeAcknowledgment(
            this.harness.channelId!,
            fakeForkId
        );
    }
}
