import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { RuntimeLifecycleRpcMethods } from "./RuntimeLifecycleRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/** the host's life: build it once the deploys are in, drain it, end it */
export class RuntimeLifecycleService extends ARpcService<
    RuntimeLifecycleRpcMethods,
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    constructor(
        router: RpcRouter<P2pRuntimeHostRoot, any>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): RuntimeLifecycleRpcMethods {
        return new RuntimeLifecycleRpcMethods(transport, this);
    }
}

export default RuntimeLifecycleService;
