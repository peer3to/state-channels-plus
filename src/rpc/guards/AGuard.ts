import type Rpc from "@/rpc/Rpc";
import type ATransport from "@/transport/ATransport";
import type ARpcService from "@/rpc/ARpcService";
import type ARpcMethods from "@/rpc/ARpcMethods";

/**
 * A guard runs before an RPC is consumed.
 *
 * `check` returns `true` to continue chaining; `false` aborts chaining.
 * `onFailure` is invoked on the first failing guard.
 *
 * Both functions share the same signature as `ARpcService.runRPC`, so guards
 * can retry by calling `service.runRPC(rpc, transport)` if desired.
 */
export abstract class AGuard<
    S extends ARpcService<ARpcMethods> = ARpcService<ARpcMethods>
> {
    constructor(protected readonly service: S) {}

    abstract check(rpc: Rpc, transport: ATransport): boolean;

    abstract onFailure(rpc: Rpc, transport: ATransport): void;
}
