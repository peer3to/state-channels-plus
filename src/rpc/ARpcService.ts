import Rpc from "./Rpc";
import { ATransport } from "@/transport";
import ARpcMethods from "./ARpcMethods";
import { hasMethod } from "@/utils/ObjectChecks";
import P2PManager from "@/P2PManager";
import { Logger } from "@/utils";

abstract class ARpcService<R extends ARpcMethods> {
    p2pManager: P2PManager;
    logger: Logger;

    constructor(p2pManager: P2PManager, logger: Logger) {
        this.p2pManager = p2pManager;
        this.logger = logger;
    }

    public abstract createRPCMethods(transport: ATransport): R;

    runRPC(rpc: Rpc, transport: ATransport): boolean {
        const rpc_method = this.createRPCMethods(transport);
        if (!hasMethod(rpc_method, rpc.method)) return false;
        try {
            rpc_method[rpc.method](...rpc.params);
        } catch (e) {
            console.log(e);
            return false;
        }
        return true;
    }

    get remoteRpc() {
        return this.p2pManager.remoteRpc;
    }
}

export default ARpcService;
