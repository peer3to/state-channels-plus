// @spec-test-coverage-ignore: guarded probe endpoint for LocalOnlyGuard tests
import type { LocalOnlyGuardTargetService } from "./LocalOnlyGuardTargetService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class LocalOnlyGuardTargetRpcMethods extends ANetworkRpcMethods<LocalOnlyGuardTargetService> {
    constructor(
        transport: NetworkTransport,
        service: LocalOnlyGuardTargetService
    ) {
        super(transport, service);
    }

    public record(value: string): string {
        this.service.invocations.push(value);
        return value;
    }

    /** One-way twin of `record`, for notification delivery. */
    public notify(value: string): void {
        this.service.invocations.push(value);
    }

    public getInvocations(): string[] {
        return [...this.service.invocations];
    }
}
