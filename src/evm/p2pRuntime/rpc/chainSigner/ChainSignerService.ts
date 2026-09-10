import type { P2pRuntimeHostRoot, RuntimeHost } from "../P2pRuntimeHostRoot";
import { ChainSignerRpcMethods } from "./ChainSignerRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/** the host's managed real-chain signer, as the main thread's chain signer calls it */
export class ChainSignerService extends ARpcService<
    ChainSignerRpcMethods,
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    constructor(
        router: RpcRouter<P2pRuntimeHostRoot, any>,
        readonly host: RuntimeHost
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): ChainSignerRpcMethods {
        return new ChainSignerRpcMethods(transport, this);
    }
}

export default ChainSignerService;
