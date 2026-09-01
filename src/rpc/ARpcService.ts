import Rpc from "./Rpc";
import type ATransport from "@/transport/ATransport";
import ARpcMethods from "./ARpcMethods";
import type P2PManager from "@/P2PManager";
import { Logger } from "@/utils";
import type { AGuard } from "@/rpc/guards/AGuard";
import { runGuards } from "@/rpc/guards/runGuards";
import type { RpcResponse } from "./Rpc";
import { RPC_GUARD_REJECTION_ERROR } from "./Rpc";

type RpcEndpoint = (...params: Rpc["params"]) => unknown;

function resolveRpcEndpoint(
    rpcMethods: ARpcMethods,
    methodName: string
): RpcEndpoint | undefined {
    if (methodName === "constructor") return undefined;

    let owner: object | null = rpcMethods;
    while (
        owner &&
        owner !== ARpcMethods.prototype &&
        owner !== Object.prototype
    ) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, methodName);
        if (descriptor) {
            return typeof descriptor.value === "function"
                ? descriptor.value
                : undefined;
        }
        owner = Object.getPrototypeOf(owner);
    }
    return undefined;
}

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

    private sendRpcResponseSafely(
        rpc: Rpc,
        response: RpcResponse,
        transport: ATransport
    ): void {
        const responseTransport = transport.peerAddress
            ? (this.p2pManager.profileManager.getTransportByEvmAddress(
                  transport.peerAddress
              ) ?? transport)
            : transport;
        try {
            responseTransport.sendRpcResponse(response);
        } catch (e: unknown) {
            this.logger.error("Failed to send RPC response", {
                method: rpc.method,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined
            });
            this.p2pManager.disconnectConnection(responseTransport);
        }
    }

    runRPC(rpc: Rpc, transport: ATransport): boolean {
        if (this.guards.length && !transport.isTrusted) {
            const guardsPassed = runGuards(this.guards, rpc, transport);
            if (!guardsPassed) {
                // Guard failure means we consumed the rpc but refused to process it.
                const suppressResponse = this.guards.some((guard) =>
                    guard.suppressesFailureResponse(rpc, transport)
                );
                if (rpc.requestId !== undefined && !suppressResponse) {
                    this.sendRpcResponseSafely(
                        rpc,
                        {
                            rpcResponse: true,
                            requestId: rpc.requestId,
                            ok: false,
                            error: RPC_GUARD_REJECTION_ERROR
                        },
                        transport
                    );
                }
                return true;
            }
        }
        const rpcMethods = this.createRPCMethods(transport);
        const endpoint = resolveRpcEndpoint(rpcMethods, rpc.method);
        if (!endpoint) return false;

        // Request/response: run the handler, then reply with its (awaited) value.
        // Handler errors are reported back to the caller (so its promise rejects)
        // instead of dropping the connection.
        if (rpc.requestId !== undefined) {
            const requestId = rpc.requestId;
            void (async () => {
                let response: RpcResponse;
                try {
                    const result = await Reflect.apply(
                        endpoint,
                        rpcMethods,
                        rpc.params
                    );
                    response = {
                        rpcResponse: true,
                        requestId,
                        ok: true,
                        result
                    };
                } catch (e: unknown) {
                    this.logger.error("Unhandled async RPC request exception", {
                        method: rpc.method,
                        error: e instanceof Error ? e.message : String(e),
                        stack: e instanceof Error ? e.stack : undefined
                    });
                    response = {
                        rpcResponse: true,
                        requestId,
                        ok: false,
                        error: e instanceof Error ? e.message : String(e)
                    };
                }
                this.sendRpcResponseSafely(rpc, response, transport);
            })();
            return true;
        }

        try {
            void Promise.resolve(
                Reflect.apply(endpoint, rpcMethods, rpc.params)
            ).catch((e: unknown) => {
                this.logger.error("Unhandled async RPC handler exception", {
                    method: rpc.method,
                    error: e instanceof Error ? e.message : String(e),
                    stack: e instanceof Error ? e.stack : undefined
                });
                this.p2pManager.disconnectConnection(transport);
            });
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
