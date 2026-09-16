// @spec-test-coverage-ignore: loopback endpoints for InitHandshake suspension component tests
import type {
    HandshakeSuspensionProbe,
    InitHandshakePolicyProbeService,
    RefusalOrderingProbe
} from "./InitHandshakePolicyProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class InitHandshakePolicyProbeRpcMethods extends ANetworkRpcMethods<InitHandshakePolicyProbeService> {
    constructor(
        transport: NetworkTransport,
        service: InitHandshakePolicyProbeService
    ) {
        super(transport, service);
    }

    public probeAckTimeoutAfterVerifiedAddress(): Promise<HandshakeSuspensionProbe> {
        return this.service.probeAckTimeoutAfterVerifiedAddress();
    }

    public probeRequestTimeout(): Promise<HandshakeSuspensionProbe> {
        return this.service.probeRequestTimeout();
    }

    public probeRefusedRequest(): Promise<HandshakeSuspensionProbe> {
        return this.service.probeRefusedRequest();
    }

    public probeTransportClosedDuringRequest(): Promise<HandshakeSuspensionProbe> {
        return this.service.probeTransportClosedDuringRequest();
    }

    public probeSkewedRequestRefusedBeforeClose(): Promise<RefusalOrderingProbe> {
        return this.service.probeSkewedRequestRefusedBeforeClose();
    }
}

export default InitHandshakePolicyProbeRpcMethods;
