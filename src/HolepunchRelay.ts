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
        let relayerUrl = this.pickRandomRelayer();
        console.log("HolepunchRelay - Connecting to relayer", relayerUrl);
        if (!relayerUrl) return;
        try {
            let ws = new WebSocket(relayerUrl);
            let dht = new DHT(new Stream(true, ws));
            this.swarm = new Hyperswarm({
                dht: dht
            });
            // console.log("HolepunchRelay - swarm ", this.swarm);
            ws.onopen = () => {
                console.log("Relayer connected", relayerUrl);
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

            this.updateCallback();
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
        let index = Math.floor(Math.random() * this.relayerUrls.length);
        return this.relayerUrls[index];
    }

    private removeRelayer(relayerUrl: string): boolean {
        let index = this.relayerUrls.indexOf(relayerUrl);
        if (index === -1) return false;
        let deletedRelayer = this.relayerUrls.splice(index, 1);
        console.log("Removed relayer", deletedRelayer);
        console.log("Current relayers", this.relayerUrls);
        return true;
    }

    private removeAndConnectToRelayer(relayerUrl: string): void {
        let success = this.removeRelayer(relayerUrl);
        success && this.connectToRelayer();
    }
}

export default HolepunchRelay;
