import type { BusKind } from "@/events/EventBus";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type { Logger } from "@/utils/logging/Logger";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";
import { RuntimeEventsService } from "./runtimeEvents/RuntimeEventsService";

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
        router: PortRpcRouter<P2pRuntimeClientRoot>,
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

/** the names the host may call on the client: its typed endpoint */
export const P2P_RUNTIME_CLIENT_MANIFEST = [
    "runtimeEvents",
    "logControl"
] as const satisfies readonly (keyof P2pRuntimeClientRoot)[];

export default P2pRuntimeClientRoot;
