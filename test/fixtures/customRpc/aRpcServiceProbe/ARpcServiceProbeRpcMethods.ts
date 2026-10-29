// @spec-test-coverage-ignore: loopback control endpoint for ANetworkRpcService component tests
import type {
    ARpcDispatchProbe,
    ARpcDispatchProbeOptions,
    ARpcServiceProbeService
} from "./ARpcServiceProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class ARpcServiceProbeRpcMethods extends ANetworkRpcMethods<ARpcServiceProbeService> {
    constructor(transport: NetworkTransport, service: ARpcServiceProbeService) {
        super(transport, service);
    }

    public probeDispatch(
        method: string,
        options: ARpcDispatchProbeOptions
    ): Promise<ARpcDispatchProbe> {
        return this.service.probeDispatch(method, options);
    }
}
