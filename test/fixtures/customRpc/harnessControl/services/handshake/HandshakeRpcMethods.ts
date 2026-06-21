import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { TransportType } from "@/transport/TransportType";
import Block from "@/models/Block";
import type {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature
} from "@/types/types";
import { Codec, Type } from "@/utils";
import type { HandshakeService } from "./HandshakeService";

/**
 * White-box driver for the handshake / dispute-acknowledgment RPC flows,
 * executed host-side. The original harness reached into a peer's live
 * `localRpc.initHandshakeService` / `isForkDisputedService` with a concrete
 * `ATransport`; transports can't cross the port, so every method targets the
 * other peer by **EVM address** and resolves the transport host-side.
 *
 * Flows that span two peers (e.g. a response signed by the responder against a
 * challenge held by the initiator) are exposed as granular primitives that the
 * harness orchestrates across two `control(peer)` calls.
 */
export class HandshakeRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: HandshakeService
    ) {
        super(transport, service.p2pManager);
    }

    // ===== Handshake initiation / state =====

    public initiateHandshake(otherAddress: Address): boolean {
        this.service.initHandshake.initHandshake(
            this.service.transportTo(otherAddress)
        );
        return true;
    }

    public getChallenge(
        otherAddress: Address
    ): { randomChallengeHash: string; initTime: number } | null {
        const challenge = this.service.initHandshake.getChallenge(
            this.service.transportTo(otherAddress)
        );
        return challenge
            ? {
                  randomChallengeHash: challenge.randomChallengeHash,
                  initTime: challenge.initTime
              }
            : null;
    }

    public clearChallenge(otherAddress: Address): boolean {
        return this.service.initHandshake.mapTransportToChallenge.delete(
            this.service.transportTo(otherAddress)
        );
    }

    public isHandshakeCompleted(otherAddress: Address): boolean {
        const profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(otherAddress);
        return profile?.getIsHandshakeCompleted() ?? false;
    }

    /** Sign a message hash with this peer's p2p signer. */
    public async signMessage(messageHash: string): Promise<string> {
        return this.p2pManager.p2pSigner.signMessage(messageHash);
    }

    public getPreferredTransport(): TransportType {
        return this.p2pManager.preferredTransport;
    }

    public getAgreementTime(): number {
        return this.service.sm.timeConfig.agreementTime;
    }

    // ===== Simulated inbound handshake messages (as if from `fromAddress`) =====

    public async deliverHandshakeRequest(
        fromAddress: Address,
        challengeHash: Hash,
        time: number
    ): Promise<boolean> {
        await this.service.initHandshake
            .createRPCMethods(this.service.transportTo(fromAddress))
            .onInitHandshakeRequest(challengeHash, time);
        return true;
    }

    public async deliverHandshakeResponse(
        fromAddress: Address,
        signature: Signature,
        responseTime: number,
        preferredTransport: TransportType
    ): Promise<boolean> {
        await this.service.initHandshake
            .createRPCMethods(this.service.transportTo(fromAddress))
            .onInitHandshakeResponse(
                signature,
                responseTime,
                preferredTransport
            );
        return true;
    }

    // ===== Dispute acknowledgment =====

    public requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): boolean {
        return this.service.isForkDisputed.requestDisputeAcknowledgment(
            channelId,
            forkId
        );
    }

    public async respondToDisputeAcknowledgment(
        requestingAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        await this.service.isForkDisputed.respondToDisputeAcknowledgment(
            String(requestingAddress),
            channelId,
            forkId
        );
        return true;
    }

    public async deliverDisputeAckRequest(
        fromAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        await this.service.isForkDisputed
            .createRPCMethods(this.service.transportTo(fromAddress))
            .onDisputeAcknowledgmentRequest(channelId, forkId);
        return true;
    }

    public didPeerAcknowledgeDisputedFork(
        respondingAddress: Address,
        forkId: ForkId
    ): boolean {
        return this.service.isForkDisputed.didPeerAcknowledgeDisputedFork(
            String(respondingAddress),
            forkId
        );
    }

    public didIAcknowledgeDisputedFork(
        requestingAddress: Address,
        forkId: ForkId
    ): boolean {
        return this.service.isForkDisputed.didIAcknowledgeDisputedFork(
            String(requestingAddress),
            forkId
        );
    }

    /** Size of the local `disputedForks` set (for duplicate-request assertions). */
    public getDisputedForksCount(): number {
        return this.service.isForkDisputed.disputedForks.size;
    }

    /**
     * Replay block-fork-dispute validation for a block built by `buildingAddress`
     * (its latest block confirmation, fetched from the building peer). Mirrors
     * the old `blockValidationStrategy.blockForkIsDisputed(block, address)`.
     */
    public async simulateBlockForkIsDisputed(
        encodedBlockConfirmation: string,
        buildingAddress: Address
    ): Promise<boolean> {
        const block = Block.fromBlockConfirmation(
            Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation)
        );
        await this.service.sm.blockValidationStrategy.blockForkIsDisputed(
            block,
            String(buildingAddress)
        );
        return true;
    }
}

export default HandshakeRpcMethods;
