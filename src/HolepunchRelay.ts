//@ts-ignore
import Hyperswarm from "hyperswarm";
//@ts-ignore
import DHT from "@hyperswarm/dht-relay";
//@ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";
import { Logger } from "@/utils";
class HolepunchRelay {
    relayerUrls: string[];
    updateCallback: Function;
    swarm: any;
    logger: Logger;

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
        const relayerUrl = this.pickRandomRelayer();
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
            };
            ws.onclose = () => {
                this.logger.warn("Holepunch relayer disconnected", {
                    relayerUrl
                });
                this.removeAndConnectToRelayer(relayerUrl);
            };
            ws.onerror = (error) => {
                this.logger.warn("Holepunch relayer error", {
                    relayerUrl,
                    error
                });
                this.removeAndConnectToRelayer(relayerUrl);
            };

            this.updateCallback();
        } catch (e) {
            this.logger.error("Failed to connect to holepunch relayer", {
                relayerUrl,
                error: e
            });
            this.removeAndConnectToRelayer(relayerUrl);
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
    }

    private pickRandomRelayer(): string | undefined {
        if (this.relayerUrls.length === 0) return undefined;
        const index = Math.floor(Math.random() * this.relayerUrls.length);
        return this.relayerUrls[index];
    }

    private removeRelayer(relayerUrl: string): boolean {
        const index = this.relayerUrls.indexOf(relayerUrl);
        if (index === -1) return false;
        const deletedRelayer = this.relayerUrls.splice(index, 1);
        this.logger.debug("Removed holepunch relayer", {
            removed: deletedRelayer,
            remaining: this.relayerUrls
        });
        return true;
    }

    private removeAndConnectToRelayer(relayerUrl: string): void {
        const success = this.removeRelayer(relayerUrl);
        success && this.connectToRelayer();
    }
}

export default HolepunchRelay;
