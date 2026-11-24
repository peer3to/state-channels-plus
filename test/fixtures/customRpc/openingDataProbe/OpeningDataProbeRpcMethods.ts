// @spec-test-coverage-ignore: loopback endpoints for mapped opening-data component cases
import type {
    CountersignFailureProbe,
    DerivationFailureProbe,
    ForeignOpenProbe,
    NegotiationRole,
    OpeningDataProbe,
    OpeningDataProbeService,
    OpeningDataSource,
    ProposalAlteration,
    ProposalAlterationProbe,
    StaleDerivationProbe,
    StalePoint,
    StaleSettlement
} from "./OpeningDataProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type { NegotiationMode } from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService";
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

    public probeGenesisFailure(
        role: NegotiationRole
    ): Promise<DerivationFailureProbe> {
        return this.service.probeGenesisFailure(role);
    }

    public probeCountersignFailure(): Promise<CountersignFailureProbe> {
        return this.service.probeCountersignFailure();
    }

    public probeAlteredProposal(
        alteration: ProposalAlteration
    ): Promise<ProposalAlterationProbe> {
        return this.service.probeAlteredProposal(alteration);
    }

    public probeForeignGenesisOpen(
        mode: NegotiationMode
    ): Promise<ForeignOpenProbe> {
        return this.service.probeForeignGenesisOpen(mode);
    }

    public probeStaleDerivation(
        role: NegotiationRole,
        settlement: StaleSettlement,
        point?: StalePoint
    ): Promise<StaleDerivationProbe> {
        return this.service.probeStaleDerivation(role, settlement, point);
    }
}
