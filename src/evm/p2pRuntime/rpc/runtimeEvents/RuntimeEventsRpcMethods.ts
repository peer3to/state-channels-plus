import type { BusKind } from "@/events/EventBus";
import ARpcMethods from "@/rpc/ARpcMethods";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type ATransport from "@/transport/ATransport";
import type { P2pRuntimeClientRoot } from "../P2pRuntimeClientRoot";
import type { RuntimeEventsService } from "./RuntimeEventsService";

export class RuntimeEventsRpcMethods extends ARpcMethods<
    PortRpcRouter<P2pRuntimeClientRoot>
> {
    constructor(
        transport: ATransport,
        private readonly service: RuntimeEventsService
    ) {
        super(transport, service.router);
    }

    /**
     * ONE payload for every forwarded event kind (p2p hooks, contract events,
     * `EventHandler` mirrors). The client re-emits it into its own bus;
     * contract events additionally re-emit on the main-thread contract.
     */
    busEvent(kind: BusKind, eventName: string, args: unknown[]): void {
        this.service.sink.onBusEvent(kind, eventName, args);
    }

    /**
     * an autonomous host-side failure (an unhandledRejection /
     * uncaughtException not tied to a request), so the main-thread
     * orchestrator observes worker-thread errors as if they were local
     */
    hostError(error: SerializedError): void {
        this.service.sink.onHostError(error);
    }
}

export default RuntimeEventsRpcMethods;
