import ATransport from "./ATransport";
import type { RuntimePort } from "./RuntimePort";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type { RpcResponse } from "@/rpc/Rpc";
import type Rpc from "@/rpc/Rpc";

export default class InternalTransport extends ATransport {
    private closedReason = new Error("Runtime connection is closed");
    private readonly unsubscribeMessage: () => void;
    private readonly unsubscribeClose: () => void;

    constructor(
        public readonly router: InternalRpcRouter,
        private readonly port: RuntimePort
    ) {
        super();
        this.unsubscribeMessage = port.onMessage((message) =>
            this.onMessage(message)
        );
        this.unsubscribeClose = port.onClose(() => this.close());
        port.start();
    }

    public onMessage(message: unknown): void {
        // Port callbacks do not await handlers; each RPC progresses independently.
        void this.router
            .onMessage(message, this)
            .catch((error) => this.router.rpcRoot.reportError(error));
    }

    public send(rpc: Rpc, transfer?: unknown[]): void {
        // Fast-fail after a fatal worker failure: a post to a dead worker is
        // silently dropped, so the request would never settle.
        if (this.isClosed) throw this.closedReason;
        // Internal RPC can transfer live MessagePorts and WebRTC channels; JSON cannot preserve them.
        this.port.post(rpc, transfer);
    }

    public sendRpcResponse(response: RpcResponse<unknown>): void {
        if (this.isClosed) throw this.closedReason;
        this.port.post(response);
    }

    public closeWithReason(reason: Error): void {
        this.closedReason = reason;
        this.close(true);
    }

    protected afterClose(_isExpected: boolean): void {
        this.unsubscribeMessage();
        this.unsubscribeClose();
        this.router.rejectPendingRpcRequestsForTransport(
            this,
            this.closedReason
        );
        this.port.close();
    }
}
