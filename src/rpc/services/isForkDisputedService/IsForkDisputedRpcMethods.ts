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
        const peerAddress = this.senderTransport.peerAddress;
        if (!peerAddress) {
            this.service.logger.error(
                `onDisputeAcknowledgmentRequest - missing peer address`
            );
            return this.p2pManager.disconnectAndBlacklistPeer(
                this.senderTransport
            );
        }

        // Check if fork is disputed locally
        let isDisputed =
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                forkId
            );

        if (!isDisputed) {
            this.service.logger.verbose(
                `Fork ${forkId} is NOT disputed on local diamond, responding`
            );
            // check on-chain
            isDisputed =
                await this.p2pManager.stateManager.stateChannelManagerContract.isForkDisputed(
                    channelId,
                    forkId
                );
        }
        if (isDisputed) {
            this.service.logger.verbose(
                `Fork ${forkId} is disputed on-chain, responding`
            );
            return this.service.respondToDisputeAcknowledgment(
                peerAddress,
                channelId,
                forkId
            );
        }

        // Fork is not disputed - disconnect
        this.service.logger.debug(
            `Fork ${forkId} is not disputed, disconnecting`
        );
        return this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            peerAddress
        );
    }

    /**
     * Receive acknowledgment response from a peer
     */
    public async onDisputeAcknowledgmentResponse(
        channelId: ChannelId,
        forkId: ForkId
    ) {
        this.service.logger.verbose(
            `Received dispute acknowledgment response for fork ${forkId}`
        );

        const peerAddress = this.senderTransport.peerAddress;
        if (!peerAddress) {
            this.service.logger.error(
                `onDisputeAcknowledgmentResponse - missing peer address`
            );
            return;
        }

        // Mark that this peer has acknowledged (from our perspective)
        this.service.peerAcknowledgesDisputedFork(peerAddress, forkId);

        // Fire event hook for dispute acknowledgment
        this.p2pManager.stateManager.p2pEventHooks?.onDisputeAcknowledgment?.(
            peerAddress
        );
    }
}

export default IsForkDisputedRpcMethods;
