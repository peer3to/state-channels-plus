import type { WebRTCBridgeService } from "./WebRTCBridgeService";
import type {
    WebRTCConnectionStateSnapshot,
    WebRTCDataChannelLike,
    WebRTCPeerAddress
} from "../../../network/services/WebRTCSetup/connection/WebRTCConnectionTypes";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
import type { SerializedError } from "@/rpc/internal/errorWire";

export class WebRTCBridgeRpcMethods extends AInternalRpcMethods<WebRTCBridgeService> {
    public transferredChannel(
        peerAddress: WebRTCPeerAddress,
        channel: WebRTCDataChannelLike
    ): void {
        this.service.client.transferredChannel(peerAddress, channel);
    }
    public proxyChannel(
        peerAddress: WebRTCPeerAddress,
        label?: string,
        readyState?: string
    ): void {
        this.service.client.proxyChannel(peerAddress, label, readyState);
    }
    public state(
        peerAddress: WebRTCPeerAddress,
        state: WebRTCConnectionStateSnapshot
    ): void {
        this.service.client.state(peerAddress, state);
    }
    public iceCandidate(
        peerAddress: WebRTCPeerAddress,
        candidate: RTCIceCandidateInit
    ): void {
        this.service.client.iceCandidate(peerAddress, candidate);
    }
    public error(peerAddress: WebRTCPeerAddress, error: SerializedError): void {
        this.service.client.error(peerAddress, error);
    }
    public proxyMessage(peerAddress: WebRTCPeerAddress, data: unknown): void {
        this.service.client.proxyMessage(peerAddress, data);
    }
    public proxyState(
        peerAddress: WebRTCPeerAddress,
        readyState: string,
        event: "open" | "close" | "error",
        error?: SerializedError
    ): void {
        this.service.client.proxyState(peerAddress, readyState, event, error);
    }
}
