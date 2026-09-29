// @spec-test-coverage-ignore: guard-chain probe endpoint for LocalOnlyGuard tests
import type { LocalOnlyGuardChainTargetService } from "./LocalOnlyGuardChainTargetService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class LocalOnlyGuardChainTargetRpcMethods extends ANetworkRpcMethods<LocalOnlyGuardChainTargetService> {
    constructor(
        transport: NetworkTransport,
        service: LocalOnlyGuardChainTargetService
    ) {
        super(transport, service);
    }

    /** The earlier guard passes this endpoint; the local-only guard decides. */
    public passEarlierGuard(value: string): string {
        this.service.invocations.push(value);
        return value;
    }

    /** The earlier guard rejects this endpoint before the local-only guard runs. */
    public failEarlierGuard(value: string): string {
        this.service.invocations.push(value);
        return value;
    }
}
