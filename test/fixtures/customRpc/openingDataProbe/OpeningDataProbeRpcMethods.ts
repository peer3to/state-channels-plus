// @spec-test-coverage-ignore: loopback endpoints for mapped opening-data component cases
import type {
    DerivationFailureProbe,
    NegotiationRole,
    OpeningDataProbe,
    OpeningDataProbeService,
    OpeningDataSource,
    StaleDerivationProbe,
    StaleSettlement
} from "./OpeningDataProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class OpeningDataProbeRpcMethods extends ANetworkRpcMethods<OpeningDataProbeService> {
    constructor(transport: NetworkTransport, service: OpeningDataProbeService) {
        super(transport, service);
    }

    public probeOpeningData(
        role: NegotiationRole,
        source: OpeningDataSource
    ): Promise<OpeningDataProbe> {
        return this.service.probeOpeningData(role, source);
    }

    public probeDerivationFailure(
        role: NegotiationRole
    ): Promise<DerivationFailureProbe> {
        return this.service.probeDerivationFailure(role);
    }

    public probeStaleDerivation(
        role: NegotiationRole,
        settlement: StaleSettlement
    ): Promise<StaleDerivationProbe> {
        return this.service.probeStaleDerivation(role, settlement);
    }
}
