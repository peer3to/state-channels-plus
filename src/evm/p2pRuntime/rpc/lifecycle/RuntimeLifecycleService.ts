import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { RuntimeLifecycleRpcMethods } from "./RuntimeLifecycleRpcMethods";

/** the host's life: build it once the deploys are in, drain it, end it */
export class RuntimeLifecycleService extends ARpcService<
    RuntimeLifecycleRpcMethods,
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        router: PortRpcRouter<P2pRuntimeHostRoot>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): RuntimeLifecycleRpcMethods {
        return new RuntimeLifecycleRpcMethods(transport, this);
    }
}

export default RuntimeLifecycleService;
