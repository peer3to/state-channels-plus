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
     * Peer receives fork disputed acknowledgment request
     * They need to check if they agree the fork is disputed
     */
    public async onIsForkDisputedRequest(channelId: ChannelId, forkId: ForkId) {
        console.log(
            `Received dispute acknowledgment request for fork ${forkId}`
        );

        // Check if we agree that this fork is disputed
        const isDisputed =
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                forkId
            );

        // Send our acknowledgment back
        this.remoteRpc.isForkDisputedService
            .onIsForkDisputedResponse(channelId, forkId, isDisputed)
            .sendOne(this.senderTransport);
    }

    /**
     * Peer receives dispute acknowledgment response
     * If they don't agree on the dispute status, disconnect
     */
    public async onIsForkDisputedResponse(
        channelId: ChannelId,
        forkId: ForkId,
        peerThinksDisputed: boolean
    ) {
        console.log(
            `Received disputed fork acknowledgment response for fork ${forkId}`
        );

        // Check our own view of whether the fork is disputed
        const weThinkDisputed =
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                forkId
            );

        // If we don't agree on the disputed fork status, disconnect
        if (weThinkDisputed !== peerThinksDisputed) {
            console.log(
                `Dispute status mismatch for fork ${forkId}: we think ${weThinkDisputed}, peer thinks ${peerThinksDisputed}. Disconnecting.`
            );
            return this.p2pManager.disconnectAndBlacklistPeer(
                this.senderTransport
            );
        }

        // If we both agree the fork is disputed, mark it as acknowledged
        if (weThinkDisputed && peerThinksDisputed) {
            console.log(
                `Both peers agree fork ${forkId} is disputed. Marking as acknowledged.`
            );
            this.service.acknowledgeDisputedFork(this.senderTransport, forkId);
        }

        console.log(`Dispute handshake completed for fork ${forkId}`);
    }
}

export default IsForkDisputedRpcMethods;
