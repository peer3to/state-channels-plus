import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { DeploySignerRpcMethods } from "./DeploySignerRpcMethods";

/** the host's local-VM deploy signer, as the setup-time bridge signer calls it */
export class DeploySignerService extends ARpcService<
    DeploySignerRpcMethods,
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        router: PortRpcRouter<P2pRuntimeHostRoot>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): DeploySignerRpcMethods {
        return new DeploySignerRpcMethods(transport, this);
    }
}

export default DeploySignerService;
