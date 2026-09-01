import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { ChainSignerRpcMethods } from "./ChainSignerRpcMethods";

/** the host's managed real-chain signer, as the main thread's chain signer calls it */
export class ChainSignerService extends ARpcService<
    ChainSignerRpcMethods,
    PortRpcRouter<P2pRuntimeHostRoot>
> {
    constructor(
        router: PortRpcRouter<P2pRuntimeHostRoot>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): ChainSignerRpcMethods {
        return new ChainSignerRpcMethods(transport, this);
    }
}

export default ChainSignerService;
