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
            const senderTransport = this.senderTransport;
            if (!senderTransport) {
                return;
            }
            return this.service.respondToDisputeAcknowledgment(
                senderTransport,
                channelId,
                forkId
            );
        }

        // Check if fork is disputed on chain
        const isDisputedOnChain =
            await this.p2pManager.stateManager.stateChannelManagerContract.isForkDisputed(
                channelId,
                forkId
            );

        if (isDisputedOnChain) {
            console.log(`Fork ${forkId} is disputed on-chain, responding`);
            const senderTransport = this.senderTransport;
            if (!senderTransport) {
                return;
            }
            return this.service.respondToDisputeAcknowledgment(
                senderTransport,
                channelId,
                forkId
            );
        }

        // Fork is not disputed - disconnect
        console.log(`Fork ${forkId} is not disputed, disconnecting`);
        return this.p2pManager.disconnectAndBlacklistPeer(this.senderTransport);
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
