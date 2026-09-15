import type { WebRTCNegotiationService } from "./WebRTCNegotiationService";
import type { WebRTCPeerAddress } from "../../../network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class WebRTCNegotiationRpcMethods extends AInternalRpcMethods<WebRTCNegotiationService> {
    public createOffer(peerAddress: WebRTCPeerAddress) {
        return this.service.broker.createOffer(peerAddress);
    }
    public acceptOffer(
        peerAddress: WebRTCPeerAddress,
        offer: RTCSessionDescriptionInit
    ) {
        return this.service.broker.acceptOffer(peerAddress, offer);
    }
    public applyAnswer(
        peerAddress: WebRTCPeerAddress,
        answer: RTCSessionDescriptionInit
    ) {
        return this.service.broker.applyAnswer(peerAddress, answer);
    }
    public addIceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: RTCIceCandidateInit
    ) {
        return this.service.broker.addIceCandidate(peerAddress, candidate);
    }
    public close(peerAddress: WebRTCPeerAddress) {
        return this.service.broker.close(peerAddress);
    }
    public proxySend(peerAddress: WebRTCPeerAddress, data: unknown) {
        return this.service.broker.proxySend(peerAddress, data);
    }
    public proxyClose(peerAddress: WebRTCPeerAddress) {
        return this.service.broker.proxyClose(peerAddress);
    }
}
