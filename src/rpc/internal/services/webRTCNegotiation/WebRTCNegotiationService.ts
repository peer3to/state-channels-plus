import { WebRTCNegotiationRpcMethods } from "./WebRTCNegotiationRpcMethods";
import type { InternalRpcRouter } from "../../../router/InternalRpcRouter";
import type { WebRTCMainThreadBridgeRoot } from "../../roots/WebRTCMainThreadBridge";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type InternalTransport from "@/transport/InternalTransport";

export class WebRTCNegotiationService extends AInternalRpcService<WebRTCNegotiationRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly broker: Pick<
            WebRTCMainThreadBridgeRoot,
            | "createOffer"
            | "acceptOffer"
            | "applyAnswer"
            | "addIceCandidate"
            | "close"
            | "proxySend"
            | "proxyClose"
        >
    ) {
        super(router);
    }
    public createRPCMethods(sender: InternalTransport) {
        return new WebRTCNegotiationRpcMethods(this, sender);
    }
}
