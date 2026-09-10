import ATransport from "./ATransport";
import type { RuntimePort } from "./RuntimePort";
import { TransportType } from "./TransportType";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { Logger } from "@/utils/logging/Logger";

export type MessagePortTransportOptions = {
    /** which end of the worker tree the far realm sits on -> how much of its
     *  logging context this realm trusts */
    remoteRealm?: "parent" | "child";
    /** the root logger whose context crosses this link, once the log flush bus
     *  took the link. a worker sets it when its own logger exists. */
    ownerLogger?: Logger;
};

/**
 * a worker port as a transport. trusted: the far end is this process's own
 * thread. frames cross as objects (structured clone), never as JSON - bus
 * events carry bigints and executor results carry byte arrays.
 */
class MessagePortTransport extends ATransport {
    transportType = TransportType.MESSAGE_PORT;
    remoteRealm: "parent" | "child";
    ownerLogger?: Logger;
    private readonly port: RuntimePort;

    constructor(
        port: RuntimePort,
        router: RpcRouter<any, any>,
        options: MessagePortTransportOptions = {}
    ) {
        super(router);
        this.port = port;
        this.remoteRealm = options.remoteRealm ?? "child";
        this.ownerLogger = options.ownerLogger;
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
