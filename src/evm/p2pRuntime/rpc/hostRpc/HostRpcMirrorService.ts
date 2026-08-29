import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { HostRpcMirrorRpcMethods } from "./HostRpcMirrorRpcMethods";

/**
 * the host's peer RPC, mirrored to the main thread. the peer services live on
 * the P2PManager router, not on this port's root, so a call from the main
 * thread is replayed on the host's `remoteRpc` rather than dispatched here.
 */
export class HostRpcMirrorService extends ARpcService<
    HostRpcMirrorRpcMethods,
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        router: PortRpcRouter<P2pRuntimeHostRoot>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): HostRpcMirrorRpcMethods {
        return new HostRpcMirrorRpcMethods(transport, this);
    }
}

export default HostRpcMirrorService;
