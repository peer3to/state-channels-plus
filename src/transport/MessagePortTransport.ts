import type { RpcRouterLike } from "@/rpc/ARpcRouter";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import ATransport from "./ATransport";
import type { RuntimePort } from "./RuntimePort";
import { TransportType } from "./TransportType";

/**
 * a worker port as a transport. trusted: the far end is this process's own
 * thread. frames cross as objects (structured clone), never as JSON - bus
 * events carry bigints and executor results carry byte arrays.
 */
class MessagePortTransport extends ATransport {
    transportType = TransportType.MESSAGE_PORT;
    private readonly port: RuntimePort;

    constructor(port: RuntimePort, router: RpcRouterLike) {
        super(router);
        this.port = port;
        port.onMessage((frame) => this.onMessage(frame));
        port.onClose(() => this.close(false));
        port.start();
    }

    get isTrusted(): boolean {
        return true;
    }

    send(rpc: Rpc): void {
        this.port.post(rpc);
    }

    sendRpcResponse(response: RpcResponse): void {
        this.port.post(response);
    }

    // the base serializes before calling this; both senders above bypass it
    _send(serializedRPC: string): void {
        this.port.post(serializedRPC);
    }

    onMessage(frame: unknown): void {
        this.router.onRpcFrame(frame as Rpc | RpcResponse, this);
    }

    protected _close(): void {
        this.port.close();
    }
}

export default MessagePortTransport;
