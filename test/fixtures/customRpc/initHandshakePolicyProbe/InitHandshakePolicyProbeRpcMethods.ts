// @spec-test-coverage-ignore: loopback endpoints for InitHandshake disconnect-policy component tests
import type {
    AckTimeoutPolicyProbe,
    BlacklistedSignerPolicyProbe,
    InitHandshakePolicyProbeService
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

    public probeAckTimeoutAfterVerifiedAddress(): Promise<AckTimeoutPolicyProbe> {
        return this.service.probeAckTimeoutAfterVerifiedAddress();
    }

    public probeBlacklistedResponseSigner(): Promise<BlacklistedSignerPolicyProbe> {
        return this.service.probeBlacklistedResponseSigner();
    }
}

export default InitHandshakePolicyProbeRpcMethods;
