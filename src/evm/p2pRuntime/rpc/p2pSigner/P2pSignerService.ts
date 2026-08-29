import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { P2pSignerRpcMethods } from "./P2pSignerRpcMethods";

/** the host-owned p2p signer, as the main thread's signer facade calls it */
export class P2pSignerService extends ARpcService<
    P2pSignerRpcMethods,
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        router: PortRpcRouter<P2pRuntimeHostRoot>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): P2pSignerRpcMethods {
        return new P2pSignerRpcMethods(transport, this);
    }
}

export default P2pSignerService;
