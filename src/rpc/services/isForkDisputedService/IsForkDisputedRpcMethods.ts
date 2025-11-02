import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import IsForkDisputedService from "./IsForkDisputedService";
import { ChannelId, ForkId } from "@/types/types";

class IsForkDisputedRpcMethods extends ARpcMethods {
    service: IsForkDisputedService;

    constructor(transport: ATransport, service: IsForkDisputedService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    /**
     * Peer receives dispute acknowledgment request
     * Check if fork is disputed and respond accordingly
     */
    public async onDisputeAcknowledgmentRequest(
        channelId: ChannelId,
        forkId: ForkId
    ) {
        console.log(
            `Received dispute acknowledgment request for fork ${forkId}`
        );

        // Check if we already sent a request for this forkId
        if (
            this.service.hasAcknowledgedDisputedFork(
                this.senderTransport,
                forkId
            )
        ) {
            console.log(
                `Already sent request for fork ${forkId}, disconnecting`
            );
            return this.p2pManager.disconnectAndBlacklistPeer(
                this.senderTransport
            );
        }

        // Check if fork is disputed locally
        const isDisputedLocal =
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                forkId
            );

        if (isDisputedLocal) {
            console.log(
                `Fork ${forkId} is disputed on local diamond, responding`
            );
            return this.respondToDisputeAcknowledgment(channelId, forkId);
        }

        // Check if fork is disputed on chain
        const isDisputedOnChain =
            await this.p2pManager.stateManager.stateChannelManagerContract.isForkDisputed(
                channelId,
                forkId
            );

        if (isDisputedOnChain) {
            console.log(`Fork ${forkId} is disputed on-chain, responding`);
            return this.respondToDisputeAcknowledgment(channelId, forkId);
        }

        // Fork is not disputed - disconnect
        console.log(`Fork ${forkId} is not disputed, disconnecting`);
        return this.p2pManager.disconnectAndBlacklistPeer(this.senderTransport);
    }

    /**
     * Respond to dispute acknowledgment
     */
    private async respondToDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ) {
        // Check if we already responded for this forkId
        if (
            this.service.hasAcknowledgedDisputedFork(
                this.senderTransport,
                forkId
            )
        ) {
            console.log(`Already responded for fork ${forkId}, disconnecting`);
            return this.p2pManager.disconnectAndBlacklistPeer(
                this.senderTransport
            );
        }

        // Mark as acknowledged locally (from peer's perspective)
        this.service.acknowledgeDisputedFork(this.senderTransport, forkId);
        console.log(`Acknowledged disputed fork ${forkId}`);

        // Send acknowledgment response back to the requester
        this.remoteRpc.isForkDisputedService
            .onDisputeAcknowledgmentResponse(channelId, forkId)
            .sendOne(this.senderTransport);
    }

    /**
     * Receive acknowledgment response from a peer
     */
    public async onDisputeAcknowledgmentResponse(
        channelId: ChannelId,
        forkId: ForkId
    ) {
        console.log(
            `Received dispute acknowledgment response for fork ${forkId}`
        );

        const senderTransport = this.senderTransport;
        if (!senderTransport) {
            return;
        }

        // Mark that this peer has acknowledged (from our perspective)
        this.service.acknowledgeDisputedFork(senderTransport, forkId);
    }
}

export default IsForkDisputedRpcMethods;
