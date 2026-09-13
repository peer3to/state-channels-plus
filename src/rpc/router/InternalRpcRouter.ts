import { ARpcRouter } from "./ARpcRouter";
import { isRpc, isRpcResponse } from "../Rpc";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import {
    deserializeError,
    type SerializedError
} from "@/rpc/internal/errorWire";
import type InternalTransport from "@/transport/InternalTransport";

export class InternalRpcRouter extends ARpcRouter<InternalTransport> {
    constructor(
        public readonly rpcRoot: AInternalRpcRoot,
        protected readonly defaultRequestTimeoutMs: number | null
    ) {
        super();
    }

    // Overrides ARpcRouter.restoreRpcError: internal peers use the shared error codec.
    protected override restoreRpcError(error: unknown): Error {
        return typeof error === "string"
            ? new Error(error)
            : deserializeError(error as SerializedError);
    }

    protected admitRpcResponse(
        sender: InternalTransport,
        expected: InternalTransport
    ): boolean {
        return sender === expected;
    }

    public async onMessage(
        message: unknown,
        sender: InternalTransport
    ): Promise<void> {
        if (sender.isClosed) return;
        if (isRpcResponse(message)) {
            this.handleRpcResponse(message, sender);
            return;
        }
        if (!isRpc(message)) {
            if (
                message &&
                typeof message === "object" &&
                "service" in message &&
                typeof message.service === "string" &&
                "method" in message &&
                typeof message.method === "string" &&
                "requestId" in message &&
                typeof message.requestId === "string" &&
                !("rpcResponse" in message)
            ) {
                sender.sendRpcResponse({
                    rpcResponse: true,
                    requestId: message.requestId,
                    ok: false,
                    error: "Malformed RPC request"
                });
            }
            return;
        }
        if (await this.dispatchRpc(message, sender)) return;
        if (message.requestId !== undefined) {
            sender.sendRpcResponse({
                rpcResponse: true,
                requestId: message.requestId,
                ok: false,
                error: `Unknown RPC endpoint '${message.service}.${message.method}'`
            });
        }
    }
}
