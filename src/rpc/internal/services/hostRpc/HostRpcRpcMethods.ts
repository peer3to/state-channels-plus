import type { HostRpcService } from "./HostRpcService";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class HostRpcRpcMethods extends AInternalRpcMethods<HostRpcService> {
    /**
     * Mirrors a `hostRpc.<service>.<method>(...params).<delivery>(...args)` call
     * invoked from the client. The port is a pure proxy: the host replays the exact
     * same chained call on its live `remoteRpc` and (for `request`) awaits and
     * returns the result. Target semantics are the host's: an omitted target runs
     * the method on the host itself (loopback); a peer address relays it.
     *
     * `delivery` is whatever method the caller invoked on the RPC handle (e.g.
     * `request`/`sendOne`/`broadcast`); it is forwarded verbatim so new handler
     * methods need no changes here.
     */
    public invoke(
        service: string,
        method: string,
        params: unknown[],
        delivery: string,
        args: unknown[]
    ) {
        return this.service.invoke(service, method, params, delivery, args);
    }
}
