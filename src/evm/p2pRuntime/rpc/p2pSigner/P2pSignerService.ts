import type { P2pRuntimeHostRoot } from "../P2pRuntimeHostRoot";
import { P2pSignerRpcMethods } from "./P2pSignerRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/** the host-owned p2p signer, as the main thread's signer facade calls it */
export class P2pSignerService extends ARpcService<
    P2pSignerRpcMethods,
    RpcRouter<P2pRuntimeHostRoot, any>
> {
    /** the live host-side signer; throws until the runtime graph exists */
    get p2pSigner() {
        return this.router.localRpc.host.runtime().stateManager.p2pManager
            .p2pSigner;
    }

    createRPCMethods(transport: ATransport): P2pSignerRpcMethods {
        return new P2pSignerRpcMethods(transport, this);
    }
}

export default P2pSignerService;
