import ANetworkRpcMethods from "./ANetworkRpcMethods";
import Rpc, { RPC_GUARD_REJECTION_ERROR } from "../Rpc";
import type { RpcResponse } from "../Rpc";
import {
    resolveRpcEndpoint,
    sendRpcResponseSafely,
    invokeRpcEndpoint
} from "../RpcDispatch";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import type P2PManager from "@/P2PManager";
import type { AGuard } from "@/rpc/network/guards/AGuard";
import { runGuards } from "@/rpc/network/guards/runGuards";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import type NetworkTransport from "@/transport/NetworkTransport";
import { Logger } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";

abstract class ANetworkRpcService<
    R extends ANetworkRpcMethods<ANetworkRpcService<any, TP2PManager>>,
    TP2PManager extends P2PManager = P2PManager
> {
    logger: Logger;
    protected guards: AGuard[] = [];

    constructor(
        public readonly router: NetworkRpcRouter<TP2PManager>,
        logger: Logger
    ) {
        this.logger = logger;
    }

    public get p2pManager(): TP2PManager {
        return this.router.p2pManager;
    }

    public abstract createRPCMethods(transport: NetworkTransport): R;

    private sendRpcResponseSafely(
        rpc: Rpc,
        response: RpcResponse,
        transport: NetworkTransport
    ): void {
        const responseTransport = transport.peerAddress
            ? (this.p2pManager.profileManager.getTransportByEvmAddress(
                  transport.peerAddress
              ) ?? transport)
            : transport;
        sendRpcResponseSafely(
            response,
            (prepared) => {
                responseTransport.sendRpcResponse(prepared);
            },
            (e) => {
                this.logger.error("Failed to send RPC response", {
                    method: rpc.method,
                    error: errorMessage(e),
                    stack: e instanceof Error ? e.stack : undefined
                });
                this.p2pManager.disconnectConnection(
                    responseTransport,
                    DisconnectPolicy.ALLOW
                );
            }
        );
    }

    async runRPC(rpc: Rpc, transport: NetworkTransport): Promise<boolean> {
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
        const endpoint = resolveRpcEndpoint(
            rpcMethods,
            rpc.method,
            ANetworkRpcMethods.prototype
        );
        if (!endpoint) return false;

        return invokeRpcEndpoint(rpc, rpcMethods, endpoint, {
            prepareError: (error) => {
                this.logger.error("Unhandled async RPC request exception", {
                    method: rpc.method,
                    error: errorMessage(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
                return errorMessage(error);
            },
            reply: (response) =>
                this.sendRpcResponseSafely(rpc, response, transport),
            onAsyncSendError: (error) => {
                this.logger.error("Unhandled async RPC handler exception", {
                    method: rpc.method,
                    error: errorMessage(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
                this.p2pManager.disconnectConnection(
                    transport,
                    DisconnectPolicy.ALLOW
                );
            },
            onSyncSendError: (error) => {
                this.logger.error("Unhandled RPC handler exception", {
                    method: rpc.method,
                    error: errorMessage(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
        });
    }

    get remoteRpc(): TP2PManager["remoteRpc"] {
        return this.p2pManager.remoteRpc;
    }
}

export default ANetworkRpcService;
