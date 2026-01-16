//@ts-ignore
import Hyperswarm from "hyperswarm";
//@ts-ignore
import DHT from "@hyperswarm/dht-relay";
//@ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";
class HolepunchRelay {
    relayerUrls: string[];
    updateCallback: Function;
    swarm: any;

    private static instance: HolepunchRelay;

    public static init(relayerUrls: string[], updateCallback: Function) {
        HolepunchRelay.instance = new HolepunchRelay(
            relayerUrls,
            updateCallback
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
        console.log("HolepunchRelay - Connecting to relayer", relayerUrl);
        if (!relayerUrl) return;
        try {
            const ws = new WebSocket(relayerUrl);
            const dht = new DHT(new Stream(true, ws));
            this.swarm = new Hyperswarm({
                dht: dht
            });
            // console.log("HolepunchRelay - swarm ", this.swarm);
            ws.onopen = () => {
                console.log("Relayer connected", relayerUrl);
                this.updateCallback();
            };
            ws.onclose = () => {
                console.log("Relayer disconnected", relayerUrl);
                this.removeAndConnectToRelayer(relayerUrl);
            };
            ws.onerror = (error) => {
                console.log("Relayer error", error);
                this.removeAndConnectToRelayer(relayerUrl);
            };
            console.log("HolepunchRelay - set onError", relayerUrl);
        } catch (e) {
            console.log(
                "Error connecting to relayer - ",
                relayerUrl,
                " - error - ",
                e
            );
            this.removeAndConnectToRelayer(relayerUrl);
        }
    }

    private constructor(relayerUrls: string[], updateCallback: Function) {
        this.relayerUrls = relayerUrls;
        this.updateCallback = updateCallback;
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
        console.log("Removed relayer", deletedRelayer);
        console.log("Current relayers", this.relayerUrls);
        return true;
    }

    private removeAndConnectToRelayer(relayerUrl: string): void {
        const success = this.removeRelayer(relayerUrl);
        success && this.connectToRelayer();
    }
}

export default HolepunchRelay;
