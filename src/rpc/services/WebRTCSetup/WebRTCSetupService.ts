import ARpcService from "@/rpc/ARpcService";
//@ts-ignore
import { RTCPeerConnection } from "get-webrtc";
import WebRTCTransport from "@/transport/WebRTCTransport";
import type P2PManager from "@/P2PManager";
import WebRTCSetupRpcMethods from "./WebRTCSetupRpcMethods";
import { ATransport, TransportType } from "@/transport";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { getChecksumAddress } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

class WebRTCSetupService extends ARpcService<WebRTCSetupRpcMethods> {
    connectionMap: Map<string, RTCPeerConnection> = new Map();

    private findWebRTCTransport(peerAddress: string): ATransport | undefined {
        return this.p2pManager.openConnections.find(
            (t) =>
                t.peerAddress === peerAddress &&
                t.transportType === TransportType.WEBRTC
        );
    }

    public setupConnectionStateHandlers(
        connection: RTCPeerConnection,
        peerAddress: string
    ): void {
        // Handle connection state changes
        connection.onconnectionstatechange = () => {
            const state = connection.connectionState;
            const iceState = connection.iceConnectionState;

            if (
                state === "disconnected" ||
                state === "failed" ||
                state === "closed"
            ) {
                const transport = this.findWebRTCTransport(peerAddress);
                if (transport) {
                    LoggerUtils.logTransportDisconnect(transport, {
                        reason: `connection state: ${state}`,
                        connectionState: state,
                        iceState
                    });
                }
                if (
                    (state === "failed" || state === "closed") &&
                    transport &&
                    !transport.isClosed
                ) {
                    transport.close();
                }
            }
        };

        // Handle ICE connection state changes
        connection.oniceconnectionstatechange = () => {
            const iceState = connection.iceConnectionState;
            const connectionState = connection.connectionState;

            if (
                iceState === "disconnected" ||
                iceState === "failed" ||
                iceState === "closed"
            ) {
                const transport = this.findWebRTCTransport(peerAddress);
                if (transport) {
                    LoggerUtils.logTransportDisconnect(transport, {
                        reason: `ICE connection state: ${iceState}`,
                        connectionState,
                        iceState
                    });
                }
                if (
                    (iceState === "failed" || iceState === "closed") &&
                    transport &&
                    !transport.isClosed
                ) {
                    transport.close();
                }
            }
        };
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

    //Ran by the peer who is initiating the connection - this creates the offer
    public async initiateWebRTC(transport: ATransport) {
        //TODO! - require seccusfull init handshake (also on other methods)
        try {
            this.logger.debug("initiateWebRTC");
            const connection = new RTCPeerConnection();
            const channel = connection.createDataChannel("webRTC-DataChannel");
            new WebRTCTransport(channel, this.p2pManager);
            const profileManager = this.p2pManager.profileManager;
            let adr =
                profileManager.getProfileByTransport(transport)?.evmAddress;
            if (!adr) {
                this.logger.error("initiateWebRTC - no EVM address");
                return;
            }
            adr = getChecksumAddress(adr);

            // Handle ICE candidates
            connection.onicecandidate = (event: any) => {
                if (event.candidate) {
                    const serializedCandidate = JSON.stringify(event.candidate);
                    this.remoteRpc.webRTCSetupService
                        .onIceCandidate(serializedCandidate)
                        .sendOne(adr);
                }
            };

            // Setup connection state handlers
            this.setupConnectionStateHandlers(connection, adr);

            const offer = await connection.createOffer();
            connection.setLocalDescription(offer);
            this.connectionMap.set(adr, connection);
            const serializedOffer = JSON.stringify(offer);
            this.remoteRpc.webRTCSetupService
                .onOfferWebRTC(serializedOffer)
                .sendOne(adr);
        } catch (e) {
            this.logger.debug("initiateWebRTC - error", e);
        }
    }
}

export default WebRTCSetupService;
