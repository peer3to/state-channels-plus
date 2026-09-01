import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { HostRpcMirrorService } from "./HostRpcMirrorService";

export class HostRpcMirrorRpcMethods extends ARpcMethods<
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: HostRpcMirrorService
    ) {
        super(transport, service.router);
    }

    /**
     * Replays a `hostRpc.<service>.<method>(...params).<delivery>(...args)`
     * call mirrored from the client onto the host's live `remoteRpc` and awaits
     * the result. The port is a pure proxy; all target semantics (omitted
     * target = loopback to self, peer address = relay) are handled by the RPC
     * handler.
     */
    async call(
        service: string,
        method: string,
        params: unknown[],
        delivery: string,
        args: unknown[]
    ): Promise<unknown> {
        const p2pManager = this.service.host.runtime().stateManager.p2pManager;
        const remoteService = (p2pManager.remoteRpc as any)[service];
        return await remoteService[method](...params)[delivery](...args);
    }
}

export default HostRpcMirrorRpcMethods;
