// @spec-test-coverage-ignore: loopback endpoints for HandshakeCompletedGuard component tests
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { PingPongRpc } from "../PingPongRpcManifest";
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
    TimeoutGuardProbe
} from "./HandshakeCompletedGuardProbeService";

export class HandshakeCompletedGuardProbeRpcMethods extends ARpcMethods<
    P2PManager<PingPongRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: HandshakeCompletedGuardProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public probeCompleted(): Promise<CompletedGuardProbe> {
        return this.service.probeCompleted();
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
