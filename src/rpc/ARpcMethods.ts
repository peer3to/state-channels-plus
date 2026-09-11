import type { RpcRouter } from "./RpcRouter";
import type P2PManager from "@/P2PManager";
import { ATransport } from "@/transport";

abstract class ARpcMethods<TRouter extends RpcRouter<any, any> = P2PManager> {
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

    /** the root this end serves: where a service's collaborators live */
    get localRpc(): TRouter["localRpc"] {
        return this.router.localRpc;
    }

    get remoteRpc(): TRouter["remoteRpc"] {
        return this.router.remoteRpc;
    }
}

export default ARpcMethods;
