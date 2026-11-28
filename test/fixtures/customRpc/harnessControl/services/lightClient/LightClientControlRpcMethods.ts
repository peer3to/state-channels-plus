// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type {
    LightClientControlService,
    LightClientCounts
} from "./LightClientControlService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Light client counters of a runtime. Only public endpoints live here; the
 * provider lookup is on {@link LightClientControlService}.
 */
export class LightClientControlRpcMethods extends ANetworkRpcMethods<LightClientControlService> {
    constructor(
        transport: NetworkTransport,
        service: LightClientControlService
    ) {
        super(transport, service);
    }

    public getCounts(): LightClientCounts | null {
        return this.service.counts();
    }
}
