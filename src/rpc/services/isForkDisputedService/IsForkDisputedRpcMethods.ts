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
     * Peer receives a dispute acknowledgment request. Request/response: resolves
     * to `true` once we confirm the fork is disputed (recording that we
     * acknowledged it to this peer). A fork that isn't disputed, a missing peer
     * address, or a duplicate request is a protocol violation: we disconnect the
     * requester and throw so its `.request(...)` rejects.
     */
    public async onDisputeAcknowledgmentRequest(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        const peerAddress = this.senderTransport.peerAddress;
        if (!peerAddress) {
            this.service.logger.error(
                `onDisputeAcknowledgmentRequest - missing peer address`
            );
            this.p2pManager.disconnectAndBlacklistPeer(this.senderTransport);
            throw new Error(
                "onDisputeAcknowledgmentRequest - missing peer address"
            );
        }

        // A second request for a fork we already acknowledged to this peer is a
        // protocol violation.
        if (this.service.didIAcknowledgeDisputedFork(peerAddress, forkId)) {
            this.service.logger.debug(
                `Already acknowledged fork ${forkId} to ${peerAddress}, disconnecting`
            );
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
            throw new Error("duplicate dispute acknowledgment request");
        }

        // Check if fork is disputed locally
        let isDisputed =
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                forkId
            );

        if (!isDisputed) {
            this.service.logger.verbose(
                `Fork ${forkId} is NOT disputed on local diamond, checking on-chain`
            );
            // check on-chain
            isDisputed =
                await this.p2pManager.stateManager.stateChannelManagerContract.isForkDisputed(
                    channelId,
                    forkId
                );
        }

        if (!isDisputed) {
            // Fork is not disputed - disconnect
            this.service.logger.debug(
                `Fork ${forkId} is not disputed, disconnecting`
            );
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
            throw new Error("fork not disputed");
        }

        this.service.logger.verbose(
            `Fork ${forkId} is disputed, acknowledging to ${peerAddress}`
        );
        this.service.IAcknowledgeDisputedFork(peerAddress, forkId);
        return true;
    }
}

export default IsForkDisputedRpcMethods;
