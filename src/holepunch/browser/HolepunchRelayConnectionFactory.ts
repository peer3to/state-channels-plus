// @ts-expect-error hyperswarm does not publish TypeScript declarations.
import Hyperswarm from "hyperswarm";
// @ts-expect-error dht-relay does not publish TypeScript declarations.
import DHT from "@hyperswarm/dht-relay";
// @ts-expect-error dht-relay does not publish TypeScript declarations.
import Stream from "@hyperswarm/dht-relay/ws";

import type {
    HolepunchRelayConnectionFactory,
    HolepunchRelayResources,
    HolepunchSwarm,
    RelaySocket,
    RelaySocketHandlers,
    RelayerUrl
} from "../HolepunchTypes";

class BrowserRelaySocket implements RelaySocket {
    private readonly nativeSocket: WebSocket;
    private readonly beforeOpen: () => void;

    public constructor(nativeSocket: WebSocket, beforeOpen: () => void) {
        this.nativeSocket = nativeSocket;
        this.beforeOpen = beforeOpen;
    }

    public setHandlers(handlers: RelaySocketHandlers): void {
        this.nativeSocket.onopen = () => {
            this.beforeOpen();
            handlers.open();
        };
        this.nativeSocket.onclose = handlers.close;
        this.nativeSocket.onerror = handlers.error;
    }

    public clearHandlers(): void {
        this.nativeSocket.onopen = null;
        this.nativeSocket.onclose = null;
        this.nativeSocket.onerror = null;
    }

    public close(): void {
        this.nativeSocket.close();
    }
}

class BrowserDhtSocket {
    private readonly nativeSocket: WebSocket;
    private readonly listeners = new Map<
        (event: Error | Event) => void,
        Map<string, EventListener>
    >();

    public constructor(nativeSocket: WebSocket) {
        this.nativeSocket = nativeSocket;
    }

    public get readyState(): number {
        return this.nativeSocket.readyState;
    }

    public set binaryType(value: BinaryType) {
        this.nativeSocket.binaryType = value;
    }

    public get binaryType(): BinaryType {
        return this.nativeSocket.binaryType;
    }

    public addEventListener(
        type: string,
        listener: (event: Error | Event) => void
    ): void {
        const wrappedListener: EventListener = (event) => {
            listener(
                type === "error"
                    ? new Error("Holepunch relay WebSocket failed")
                    : event
            );
        };
        let listenersByType = this.listeners.get(listener);
        if (!listenersByType) {
            listenersByType = new Map();
            this.listeners.set(listener, listenersByType);
        }
        listenersByType.set(type, wrappedListener);
        this.nativeSocket.addEventListener(type, wrappedListener);
    }

    public removeEventListener(
        type: string,
        listener: (event: Error | Event) => void
    ): void {
        const listenersByType = this.listeners.get(listener);
        const wrappedListener = listenersByType?.get(type);
        if (!wrappedListener) {
            return;
        }
        this.nativeSocket.removeEventListener(type, wrappedListener);
        listenersByType?.delete(type);
        if (listenersByType?.size === 0) {
            this.listeners.delete(listener);
        }
    }

    public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        this.nativeSocket.send(data);
    }

    public close(): void {
        this.nativeSocket.close();
    }
}

export class BrowserHolepunchRelayConnectionFactory
    implements HolepunchRelayConnectionFactory
{
    public create(relayerUrl: RelayerUrl): HolepunchRelayResources {
        const nativeSocket = new WebSocket(relayerUrl);
        let dht: unknown;
        let swarm: HolepunchSwarm | undefined;
        const activate = () => {
            if (swarm) {
                return;
            }
            dht = new DHT(new Stream(true, new BrowserDhtSocket(nativeSocket)));
            swarm = new Hyperswarm({ dht });
        };
        return {
            socket: new BrowserRelaySocket(nativeSocket, activate),
            get dht() {
                if (!dht) {
                    throw new Error(
                        "Holepunch relay DHT accessed before socket open"
                    );
                }
                return dht;
            },
            get swarm() {
                if (!swarm) {
                    throw new Error(
                        "Holepunch relay swarm accessed before socket open"
                    );
                }
                return swarm;
            },
            destroy: async () => {
                if (swarm) {
                    await Promise.resolve(swarm.destroy());
                    return;
                }
                nativeSocket.close();
            }
        };
    }
}
