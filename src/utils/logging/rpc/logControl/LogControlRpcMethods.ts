import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouterLike } from "@/rpc/ARpcRouter";
import type ATransport from "@/transport/ATransport";
import type { SharedLoggerContext } from "@/utils/logging/Logger";
import type { LogFlushResult } from "@/utils/logging/logControl";
import type { LogControlService } from "./LogControlService";

export class LogControlRpcMethods extends ARpcMethods<RpcRouterLike> {
    constructor(
        transport: ATransport,
        private readonly service: LogControlService
    ) {
        super(transport, service.router);
    }

    /** upload every store reachable from this realm but the asker's side, and
     *  answer with the totals - the reply is the ack */
    flush(reason: string): Promise<LogFlushResult> {
        const bus = this.service.bus;
        return bus.receiveFlush(reason, bus.portFor(this.senderTransport));
    }

    /** the far realm's channel or identity changed */
    contextUpdate(context: SharedLoggerContext): void {
        const bus = this.service.bus;
        const port = bus.portFor(this.senderTransport);
        if (port) bus.applyInboundContext(port, context);
    }
}

export default LogControlRpcMethods;
