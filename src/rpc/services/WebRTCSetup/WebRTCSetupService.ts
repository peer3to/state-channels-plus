import ARpcService from "@/rpc/ARpcService";
import WebRTCTransport from "@/transport/WebRTCTransport";
import type P2PManager from "@/P2PManager";
import WebRTCSetupRpcMethods from "./WebRTCSetupRpcMethods";
import { ATransport, TransportType } from "@/transport";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { getChecksumAddress } from "@/utils";
import {
    createWebRTCConnectionFactory,
    type WebRTCConnectionCallbacks,
    type WebRTCConnectionFactory,
    type WebRTCConnectionStateSnapshot,
    type WebRTCDataChannelLike,
    type WebRTCPeerAddress
} from "./connection/WebRTCConnectionFactory";

class WebRTCSetupService extends ARpcService<WebRTCSetupRpcMethods> {
    private connectionFactory?: WebRTCConnectionFactory;

    private normalizePeerAddress(
        peerAddress: WebRTCPeerAddress
    ): WebRTCPeerAddress {
        return getChecksumAddress(peerAddress) as WebRTCPeerAddress;
    }

    private findWebRTCTransport(
        peerAddress: WebRTCPeerAddress
    ): ATransport | undefined {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        return this.p2pManager.openConnections.find(
            (t) =>
                t.peerAddress &&
                getChecksumAddress(t.peerAddress) === normalizedPeerAddress &&
                t.transportType === TransportType.WEBRTC
        );
    }

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                module: "WebRTCSetupService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): WebRTCSetupRpcMethods {
        return new WebRTCSetupRpcMethods(transport, this);
    }

    private async getConnectionFactory(): Promise<WebRTCConnectionFactory> {
        if (!this.connectionFactory) {
            this.connectionFactory = await createWebRTCConnectionFactory();
        }
        return this.connectionFactory;
    }

    private serializeAndSendIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): void {
        const serializedCandidate = JSON.stringify(candidate);
        this.remoteRpc.webRTCSetupService
            .onIceCandidate(serializedCandidate)
            .sendOne(peerAddress);
    }

    private handleConnectionStateChange(
        peerAddress: WebRTCPeerAddress,
        state: WebRTCConnectionStateSnapshot
    ): void {
        if (
            state.connectionState === "disconnected" ||
            state.connectionState === "failed" ||
            state.connectionState === "closed"
        ) {
            this.logger.warn(
                `WebRTC connection state changed: ${state.connectionState}`,
                {
                    iceState: state.iceState
                }
            );
            this.findWebRTCTransport(peerAddress)?.close();
            return;
        }

        if (
            state.iceState === "disconnected" ||
            state.iceState === "failed" ||
            state.iceState === "closed"
        ) {
            this.logger.warn(
                `WebRTC IceConnection state changed: ${state.iceState}`,
                {
                    iceState: state.iceState,
                    connectionState: state.connectionState
                }
            );
            this.findWebRTCTransport(peerAddress)?.close();
        }
    }

    private createTransportWhenDataChannelOpen(
        channel: WebRTCDataChannelLike
    ): void {
        const createTransport = () => {
            new WebRTCTransport(channel, this.p2pManager);
        };

        if (channel.readyState === "open") {
            createTransport();
            return;
        }

        channel.onopen = createTransport;
    }

    private createConnectionCallbacks(
        peerAddress: WebRTCPeerAddress
    ): WebRTCConnectionCallbacks {
        return {
            onIceCandidate: (candidate) => {
                this.serializeAndSendIceCandidate(peerAddress, candidate);
            },
            onDataChannel: (channel) => {
                this.createTransportWhenDataChannelOpen(channel);
            },
            onConnectionStateChange: (state) => {
                this.handleConnectionStateChange(peerAddress, state);
            },
            onError: (error) => {
                this.logger.error("WebRTC connection factory error", error);
            }
        };
    }

    public getWebRTCConnectionState(
        peerAddress: WebRTCPeerAddress
    ): WebRTCConnectionStateSnapshot {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        return (
            this.connectionFactory?.getState(normalizedPeerAddress) || {
                connectionState: "unknown",
                iceState: "unknown"
            }
        );
    }

    public closeWebRTCConnection(peerAddress: WebRTCPeerAddress): void {
        if (!this.connectionFactory) return;
        this.connectionFactory
            .close(this.normalizePeerAddress(peerAddress))
            .catch((error) => {
                this.logger.verbose("closeWebRTCConnection - error", error);
            });
    }

    public async acceptWebRTCOffer(
        peerAddress: WebRTCPeerAddress,
        offer: any
    ): Promise<any> {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        const factory = await this.getConnectionFactory();
        return factory.acceptOffer(
            normalizedPeerAddress,
            offer,
            this.createConnectionCallbacks(normalizedPeerAddress)
        );
    }

    public async applyWebRTCAnswer(
        peerAddress: WebRTCPeerAddress,
        answer: any
    ): Promise<void> {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        const factory = await this.getConnectionFactory();
        await factory.applyAnswer(normalizedPeerAddress, answer);
    }

    public async addWebRTCIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: any
    ): Promise<void> {
        const normalizedPeerAddress = this.normalizePeerAddress(peerAddress);
        const factory = await this.getConnectionFactory();
        await factory.addIceCandidate(normalizedPeerAddress, candidate);
    }

    //Ran by the peer who is initiating the connection - this creates the offer
    public async initiateWebRTC(transport: ATransport) {
        //TODO! - require seccusfull init handshake (also on other methods)
        try {
            this.logger.debug("initiateWebRTC");
            const profileManager = this.p2pManager.profileManager;
            let adr =
                profileManager.getProfileByTransport(transport)?.evmAddress;
            if (!adr) {
                this.logger.error("initiateWebRTC - no EVM address");
                return;
            }
            adr = getChecksumAddress(adr);

            const factory = await this.getConnectionFactory();
            const offer = await factory.createOffer(
                adr,
                this.createConnectionCallbacks(adr)
            );
            const serializedOffer = JSON.stringify(offer);
            this.remoteRpc.webRTCSetupService
                .onOfferWebRTC(serializedOffer)
                .sendOne(adr);
        } catch (e) {
            this.logger.error("initiateWebRTC - error", e);
        }
    }
}

export default WebRTCSetupService;
