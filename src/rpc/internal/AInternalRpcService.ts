import { AInternalRpcMethods } from "./AInternalRpcMethods";
import type { InternalRpcRouter } from "../router/InternalRpcRouter";
import type Rpc from "../Rpc";
import {
    resolveRpcEndpoint,
    sendRpcResponseSafely,
    invokeRpcEndpoint
} from "../RpcDispatch";
import { serializeError } from "@/rpc/internal/errorWire";
import type InternalTransport from "@/transport/InternalTransport";

export abstract class AInternalRpcService<TMethods extends object> {
    constructor(public readonly router: InternalRpcRouter) {}

    public abstract createRPCMethods(sender: InternalTransport): TMethods;

    protected prepareError(error: unknown): unknown {
        return serializeError(error);
    }

    protected responseSendFailed(error: unknown): void {
        // The transport reports uncaught dispatch failures to the owning root.
        throw error;
    }

    protected afterResponse(_rpc: Rpc, _sender: InternalTransport): void {}

    public async runRPC(rpc: Rpc, sender: InternalTransport): Promise<boolean> {
        const methods = this.createRPCMethods(sender);
        const endpoint = resolveRpcEndpoint(
            methods,
            rpc.method,
            AInternalRpcMethods.prototype
        );
        if (!endpoint) return false;
        const context = this.router.rpcRoot.handlerExecutionContext;
        return invokeRpcEndpoint(rpc, methods, endpoint, {
            // Stamp endpoint failures before the RPC boundary serializes them.
            invoke: context
                ? (operation) => context.runHandler(operation)
                : undefined,
            prepareError: (error) => this.prepareError(error),
            reply: (response) => {
                try {
                    sendRpcResponseSafely(
                        response,
                        (prepared) => sender.sendRpcResponse(prepared),
                        (error) => this.responseSendFailed(error)
                    );
                } finally {
                    // Disposal must finish even when the parent cannot receive its reply.
                    this.afterResponse(rpc, sender);
                }
            }
        });
    }
}
