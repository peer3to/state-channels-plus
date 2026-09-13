// @spec-test-coverage-ignore: loopback endpoints for HandshakeCompletedGuard component tests
import type {
    CompletedGuardProbe,
    AddresslessGuardProbe,
    CustomFailureGuardProbe,
    DisposedWaiterGuardProbe,
    HandshakeCompletedGuardProbeService,
    PunishmentGuardProbe,
    QueueIsolationGuardProbe,
    QueueGuardProbe,
    RequestGuardProbe,
    RetiredTransportGuardProbe,
    GraceOverlapGuardProbe,
    ExactTransportQueueGuardProbe,
    ClosedTransportDispatchGuardProbe,
    LateCompletionGuardProbe,
    TimeoutGuardProbe,
    DeferredAdmissionProbe
} from "./HandshakeCompletedGuardProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class HandshakeCompletedGuardProbeRpcMethods extends ANetworkRpcMethods<HandshakeCompletedGuardProbeService> {
    constructor(
        transport: NetworkTransport,
        service: HandshakeCompletedGuardProbeService
    ) {
        super(transport, service);
    }

    public probeCompleted(): Promise<CompletedGuardProbe> {
        return this.service.probeCompleted();
    }

    public probeDeferredAdmission(): Promise<DeferredAdmissionProbe> {
        return this.service.probeDeferredAdmission();
    }

    public probeQueueReplay(): Promise<QueueGuardProbe> {
        return this.service.probeQueueReplay();
    }

    public probeRequestDuringNegotiation(): Promise<RequestGuardProbe> {
        return this.service.probeRequestDuringNegotiation();
    }

    public probeNonNegotiatingPunishment(): Promise<PunishmentGuardProbe> {
        return this.service.probeNonNegotiatingPunishment();
    }

    public probeTimeoutAndFreshWaiter(): Promise<TimeoutGuardProbe> {
        return this.service.probeTimeoutAndFreshWaiter();
    }

    public probeQueueIsolation(): Promise<QueueIsolationGuardProbe> {
        return this.service.probeQueueIsolation();
    }

    public probeAddresslessFallback(): Promise<AddresslessGuardProbe> {
        return this.service.probeAddresslessFallback();
    }

    public probeCustomFailure(): Promise<CustomFailureGuardProbe> {
        return this.service.probeCustomFailure();
    }

    public probeRetiredTransportCompletion(): Promise<RetiredTransportGuardProbe> {
        return this.service.probeRetiredTransportCompletion();
    }

    public probeDisposedWaiter(
        completed: boolean
    ): Promise<DisposedWaiterGuardProbe> {
        return this.service.probeDisposedWaiter(completed);
    }

    public probeLateCompletionAfterTimeout(): Promise<LateCompletionGuardProbe> {
        return this.service.probeLateCompletionAfterTimeout();
    }

    public probeAuthenticatedGraceOverlap(): Promise<GraceOverlapGuardProbe> {
        return this.service.probeAuthenticatedGraceOverlap();
    }

    public probeExactTransportQueueOwnership(): Promise<ExactTransportQueueGuardProbe> {
        return this.service.probeExactTransportQueueOwnership();
    }

    public probeClosedTransportDispatch(): Promise<ClosedTransportDispatchGuardProbe> {
        return this.service.probeClosedTransportDispatch();
    }
}
