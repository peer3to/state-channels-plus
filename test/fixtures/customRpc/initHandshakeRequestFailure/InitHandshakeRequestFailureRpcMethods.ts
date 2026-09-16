// @spec-test-coverage-ignore: loopback endpoints for InitHandshake request-failure component tests
import type {
    HandshakeRequestFailureProbe,
    InitHandshakeRequestFailureService
} from "./InitHandshakeRequestFailureService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class InitHandshakeRequestFailureRpcMethods extends ANetworkRpcMethods<InitHandshakeRequestFailureService> {
    constructor(
        transport: NetworkTransport,
        service: InitHandshakeRequestFailureService
    ) {
        super(transport, service);
    }

    public probeRequestTimeout(): Promise<HandshakeRequestFailureProbe> {
        return this.service.probeRequestTimeout();
    }

    public probeRemoteError(): Promise<HandshakeRequestFailureProbe> {
        return this.service.probeRemoteError();
    }

    public probeTransportClosedDuringRequest(): Promise<HandshakeRequestFailureProbe> {
        return this.service.probeTransportClosedDuringRequest();
    }
}

export default InitHandshakeRequestFailureRpcMethods;
