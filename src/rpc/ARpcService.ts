import Rpc from "./Rpc";
import type ATransport from "@/transport/ATransport";
import ARpcMethods from "./ARpcMethods";
import { hasMethod } from "@/utils/ObjectChecks";
import type P2PManager from "@/P2PManager";
import { Logger } from "@/utils";
import type { AGuard } from "@/rpc/guards/AGuard";
import { runGuards } from "@/rpc/guards/runGuards";

abstract class ARpcService<
    R extends ARpcMethods<TP2PManager>,
    TP2PManager extends P2PManager = P2PManager
> {
    p2pManager: TP2PManager;
    logger: Logger;
    protected guards: AGuard[] = [];

    constructor(p2pManager: TP2PManager, logger: Logger) {
        this.p2pManager = p2pManager;
        this.logger = logger;
    }

    public abstract createRPCMethods(transport: ATransport): R;

    runRPC(rpc: Rpc, transport: ATransport): boolean {
        if (this.guards.length) {
            const guardsPassed = runGuards(this.guards, rpc, transport);
            if (!guardsPassed) {
                // Guard failure means we consumed the rpc but refused to process it.
                return true;
            }
        }
        const rpc_method = this.createRPCMethods(transport);
        if (!hasMethod(rpc_method, rpc.method)) return false;
        try {
            rpc_method[rpc.method](...rpc.params);
        } catch (e) {
            this.logger.error("Unhandled RPC handler exception", {
                method: rpc.method,
                error: e
            });
            return false;
        }
        return true;
    }

    get remoteRpc(): TP2PManager["remoteRpc"] {
        return this.p2pManager.remoteRpc;
    }
}

export default ARpcService;
