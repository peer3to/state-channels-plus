// @spec-test-coverage-ignore: loopback control endpoints for the mapped NetworkTransport component cases
import type {
    ATransportCloseProbe,
    ATransportDeliveryProbe,
    ATransportFailureProbe,
    ATransportIdentityProbe,
    ATransportProbeService
} from "./ATransportProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

export class ATransportProbeRpcMethods extends ANetworkRpcMethods<ATransportProbeService> {
    constructor(transport: NetworkTransport, service: ATransportProbeService) {
        super(transport, service);
    }

    public probeMessageConversion() {
        return this.service.probeMessageConversion();
    }

    public probeIdentity(
        firstAddress: string,
        secondAddress: string
    ): ATransportIdentityProbe {
        return this.service.probeIdentity(firstAddress, secondAddress);
    }

    public probeDelivery(
        rpc: Rpc,
        response: RpcResponse
    ): ATransportDeliveryProbe {
        return this.service.probeDelivery(rpc, response);
    }

    public probeClose(
        peerAddress: string,
        isExpected: boolean,
        closeTwice: boolean
    ): ATransportCloseProbe {
        return this.service.probeClose(peerAddress, isExpected, closeTwice);
    }

    public probeFailures(): ATransportFailureProbe {
        return this.service.probeFailures();
    }
}
