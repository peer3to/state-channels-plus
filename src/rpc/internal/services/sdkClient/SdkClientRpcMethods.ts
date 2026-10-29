import type { SdkClientService } from "./SdkClientService";
import type { BusKind } from "@/events/EventBus";
import { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";

export class SdkClientRpcMethods extends AInternalRpcMethods<SdkClientService> {
    /**
     * Host→client bus event: ONE payload for every forwarded event kind (p2p
     * hooks, contract events, `EventHandler` mirrors). The client re-emits it into
     * its own bus; contract events additionally re-emit on the main-thread
     * contract. Handler `args` cross by structured clone; an uncloneable
     * argument throws synchronously at the sender.
     */
    public busEvent(kind: BusKind, eventName: string, args: unknown[]): void {
        this.service.handlers.busEvent(kind, eventName, args);
    }
    /**
     * Host→client hand-off of the main-thread end of the WebRTC bridge
     * `MessageChannel`. Emitted (with `port` in the transfer list) only when the
     * host runs in a worker that cannot negotiate WebRTC itself, so the caller can
     * forward the port up to the real main thread and bind it to the bridge.
     */
    public webRTCBridgePort(port: MessagePort): void {
        this.service.handlers.webRTCBridgePort(port);
    }
}
