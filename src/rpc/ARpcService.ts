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
        if (this.guards.length && !transport.isTrusted) {
            const guardsPassed = runGuards(this.guards, rpc, transport);
            if (!guardsPassed) {
                // Guard failure means we consumed the rpc but refused to process it.
                if (rpc.requestId) {
                    transport.sendRpcResponse({
                        rpcResponse: true,
                        requestId: rpc.requestId,
                        ok: false,
                        error: "RPC request rejected by guard"
                    });
                }
                return true;
            }
        }
        const rpc_method = this.createRPCMethods(transport);
        if (!hasMethod(rpc_method, rpc.method)) return false;

        // Request/response: run the handler, then reply with its (awaited) value.
        // Handler errors are reported back to the caller (so its promise rejects)
        // instead of dropping the connection.
        if (rpc.requestId) {
            const requestId = rpc.requestId;
            void (async () => {
                try {
                    const result = await rpc_method[rpc.method](...rpc.params);
                    transport.sendRpcResponse({
                        rpcResponse: true,
                        requestId,
                        ok: true,
                        result
                    });
                } catch (e: unknown) {
                    this.logger.error("Unhandled async RPC request exception", {
                        method: rpc.method,
                        error: e instanceof Error ? e.message : String(e),
                        stack: e instanceof Error ? e.stack : undefined
                    });
                    transport.sendRpcResponse({
                        rpcResponse: true,
                        requestId,
                        ok: false,
                        error: e instanceof Error ? e.message : String(e)
                    });
                }
            })();
            return true;
        }

        try {
            void Promise.resolve(rpc_method[rpc.method](...rpc.params)).catch(
                (e: unknown) => {
                    this.logger.error("Unhandled async RPC handler exception", {
                        method: rpc.method,
                        error: e instanceof Error ? e.message : String(e),
                        stack: e instanceof Error ? e.stack : undefined
                    });
                    this.p2pManager.disconnectConnection(transport);
                }
            );
        } catch (e) {
            this.logger.error("Unhandled RPC handler exception", {
                method: rpc.method,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined
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
