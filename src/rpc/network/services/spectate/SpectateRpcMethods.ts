import SpectateService, { type SyncRequest } from "./SpectateService";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import { NetworkTransport } from "@/transport";
import { Bytes } from "@/types";
import { Codec, Type } from "@/utils";

class SpectateServiceRpcMethods extends ANetworkRpcMethods<SpectateService> {
    constructor(transport: NetworkTransport, service: SpectateService) {
        super(transport, service);
    }

    /**
     * Request/response: prove the latest possible snapshot for the requested
     * channel and return it encoded to the spectator's `.request(...)`. p2p sync
     * is mutual-cooperation: a request must be answerable with a valid proof. A
     * missing peer address, or a target we can't prove (bad/above-latest height,
     * unknown fork), disconnects and blacklists the requester and throws, so its
     * `.request(...)` rejects and it blacklists us in turn. A request about
     * another channel is closed without a verdict and also throws.
     */
    public async onSpectateRequest(
        syncRequest: SyncRequest
    ): Promise<{ encodedSyncPayload: Bytes }> {
        const senderTransport = this.senderTransport;
        const peerAddress = senderTransport.peerAddress;
        if (!peerAddress) {
            // HandshakeCompletedGuard should guarantee peerAddress is present.
            // If it's not, treat as malicious/broken peer.
            this.service.p2pManager.disconnectConnection(
                senderTransport,
                DisconnectPolicy.BLACKLIST,
                "spectate request without peer address"
            );
            throw new Error("onSpectateRequest - missing peer address");
        }
        // This runtime proves only the channel it serves now. A request about
        // another one, such as the channel it left, is not judged: the
        // connection closes without a verdict, so an honest peer still on that
        // channel can reconnect while repeats cost a reconnect each.
        const stateManager = this.service.p2pManager.stateManager;
        if (String(syncRequest.channelId) !== String(stateManager.channelId)) {
            this.service.logger.debug(
                "Spectate request for another channel, disconnecting",
                { peerAddress, channelId: syncRequest.channelId }
            );
            this.service.p2pManager.disconnectConnection(
                senderTransport,
                DisconnectPolicy.ALLOW
            );
            throw new Error("onSpectateRequest - not this runtime's channel");
        }
        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const syncPayload = await this.service.generateSyncPayload(
            syncRequest.channelId,
            syncRequest.forkId,
            syncRequest.blockHeight
        );

        if (!syncPayload) {
            // Couldn't prove the requested target: the requester failed to
            // cooperate (spammed an invalid/unprovable request) - cut it.
            this.service.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                peerAddress
            );
            throw new Error("onSpectateRequest - no sync payload to prove");
        }

        this.service.logger.debug(`onSpectateRequest - done`);
        return {
            encodedSyncPayload: Codec.encode(syncPayload, Type.SyncPayload)
        };
    }
}

export default SpectateServiceRpcMethods;
