// @spec-test-coverage-ignore: loopback control endpoints for the mapped ATransport component cases
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import type ATransport from "@/transport/ATransport";
import type { PingPongRpc } from "../PingPongRpcManifest";
import type {
    ATransportCloseProbe,
    ATransportDeliveryProbe,
    ATransportFailureProbe,
    ATransportIdentityProbe,
    ATransportProbeService
} from "./ATransportProbeService";

export class ATransportProbeRpcMethods extends ARpcMethods<
    P2PManager<PingPongRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: ATransportProbeService
    ) {
        super(transport, service.p2pManager);
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
