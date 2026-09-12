import { LogControlRpcMethods } from "./LogControlRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import { LogFlushBus, realmLogFlushBus } from "@/utils/logging/LogFlushBus";
import type { Logger } from "@/utils/logging/Logger";

/**
 * log collection over a worker link. every root that serves a link composes
 * one, bound to the bus of the logger whose context crosses that link - the
 * realm's bus in production, a private one in a fixture.
 */
export class LogControlService extends ARpcService<
    LogControlRpcMethods,
    RpcRouter<any, any>
> {
    readonly bus: LogFlushBus;

    constructor(
        router: RpcRouter<any, any>,
        logger: Logger,
        bus?: LogFlushBus
    ) {
        super(router, logger);
        this.bus = bus ?? logger.logFlushBus ?? realmLogFlushBus;
    }

    createRPCMethods(transport: ATransport): LogControlRpcMethods {
        // this service is only ever composed onto a root that serves a worker
        // link, so the line a call arrived on is that link
        return new LogControlRpcMethods(
            transport as MessagePortTransport,
            this
        );
    }
}

export default LogControlService;
