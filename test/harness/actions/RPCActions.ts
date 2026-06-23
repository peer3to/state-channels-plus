import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { TestPeer } from "@test/harness/core/types";
import { Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import InitHandshakeService from "@/rpc/services/initHandshake/InitHandshakeService";
import { hash as fakeHash } from "@test/factory";
import Clock from "@/Clock";

/**
 * Actions for RPC service testing.
 *
 * The handshake / dispute-acknowledgment flows run host-side via the
 * harness-control `handshake` service (the live `localRpc` services and
 * transports are behind the runtime port). Peers are targeted by EVM address;
 * flows that span two peers (challenge held by the initiator, response signed by
 * the responder) are orchestrated here across two `control(peer)` calls.
 *
 * NOTE: `getRemoteRpc` / `getLocalRpc` / `getTransport` / `getIsForkDisputedService`
 * / `getInitHandshakeService` still return live, by-reference objects and will
 * throw at runtime behind the port — they are pending the rpcStub/e2e milestone.
 */
export class RPCActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {}

    /**
     * Check if handshake is completed between two peers
     */
    async isHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address
    ): Promise<boolean> {
        const peer = this.harness.getPeer(peerIndex);
        return this.harness
            .control(peer)
            .handshake.isHandshakeCompleted(otherPeerAddress)
            .request();
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
        const peer = this.harness.getPeer(requestingPeerIndex);
        return this.harness
            .control(peer)
            .handshake.didPeerAcknowledgeDisputedFork(
                respondingPeerAddress,
                forkId
            )
            .request();
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
        await this.harness
            .control(newPeer)
            .network.connectToChannel(this.harness.channelId!.toString())
            .request();
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

        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .handshake.requestDisputeAcknowledgment(
                this.harness.channelId!,
                activeForkId
            )
            .request();
    }

    async sendFakeDisputeRequest(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const fromAddress = this.harness.getPeer(fromPeer).address;
        const toPeerObj = this.harness.getPeer(toPeer);

        await this.harness
            .control(toPeerObj)
            .handshake.deliverDisputeAckRequest(
                fromAddress,
                this.harness.channelId!,
                fakeForkId
            )
            .request();
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

        const blockConfirmation = await this.harness
            .control(buildingPeerObj)
            .query.getLatestBlockConfirmation(activeForkId)
            .request();

        if (!blockConfirmation) {
            throw new Error(`No latest block found for fork ${activeForkId}`);
        }

        await this.harness
            .control(observingPeerObj)
            .handshake.simulateBlockForkIsDisputed(
                blockConfirmation.encodedBlockConfirmation,
                buildingPeerObj.address
            )
            .request();
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
        const fromAddress = this.harness.getPeer(fromPeer).address;
        const toPeerObj = this.harness.getPeer(toPeer);

        const agreementTime = await this.harness
            .control(toPeerObj)
            .handshake.getAgreementTime()
            .request();
        const invalidTime =
            Clock.getTimeInSeconds() + agreementTime + timeOffset;

        await this.harness
            .control(toPeerObj)
            .handshake.deliverHandshakeRequest(
                fromAddress,
                fakeHash(),
                invalidTime
            )
            .request();
    }

    async initiateHandshake(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fromPeerObj = this.harness.getPeer(fromPeer);
        const toAddress = this.harness.getPeer(toPeer).address;

        await this.harness
            .control(fromPeerObj)
            .handshake.initiateHandshake(toAddress)
            .request();
    }

    async sendSlowHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
        delaySeconds: number;
    }): Promise<void> {
        const { fromPeer, toPeer, delaySeconds } = options;
        const fromPeerObj = this.harness.getPeer(fromPeer);
        const toPeerObj = this.harness.getPeer(toPeer);

        const challenge = await this.harness
            .control(toPeerObj)
            .handshake.getChallenge(fromPeerObj.address)
            .request();
        if (!challenge) {
            throw new Error("No challenge found - initiate handshake first");
        }

        const agreementTime = await this.harness
            .control(toPeerObj)
            .handshake.getAgreementTime()
            .request();
        const slowResponseTime =
            challenge.initTime + agreementTime + delaySeconds;

        await this.deliverResponse(
            fromPeerObj,
            toPeerObj,
            challenge.randomChallengeHash,
            slowResponseTime
        );
    }

    async sendUnsolicitedHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fromPeerObj = this.harness.getPeer(fromPeer);
        const toPeerObj = this.harness.getPeer(toPeer);

        const challenge = await this.harness
            .control(toPeerObj)
            .handshake.getChallenge(fromPeerObj.address)
            .request();
        if (challenge) {
            throw new Error(
                "Challenge already exists - this wouldn't be unsolicited"
            );
        }

        await this.deliverResponse(
            fromPeerObj,
            toPeerObj,
            fakeHash(),
            Clock.getTimeInSeconds()
        );
    }

    async clearHandshakeChallenge(options: {
        peerIndex: number;
        targetPeer: number;
    }): Promise<void> {
        const { peerIndex, targetPeer } = options;
        const peer = this.harness.getPeer(peerIndex);
        const targetAddress = this.harness.getPeer(targetPeer).address;

        await this.harness
            .control(peer)
            .handshake.clearChallenge(targetAddress)
            .request();
    }

    async sendValidHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fromPeerObj = this.harness.getPeer(fromPeer);
        const toPeerObj = this.harness.getPeer(toPeer);

        const challenge = await this.harness
            .control(toPeerObj)
            .handshake.getChallenge(fromPeerObj.address)
            .request();
        if (!challenge) {
            throw new Error("No challenge found - initiate handshake first");
        }

        await this.deliverResponse(
            fromPeerObj,
            toPeerObj,
            challenge.randomChallengeHash,
            Clock.getTimeInSeconds()
        );
    }

    async initiateHandshakeWithoutResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fromPeerObj = this.harness.getPeer(fromPeer);
        const toAddress = this.harness.getPeer(toPeer).address;

        await this.harness
            .control(fromPeerObj)
            .handshake.initiateHandshake(toAddress)
            .request();
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

        const requestingAddress = this.harness.getPeer(requestingPeer).address;
        const respondingPeerObj = this.harness.getPeer(respondingPeer);

        await this.harness
            .control(respondingPeerObj)
            .handshake.respondToDisputeAcknowledgment(
                requestingAddress,
                this.harness.channelId!,
                activeForkId
            )
            .request();
    }

    async requestFakeDisputeWithSpiedDisconnect(options: {
        requestingPeer: number;
    }): Promise<void> {
        const { requestingPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const requestingPeerObj = this.harness.getPeer(requestingPeer);

        // Stop every other peer from disconnecting/blacklisting the requester so
        // the fake request lands and is observed without tearing the link down.
        for (let i = 0; i < this.harness.peers.length; i++) {
            if (i === requestingPeer) continue;
            const peer = this.harness.getPeer(i);
            await this.harness
                .control(peer)
                .stub.stubSelectiveDisconnect(requestingPeerObj.address)
                .request();
        }

        await this.harness
            .control(requestingPeerObj)
            .handshake.requestDisputeAcknowledgment(
                this.harness.channelId!,
                fakeForkId
            )
            .request();
    }

    /**
     * Sign `challengeHash` as the responder and deliver an init-handshake
     * response to the initiator (a two-peer flow: the initiator holds the
     * challenge; the responder owns the signer).
     */
    private async deliverResponse(
        responder: TestPeer<TCustomRpc>,
        initiator: TestPeer<TCustomRpc>,
        challengeHash: string,
        responseTime: number
    ): Promise<void> {
        // Mirror production: the responder signs the domain-separated challenge
        // message, not the bare hash, so the response verifies.
        const challengeMessage =
            InitHandshakeService.buildHandshakeChallengeMessage(challengeHash);
        const signature = await this.harness
            .control(responder)
            .handshake.signMessage(challengeMessage)
            .request();
        const preferredTransport = await this.harness
            .control(responder)
            .handshake.getPreferredTransport()
            .request();

        await this.harness
            .control(initiator)
            .handshake.deliverHandshakeResponse(
                responder.address,
                signature,
                responseTime,
                preferredTransport
            )
            .request();
    }
}
