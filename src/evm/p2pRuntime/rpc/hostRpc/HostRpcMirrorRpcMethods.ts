import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import type { HostRpcMirrorService } from "./HostRpcMirrorService";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

export class HostRpcMirrorRpcMethods extends ARpcMethods<
    RpcRouter<P2pRuntimeHostRoot, any>
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
