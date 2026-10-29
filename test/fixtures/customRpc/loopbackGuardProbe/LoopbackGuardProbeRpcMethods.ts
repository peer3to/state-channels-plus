// @spec-test-coverage-ignore: loopback guard probe endpoint
import type {
    LoopbackGuardProbeResult,
    LoopbackGuardProbeService
} from "./LoopbackGuardProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class LoopbackGuardProbeRpcMethods extends ANetworkRpcMethods<LoopbackGuardProbeService> {
    constructor(
        transport: NetworkTransport,
        service: LoopbackGuardProbeService
    ) {
        super(transport, service);
    }

    public probe(): LoopbackGuardProbeResult {
        return this.service.probe();
    }
}
