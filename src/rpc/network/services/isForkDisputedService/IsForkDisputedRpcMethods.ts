import IsForkDisputedService from "./IsForkDisputedService";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import { NetworkTransport } from "@/transport";
import { ChannelId, ForkId } from "@/types/types";

class IsForkDisputedRpcMethods extends ANetworkRpcMethods<IsForkDisputedService> {
    constructor(transport: NetworkTransport, service: IsForkDisputedService) {
        super(transport, service);
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
            this.p2pManager.disconnectConnection(
                this.senderTransport,
                DisconnectPolicy.BLACKLIST,
                "dispute acknowledgment request without peer address"
            );
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

        // The reads below outlive the channel: a leave settles under them, and
        // both effects that follow would then belong to no channel — an
        // acknowledgement refilling the map the reset cleared, or a verdict
        // following the peer into the next channel.
        const generation = this.p2pManager.stateManager.channelGeneration;
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

        if (this.p2pManager.stateManager.isStaleChannelWork(generation)) {
            throw new Error(
                "onDisputeAcknowledgmentRequest - the channel was left"
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
