import { ATransport } from "@/transport";
import type P2PManager from "@/P2PManager";
import type { RpcRouterLike } from "./ARpcRouter";

abstract class ARpcMethods<TRouter extends RpcRouterLike = P2PManager> {
    senderTransport: ATransport;
    /** what dispatched this call: the peer manager or a port router */
    readonly router: TRouter;
    constructor(transport: ATransport, router: TRouter) {
        this.senderTransport = transport;
        this.router = router;
    }

    /** the peer endpoints know their router as the manager; same object */
    get p2pManager(): TRouter {
        return this.router;
    }

    get remoteRpc(): TRouter["remoteRpc"] {
        return this.router.remoteRpc;
    }
}

export default ARpcMethods;
