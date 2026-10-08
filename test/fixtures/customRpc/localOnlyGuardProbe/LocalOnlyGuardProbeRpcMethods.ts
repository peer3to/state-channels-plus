// @spec-test-coverage-ignore: host-side LocalOnlyGuard probe endpoints
import type {
    LocalOnlyGuardProbeService,
    LocalOnlyObservation
} from "./LocalOnlyGuardProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class LocalOnlyGuardProbeRpcMethods extends ANetworkRpcMethods<LocalOnlyGuardProbeService> {
    constructor(
        transport: NetworkTransport,
        service: LocalOnlyGuardProbeService
    ) {
        super(transport, service);
    }

    public startObservation(): boolean {
        this.service.startObservation();
        return true;
    }

    public readObservation(): LocalOnlyObservation {
        return this.service.readObservation();
    }

    public restoreObservation(): boolean {
        this.service.restoreObservation();
        return true;
    }

    public sendOverCapturedHandshakeTransport(
        value: string,
        timeoutMs: number
    ): Promise<string> {
        return this.service.sendOverCapturedHandshakeTransport(
            value,
            timeoutMs
        );
    }

    public isCapturedHandshakeTransportClosed(): boolean {
        return this.service.isCapturedHandshakeTransportClosed();
    }
}
