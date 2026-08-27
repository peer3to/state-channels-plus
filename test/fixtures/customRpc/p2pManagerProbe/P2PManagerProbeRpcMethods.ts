// @spec-test-coverage-ignore: loopback endpoints for mapped P2PManager component cases
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { PingPongRpc } from "../PingPongRpcManifest";
import type {
    DispatchHeadProbe,
    DispatchOutcomeProbe,
    FrameByteBoundaryProbe,
    ForeignResponseProbe,
    LifecycleProbe,
    P2PManagerProbeService,
    ConcurrentSettlementProbe,
    DisposalProbe,
    RequestRaceProbe,
    RequestRegistryProbe,
    RequestSettlementProbe,
    TimeoutSelectionProbe,
    DisconnectCleanupProbe,
    TransportRetirementProbe,
    BulkPenaltyProbe,
    ConnectedPeerFallbackProbe,
    BanPolicyProbe,
    RelayAdmissionProbe,
    UpgradeBanPolicyProbe,
    HolepunchTopicProbe,
    HandshakeFailureProbe,
    LateHandshakeProbe,
    ReplacementHandshakeProbe
} from "./P2PManagerProbeService";

export class P2PManagerProbeRpcMethods extends ARpcMethods<
    P2PManager<PingPongRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: P2PManagerProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public recordDispatch(): void {
        this.service.recordDispatch();
    }

    public probeDispatchHead(): DispatchHeadProbe {
        return this.service.probeDispatchHead();
    }

    public probeDispatchOutcomes(): DispatchOutcomeProbe {
        return this.service.probeDispatchOutcomes();
    }

    public probeFrameByteBoundaries(): FrameByteBoundaryProbe {
        return this.service.probeFrameByteBoundaries();
    }

    public probeRequestSettlement(): Promise<RequestSettlementProbe> {
        return this.service.probeRequestSettlement();
    }

    public probeTimeoutSelection(): Promise<TimeoutSelectionProbe> {
        return this.service.probeTimeoutSelection();
    }

    public probeResponseTimeoutRace(
        responseFirst: boolean
    ): Promise<RequestRaceProbe> {
        return this.service.probeResponseTimeoutRace(responseFirst);
    }

    public probeRemoteErrorTimeoutRace(
        errorFirst: boolean
    ): Promise<RequestRaceProbe> {
        return this.service.probeRemoteErrorTimeoutRace(errorFirst);
    }

    public probeResponseRemoteErrorRace(
        responseFirst: boolean
    ): Promise<RequestRaceProbe> {
        return this.service.probeResponseRemoteErrorRace(responseFirst);
    }

    public probeResponseDisconnectRace(
        responseFirst: boolean
    ): Promise<RequestRaceProbe> {
        return this.service.probeResponseDisconnectRace(responseFirst);
    }

    public probeRemoteErrorDisconnectRace(
        errorFirst: boolean
    ): Promise<RequestRaceProbe> {
        return this.service.probeRemoteErrorDisconnectRace(errorFirst);
    }

    public probeTimeoutDisconnectRace(
        timeoutFirst: boolean
    ): Promise<RequestRaceProbe> {
        return this.service.probeTimeoutDisconnectRace(timeoutFirst);
    }

    public probeConcurrentSettlement(): Promise<ConcurrentSettlementProbe> {
        return this.service.probeConcurrentSettlement();
    }

    public probeDisposal(): Promise<DisposalProbe> {
        return this.service.probeDisposal();
    }

    public probeDisconnectCleanup(
        address: string
    ): Promise<DisconnectCleanupProbe> {
        return this.service.probeDisconnectCleanup(address);
    }

    public probeTransportRetirement(
        address: string
    ): Promise<TransportRetirementProbe> {
        return this.service.probeTransportRetirement(address);
    }

    public probeBulkPenalty(
        firstAddress: string,
        secondAddress: string
    ): BulkPenaltyProbe {
        return this.service.probeBulkPenalty(firstAddress, secondAddress);
    }

    public probeConnectedPeerFallback(
        address: string
    ): ConnectedPeerFallbackProbe {
        return this.service.probeConnectedPeerFallback(address);
    }

    public probeForeignResponse(
        intendedAddress: string,
        foreignAddress: string
    ): Promise<ForeignResponseProbe> {
        return this.service.probeForeignResponse(
            intendedAddress,
            foreignAddress
        );
    }

    public probeRequestRegistry(
        address: string
    ): Promise<RequestRegistryProbe> {
        return this.service.probeRequestRegistry(address);
    }

    public probeLifecycle(
        firstAddress: string,
        secondAddress: string,
        missingAddress: string
    ): Promise<LifecycleProbe> {
        return this.service.probeLifecycle(
            firstAddress,
            secondAddress,
            missingAddress
        );
    }

    public probeUnauthenticatedBlacklist(): BanPolicyProbe {
        return this.service.probeUnauthenticatedBlacklist();
    }

    public probeUnauthenticatedClose(): BanPolicyProbe {
        return this.service.probeUnauthenticatedClose();
    }

    public probeUpgradeBanPolicy(address: string): UpgradeBanPolicyProbe {
        return this.service.probeUpgradeBanPolicy(address);
    }

    public probeExplicitBlacklist(address: string): BanPolicyProbe {
        return this.service.probeExplicitBlacklist(address);
    }

    public probeHealthyWebRtcRejectsHolepunch(
        address: string
    ): Promise<RelayAdmissionProbe> {
        return this.service.probeHealthyWebRtcRejectsHolepunch(address);
    }

    public probeWebRtcCloseAcceptsHolepunch(
        address: string
    ): Promise<RelayAdmissionProbe> {
        return this.service.probeWebRtcCloseAcceptsHolepunch(address);
    }

    public probeBlacklistRejectsHolepunch(
        address: string
    ): Promise<RelayAdmissionProbe> {
        return this.service.probeBlacklistRejectsHolepunch(address);
    }

    public probeHolepunchJoinAndEqualLeave(): Promise<HolepunchTopicProbe> {
        return this.service.probeHolepunchJoinAndEqualLeave();
    }

    public probeHolepunchDuplicateLeave(): Promise<HolepunchTopicProbe> {
        return this.service.probeHolepunchDuplicateLeave();
    }

    public probeHolepunchAbsentLeave(): Promise<HolepunchTopicProbe> {
        return this.service.probeHolepunchAbsentLeave();
    }

    public probeHolepunchLeaveBeforeSwarm(): Promise<HolepunchTopicProbe> {
        return this.service.probeHolepunchLeaveBeforeSwarm();
    }

    public probeHolepunchRejoinAfterLeave(): Promise<HolepunchTopicProbe> {
        return this.service.probeHolepunchRejoinAfterLeave();
    }

    public probeHandshakeParticipantReadFailure(
        address: string
    ): Promise<HandshakeFailureProbe> {
        return this.service.probeHandshakeParticipantReadFailure(address);
    }

    public probeMissingHandshake(address: string): Promise<LateHandshakeProbe> {
        return this.service.probeMissingHandshake(address);
    }

    public probeClosedHandshake(address: string): Promise<LateHandshakeProbe> {
        return this.service.probeClosedHandshake(address);
    }

    public probeDisposedHandshake(
        address: string
    ): Promise<LateHandshakeProbe> {
        return this.service.probeDisposedHandshake(address);
    }

    public probeReplacementHandshake(
        address: string
    ): Promise<ReplacementHandshakeProbe> {
        return this.service.probeReplacementHandshake(address);
    }
}
