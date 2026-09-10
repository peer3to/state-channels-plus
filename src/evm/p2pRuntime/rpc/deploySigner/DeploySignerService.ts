import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { DeploySignerRpcMethods } from "./DeploySignerRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/** the host's local-VM deploy signer, as the setup-time bridge signer calls it */
export class DeploySignerService extends ARpcService<
    DeploySignerRpcMethods,
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    constructor(
        router: RpcRouter<P2pRuntimeHostRoot, any>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): DeploySignerRpcMethods {
        return new DeploySignerRpcMethods(transport, this);
    }
}

export default DeploySignerService;
