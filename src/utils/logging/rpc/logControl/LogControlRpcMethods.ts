import type { LogControlService } from "./LogControlService";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { LogFlushResult } from "@/utils/logging/LogFlushBus";
import type { SharedLoggerContext } from "@/utils/logging/Logger";

export class LogControlRpcMethods extends ARpcMethods<RpcRouter<any, any>> {
    /** log control only ever runs over a worker link */
    declare senderTransport: MessagePortTransport;

    constructor(
        transport: MessagePortTransport,
        private readonly service: LogControlService
    ) {
        super(transport, service.router);
    }

    /** upload every store reachable from this realm but the asker's side, and
     *  answer with the totals - the reply is the ack */
    flush(reason: string): Promise<LogFlushResult> {
        return this.service.bus.receiveFlush(reason, this.senderTransport);
    }

    /** the far realm's channel or identity changed */
    contextUpdate(context: SharedLoggerContext): void {
        this.service.bus.applyInboundContext(this.senderTransport, context);
    }
}

export default LogControlRpcMethods;
