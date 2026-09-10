import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { HostRpcMirrorRpcMethods } from "./HostRpcMirrorRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/**
 * the host's peer RPC, mirrored to the main thread. the peer services live on
 * the P2PManager router, not on this port's root, so a call from the main
 * thread is replayed on the host's `remoteRpc` rather than dispatched here.
 */
export class HostRpcMirrorService extends ARpcService<
    HostRpcMirrorRpcMethods,
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    constructor(
        router: RpcRouter<P2pRuntimeHostRoot, any>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): HostRpcMirrorRpcMethods {
        return new HostRpcMirrorRpcMethods(transport, this);
    }
}

export default HostRpcMirrorService;
