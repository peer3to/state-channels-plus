//@ts-ignore
import Hyperswarm from "hyperswarm";
//@ts-ignore
import DHT from "@hyperswarm/dht-relay";
//@ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";
import { Logger } from "@/utils";
import { RelayerPool } from "@/transport/relay/RelayerPool";

class HolepunchRelay {
    relayerUrls: string[];
    updateCallback: Function;
    swarm: any;
    logger: Logger;
    private relayerPool: RelayerPool;

    private static instance: HolepunchRelay;

    public static init(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ) {
        HolepunchRelay.instance = new HolepunchRelay(
            relayerUrls,
            updateCallback,
            logger
        );
        HolepunchRelay.instance.connectToRelayer();
    }
    public static getInstance(): HolepunchRelay {
        if (!HolepunchRelay.instance)
            throw new Error("HolepunchRelay not initialized");
        return HolepunchRelay.instance;
    }
    public getSwarm(): any {
        return this.swarm;
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
        this.relayerPool = new RelayerPool({
            urls: relayerUrls,
            logger: this.logger
        });
    }
}

export default HolepunchRelay;
