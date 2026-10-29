import { WebRTCBridgeRpcMethods } from "./WebRTCBridgeRpcMethods";
import type { InternalRpcRouter } from "../../../router/InternalRpcRouter";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type WorkerBridgeWebRTCConnectionFactory from "@/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory";
import type InternalTransport from "@/transport/InternalTransport";

export class WebRTCBridgeService extends AInternalRpcService<WebRTCBridgeRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly client: WorkerBridgeWebRTCConnectionFactory
    ) {
        super(router);
    }
    public createRPCMethods(sender: InternalTransport) {
        return new WebRTCBridgeRpcMethods(this, sender);
    }
}
