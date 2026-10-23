import { RelayerPool } from "@/transport/relay/RelayerPool";
import { Logger } from "@/utils";
//@ts-ignore
import DHT from "@hyperswarm/dht-relay";
//@ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";
//@ts-ignore
import Hyperswarm from "hyperswarm";

class HolepunchRelay {
    relayerUrls: string[];
    updateCallback: Function;
    swarm: any;
    logger: Logger;
    private relayerPool: RelayerPool;
    private socket?: WebSocket;

    private static instance: HolepunchRelay;

    public static init(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ): HolepunchRelay {
        HolepunchRelay.instance = new HolepunchRelay(
            relayerUrls,
            updateCallback,
            logger
        );
        HolepunchRelay.instance.connectToRelayer();
        return HolepunchRelay.instance;
    }
    public static getInstance(): HolepunchRelay {
        if (!HolepunchRelay.instance)
            throw new Error("HolepunchRelay not initialized");
        return HolepunchRelay.instance;
    }
    public getSwarm(): any {
        return this.swarm;
    }

    /**
     * Stops reconnecting and detaches the socket's handlers before closing it:
     * the socket closes after its runtime's logger is disposed, and a handler
     * left attached would log through that logger and reconnect.
     */
    public dispose(): void {
        this.relayerPool.dispose();
        if (!this.socket) return;
        this.socket.onopen = null;
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.close();
    }

    private connectToRelayer(): void {
        if (this.relayerUrls.length === 0) {
            this.logger.warn("No holepunch relayers configured");
            return;
        }

        const relayerUrl = this.relayerPool.next();
        this.logger.info("Connecting to holepunch relayer", {
            relayerUrl
        });
        if (!relayerUrl) return;
        try {
            const ws = new WebSocket(relayerUrl);
            this.socket = ws;
            const dht = new DHT(new Stream(true, ws));
            this.swarm = new Hyperswarm({
                dht: dht
            });
            ws.onopen = () => {
                this.logger.info("Holepunch relayer connected", {
                    relayerUrl
                });
                this.relayerPool.onSuccess();
            };
            ws.onclose = () => {
                this.logger.warn("Holepunch relayer disconnected", {
                    relayerUrl
                });
                this.relayerPool.onFailure(relayerUrl, () =>
                    this.connectToRelayer()
                );
            };
            ws.onerror = (error) => {
                this.logger.warn("Holepunch relayer error", {
                    relayerUrl,
                    error
                });
                this.relayerPool.onFailure(relayerUrl, () =>
                    this.connectToRelayer()
                );
            };

            this.updateCallback();
        } catch (e) {
            this.logger.error("Failed to connect to holepunch relayer", {
                relayerUrl,
                error: e
            });
            this.relayerPool.onFailure(relayerUrl, () =>
                this.connectToRelayer()
            );
        }
    }

    private constructor(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ) {
        this.relayerUrls = relayerUrls;
        this.updateCallback = updateCallback;
        this.logger = logger.child({ component: "HolepunchRelay" });
        this.relayerPool = new RelayerPool(relayerUrls, this.logger);
    }
}

export default HolepunchRelay;
