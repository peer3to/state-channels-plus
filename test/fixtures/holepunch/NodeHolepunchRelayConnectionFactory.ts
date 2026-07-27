import WebSocket from "ws";
// @ts-ignore
import Hyperswarm from "hyperswarm";
// @ts-ignore
import DHT from "@hyperswarm/dht-relay";
// @ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";

import type {
    HolepunchRelayConnectionFactory,
    HolepunchRelayResources,
    HolepunchSwarm,
    RelaySocket,
    RelaySocketHandlers,
    RelayerUrl
} from "@/holepunch/HolepunchTypes";

class NodeRelaySocket implements RelaySocket {
    private readonly nativeSocket: WebSocket;
    private readonly holdOpen: boolean;
    private readonly holdOpenHandler: (callback: () => void) => void;
    private handlers?: RelaySocketHandlers;
    private readonly openListener = () => {
        const open = this.handlers?.open;
        if (!open) {
            return;
        }
        if (this.holdOpen) {
            this.holdOpenHandler(open);
            return;
        }
        open();
    };
    private readonly closeListener = () => this.handlers?.close();
    private readonly errorListener = (error: Error) =>
        this.handlers?.error(error);

    public constructor(
        nativeSocket: WebSocket,
        holdOpen: boolean,
        holdOpenHandler: (callback: () => void) => void
    ) {
        this.nativeSocket = nativeSocket;
        this.holdOpen = holdOpen;
        this.holdOpenHandler = holdOpenHandler;
    }

    public setHandlers(handlers: RelaySocketHandlers): void {
        this.clearHandlers();
        this.handlers = handlers;
        this.nativeSocket.on("open", this.openListener);
        this.nativeSocket.on("close", this.closeListener);
        this.nativeSocket.on("error", this.errorListener);
    }

    public clearHandlers(): void {
        this.nativeSocket.off("open", this.openListener);
        this.nativeSocket.off("close", this.closeListener);
        this.nativeSocket.off("error", this.errorListener);
        this.handlers = undefined;
    }

    public close(): void {
        if (this.nativeSocket.readyState === WebSocket.CONNECTING) {
            this.nativeSocket.terminate();
            return;
        }
        if (this.nativeSocket.readyState < WebSocket.CLOSING) {
            this.nativeSocket.close();
        }
    }
}

export class NodeHolepunchRelayConnectionFactory
    implements HolepunchRelayConnectionFactory
{
    public readonly createdRelayerUrls: RelayerUrl[] = [];
    private holdNextDestroy = false;
    private holdNextOpen = false;
    private heldDestroyResolvers: Array<() => void> = [];
    private heldOpenCallbacks: Array<() => void> = [];

    public holdNextResourceDestroy(): void {
        this.holdNextDestroy = true;
    }

    public releaseHeldResourceDestroy(): void {
        this.holdNextDestroy = false;
        for (const resolve of this.heldDestroyResolvers.splice(0)) {
            resolve();
        }
    }

    public holdNextResourceOpen(): void {
        this.holdNextOpen = true;
    }

    public releaseHeldResourceOpen(): void {
        this.holdNextOpen = false;
        for (const callback of this.heldOpenCallbacks.splice(0)) {
            callback();
        }
    }

    public create(relayerUrl: RelayerUrl): HolepunchRelayResources {
        this.createdRelayerUrls.push(relayerUrl);
        const nativeSocket = new WebSocket(relayerUrl);
        const dht = new DHT(new Stream(true, nativeSocket));
        const swarm: HolepunchSwarm = new Hyperswarm({ dht });
        const holdDestroy = this.holdNextDestroy;
        const holdOpen = this.holdNextOpen;
        this.holdNextDestroy = false;
        this.holdNextOpen = false;
        return {
            socket: new NodeRelaySocket(nativeSocket, holdOpen, (callback) =>
                this.heldOpenCallbacks.push(callback)
            ),
            dht,
            swarm,
            destroy: async () => {
                if (holdDestroy) {
                    await new Promise<void>((resolve) => {
                        this.heldDestroyResolvers.push(resolve);
                    });
                }
                await Promise.resolve(swarm.destroy());
            }
        };
    }
}
