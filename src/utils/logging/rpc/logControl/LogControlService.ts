import ARpcService from "@/rpc/ARpcService";
import type { RpcRouterLike } from "@/rpc/ARpcRouter";
import type ATransport from "@/transport/ATransport";
import type { Logger } from "@/utils/logging/Logger";
import { LogFlushBus, realmLogFlushBus } from "@/utils/logging/LogFlushBus";
import { LogControlRpcMethods } from "./LogControlRpcMethods";

/**
 * log collection over a worker link. every root that serves a link composes
 * one, bound to the bus of the logger whose context crosses that link - the
 * realm's bus in production, a private one in a fixture.
 */
export class LogControlService extends ARpcService<
    LogControlRpcMethods,
    RpcRouterLike
> {
    readonly bus: LogFlushBus;

    constructor(router: RpcRouterLike, logger: Logger, bus?: LogFlushBus) {
        super(router, logger);
        this.bus = bus ?? logger.logFlushBus ?? realmLogFlushBus;
    }

    createRPCMethods(transport: ATransport): LogControlRpcMethods {
        return new LogControlRpcMethods(transport, this);
    }
}

export default LogControlService;
