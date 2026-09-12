import type { P2pRuntimeHostRoot } from "./P2pRuntimeHostRoot";
import { RuntimeEventsRpcMethods } from "./runtimeEvents/RuntimeEventsRpcMethods";
import type { BusKind } from "@/events/EventBus";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the host pushes at the client: bus emissions and its own failures */
export interface RuntimeEventSink {
    onBusEvent(kind: BusKind, eventName: string, args: unknown[]): void;
    onHostErrorReport(error: SerializedError): void;
}

/** what the main thread serves to the sdk host over the runtime port */
export class P2pRuntimeClientRoot {
    /** where the host's one-way traffic lands */
    readonly sink: RuntimeEventSink;
    readonly runtimeEvents: ARpcService<RuntimeEventsRpcMethods, any>;
    readonly logControl: LogControlService;

    /** `ownerLogger` is the root whose bus the host's link lands on */
    constructor(
        router: RpcRouter<P2pRuntimeClientRoot, P2pRuntimeHostRoot>,
        sink: RuntimeEventSink,
        ownerLogger?: Logger
    ) {
        this.sink = sink;
        this.runtimeEvents = new ARpcService(
            router,
            router.logger,
            RuntimeEventsRpcMethods
        );
        this.logControl = new LogControlService(
            router,
            router.logger,
            ownerLogger?.logFlushBus
        );
    }
}

export default P2pRuntimeClientRoot;
