// @spec-test-coverage-ignore: loopback control endpoint for ARpcService component tests
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { PingPongRpc } from "../PingPongRpcManifest";
import type {
    ARpcDispatchProbe,
    ARpcDispatchProbeOptions,
    ARpcServiceProbeService
} from "./ARpcServiceProbeService";

export class ARpcServiceProbeRpcMethods extends ARpcMethods<
    P2PManager<PingPongRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: ARpcServiceProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public probeDispatch(
        method: string,
        options: ARpcDispatchProbeOptions
    ): Promise<ARpcDispatchProbe> {
        return this.service.probeDispatch(method, options);
    }
}
