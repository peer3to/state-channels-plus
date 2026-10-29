import type ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * A guard runs before an RPC is consumed.
 *
 * `check` returns `true` to continue chaining; `false` aborts chaining.
 * `onFailure` is invoked on the first failing guard.
 *
 * Both functions share the same signature as `ANetworkRpcService.runRPC`, so guards
 * can retry by calling `service.runRPC(rpc, transport)` if desired.
 */
export abstract class AGuard<
    S extends
        ANetworkRpcService<ANetworkRpcMethods> = ANetworkRpcService<ANetworkRpcMethods>
> {
    constructor(protected readonly service: S) {}

    abstract check(rpc: Rpc, transport: NetworkTransport): boolean;

    abstract onFailure(rpc: Rpc, transport: NetworkTransport): void;

    suppressesFailureResponse(
        _rpc: Rpc,
        _transport: NetworkTransport
    ): boolean {
        return false;
    }
}
