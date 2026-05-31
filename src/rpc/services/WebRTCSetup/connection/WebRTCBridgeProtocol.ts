import type {
    WebRTCConnectionStateSnapshot,
    WebRTCDataChannelLike,
    WebRTCPeerAddress
} from "./WebRTCConnectionTypes";

export const WEBRTC_BRIDGE_NAMESPACE = "peer3:webrtc-bridge";

export type WebRTCBridgeInitMessage = {
    namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
    type: "init";
};

export type WebRTCBridgeRequest =
    | {
          method: "createOffer";
          peerAddress: WebRTCPeerAddress;
      }
    | {
          method: "acceptOffer";
          peerAddress: WebRTCPeerAddress;
          offer: any;
      }
    | {
          method: "applyAnswer";
          peerAddress: WebRTCPeerAddress;
          answer: any;
      }
    | {
          method: "addIceCandidate";
          peerAddress: WebRTCPeerAddress;
          candidate: any;
      }
    | {
          method: "close";
          peerAddress: WebRTCPeerAddress;
      }
    | {
          method: "getState";
          peerAddress: WebRTCPeerAddress;
      };

export type WebRTCBridgePortMessage =
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "request";
          requestId: number;
          request: WebRTCBridgeRequest;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "response";
          requestId: number;
          ok: true;
          result?: any;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "response";
          requestId: number;
          ok: false;
          error: {
              message: string;
              name?: string;
              stack?: string;
          };
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "channel";
          peerAddress: WebRTCPeerAddress;
          mode: "transferred";
          channel: WebRTCDataChannelLike;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "channel";
          peerAddress: WebRTCPeerAddress;
          mode: "proxy";
          label?: string;
          readyState?: string;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "state";
          peerAddress: WebRTCPeerAddress;
          state: WebRTCConnectionStateSnapshot;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "iceCandidate";
          peerAddress: WebRTCPeerAddress;
          candidate: any;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "error";
          peerAddress: WebRTCPeerAddress;
          error: {
              message: string;
              name?: string;
              stack?: string;
          };
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "proxySend";
          peerAddress: WebRTCPeerAddress;
          data: any;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "proxyClose";
          peerAddress: WebRTCPeerAddress;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "proxyMessage";
          peerAddress: WebRTCPeerAddress;
          data: any;
      }
    | {
          namespace: typeof WEBRTC_BRIDGE_NAMESPACE;
          type: "proxyState";
          peerAddress: WebRTCPeerAddress;
          readyState: string;
          event: "open" | "close" | "error";
          error?: {
              message: string;
              name?: string;
              stack?: string;
          };
      };

export function serializeBridgeError(error: unknown): {
    message: string;
    name?: string;
    stack?: string;
} {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack
        };
    }
    return { message: String(error) };
}

export function deserializeBridgeError(error: {
    message: string;
    name?: string;
    stack?: string;
}): Error {
    const deserialized = new Error(error.message);
    deserialized.name = error.name || "Error";
    if (error.stack) deserialized.stack = error.stack;
    return deserialized;
}
