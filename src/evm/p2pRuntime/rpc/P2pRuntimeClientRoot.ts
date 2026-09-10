import type { P2pRuntimeHostRoot } from "./P2pRuntimeHostRoot";
import { RuntimeEventsService } from "./runtimeEvents/RuntimeEventsService";
import type { BusKind } from "@/events/EventBus";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";

/** what the host pushes at the client: bus emissions and its own failures */
export interface RuntimeEventSink {
    onBusEvent(kind: BusKind, eventName: string, args: unknown[]): void;
    onHostError(error: SerializedError): void;
}

/** what the main thread serves to the sdk host over the runtime port */
export class P2pRuntimeClientRoot {
    readonly runtimeEvents: RuntimeEventsService;
    readonly logControl: LogControlService;

    /** `ownerLogger` is the root whose bus the host's link lands on */
    constructor(
        router: RpcRouter<P2pRuntimeClientRoot, P2pRuntimeHostRoot>,
        sink: RuntimeEventSink,
        ownerLogger?: Logger
    ) {
        this.runtimeEvents = new RuntimeEventsService(router, sink);
        this.logControl = new LogControlService(
            router,
            router.logger,
            ownerLogger?.logFlushBus
        );
    }
}

export default P2pRuntimeClientRoot;
