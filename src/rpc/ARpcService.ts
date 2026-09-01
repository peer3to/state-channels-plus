import Rpc from "./Rpc";
import type ATransport from "@/transport/ATransport";
import ARpcMethods from "./ARpcMethods";
import type P2PManager from "@/P2PManager";
import { Logger } from "@/utils";
import type { AGuard } from "@/rpc/guards/AGuard";
import { runGuards } from "@/rpc/guards/runGuards";
import type { RpcResponse } from "./Rpc";
import type { RpcRouterLike } from "./ARpcRouter";
import { serializeError } from "./serializeError";

type RpcEndpoint = (...params: Rpc["params"]) => unknown;

function resolveRpcEndpoint(
    rpcMethods: ARpcMethods<any>,
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
    R extends ARpcMethods<TRouter>,
    TRouter extends RpcRouterLike = P2PManager
> {
    /** what dispatches to this service: the peer manager or a port router */
    readonly router: TRouter;
    logger: Logger;
    protected guards: AGuard[] = [];

    constructor(router: TRouter, logger: Logger) {
        this.router = router;
        this.logger = logger;
    }

    /** the peer services know their router as the manager; same object */
    get p2pManager(): TRouter {
        return this.router;
    }

    public abstract createRPCMethods(transport: ATransport): R;

    private sendRpcResponseSafely(
        rpc: Rpc,
        response: RpcResponse,
        transport: ATransport
    ): void {
        try {
            transport.sendRpcResponse(response);
        } catch (e: unknown) {
            this.logger.error("Failed to send RPC response", {
                method: rpc.method,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined
            });
            this.router.onServiceFailure(transport, e);
        }
    }

    runRPC(rpc: Rpc, transport: ATransport): boolean {
        if (this.guards.length && !transport.isTrusted) {
            const guardsPassed = runGuards(this.guards, rpc, transport);
            if (!guardsPassed) {
                // Guard failure means we consumed the rpc but refused to process it.
                if (rpc.requestId !== undefined) {
                    this.sendRpcResponseSafely(
                        rpc,
                        {
                            rpcResponse: true,
                            requestId: rpc.requestId,
                            ok: false,
                            error: "RPC request rejected by guard"
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
                    // a stranger learns the message; our own thread the
                    // whole error, so it can classify what happened
                    response = {
                        rpcResponse: true,
                        requestId,
                        ok: false,
                        error: transport.isTrusted
                            ? serializeError(e)
                            : e instanceof Error
                              ? e.message
                              : String(e)
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
                this.router.onServiceFailure(transport, e);
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

    get remoteRpc(): TRouter["remoteRpc"] {
        return this.router.remoteRpc;
    }
}

export default ARpcService;
