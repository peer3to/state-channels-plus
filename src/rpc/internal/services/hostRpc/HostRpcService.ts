import { HostRpcRpcMethods } from "./HostRpcRpcMethods";
import type P2PManager from "@/P2PManager";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import { hasRpcService } from "@/utils/ObjectChecks";

export class HostRpcService extends AInternalRpcService<HostRpcRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly requireManager: () => P2PManager
    ) {
        super(router);
    }

    public createRPCMethods(sender: InternalTransport) {
        return new HostRpcRpcMethods(this, sender);
    }

    /**
     * Replays a `hostRpc.<service>.<method>(...params).<delivery>(...args)` call
     * mirrored from the client onto the host's live `remoteRpc` and awaits the
     * result. The port is a pure proxy; all target semantics (omitted target =
     * loopback to self, peer address = relay) are handled by the RPC handler.
     */
    public async invoke(
        service: string,
        method: string,
        params: unknown[],
        delivery: string,
        args: unknown[]
    ) {
        const manager = this.requireManager();
        if (!hasRpcService(manager.localRpc, service))
            throw new Error(`Unknown network RPC service '${service}'`);
        if (
            delivery !== "request" &&
            delivery !== "sendOne" &&
            delivery !== "sendMultiple" &&
            delivery !== "broadcast"
        )
            throw new Error(`Unknown network RPC delivery '${delivery}'`);
        const proxy = Reflect.get(manager.remoteRpc, service);
        return await proxy[method](...params)[delivery](...args);
    }
}
