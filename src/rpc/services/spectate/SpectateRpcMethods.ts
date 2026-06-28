import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import SpectateService, { SyncRequest } from "./SpectateService";
import { Bytes } from "@/types";
import Clock from "@/Clock";
import { Codec, Type } from "@/utils";

class SpectateServiceRpcMethods extends ARpcMethods {
    service: SpectateService;
    constructor(transport: ATransport, service: SpectateService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    /**
     * Request/response: prove the latest possible snapshot for the requested
     * channel and return it encoded to the spectator's `.request(...)`. A missing
     * peer address or an unprovable channel disconnects the spectator and throws
     * so its request rejects.
     */
    public async onSpectateRequest(
        syncRequest: SyncRequest
    ): Promise<{ encodedSyncPayload: Bytes }> {
        const senderTransport = this.senderTransport;
        const peerAddress = senderTransport.peerAddress;
        if (!peerAddress) {
            // HandshakeCompletedGuard should guarantee peerAddress is present.
            // If it's not, treat as malicious/broken peer.
            this.service.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            throw new Error("onSpectateRequest - missing peer address");
        }

        const localTime = Clock.getTimeInSeconds();

        this.service.logger.debug(
            `onSpectateRequest - localTime: ${localTime}, remoteTime: ${syncRequest.initTime}`
        );

        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const syncPayload = await this.service.generateSyncPayload(
            syncRequest.channelId,
            syncRequest.forkId,
            syncRequest.blockHeight
        );

        if (!syncPayload) {
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
