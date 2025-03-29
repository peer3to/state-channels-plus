//@ts-ignore
import Hyperswarm from "hyperswarm";
//@ts-ignore
import DHT from "@hyperswarm/dht-relay";
//@ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";
import P2PManager from "./P2PManager";
import HolepunchTransport from "./transport/HolepunchTransport";
import { Buffer } from "buffer";
import { TransportType } from "./transport/TransportType";
import HolepunchRelay from "./HolepunchRelay";

class Holepunch {
    swarm: any;
    p2pManager: P2PManager;
    topics: Buffer[] = [];
    connectionCount = 0;
    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        console.log("Holepunch - constructor");
        let setup = () => {
            // console.log("Holepunch - setup - swarm", this.swarm);
            this.swarm.removeAllListeners(["connection"]); // since hyperwarm is injected into the runtime, creating a new Holepunch object still holds the same refrence to hyperwarm
            this.swarm.on("connection", (socket: any, info: any) => {
                console.log("new connection", ++this.connectionCount);
                console.log("PeerInfo", info);
                console.trace();
                new HolepunchTransport(socket, info, this.p2pManager);
            });
            this.rejoinTopics();
        };
        // console.log(typeof global == "undefined");
        // console.log("global", global);
        // @ts-ignore
        if (typeof window != "undefined") {
            console.log("window.Hyperswarm");
            p2pManager.preferredTransport = TransportType.WEBRTC;
            let relayerUrls = [
                "wss://sigma8solution.com/dht-relay/",
                "wss://dht1-relay.leet.ar:49443"
            ];
            let relayerUpdateCallback = () => {
                let swarm = HolepunchRelay.getInstance().getSwarm();
                // console.log("Holepunch - callback - swarm", swarm);
                // @ts-ignore
                this.swarm = window.Hyperswarm || swarm;
                // console.log("Holepunch - callback - this.swarm", this.swarm);
                setup();
            };
            HolepunchRelay.init(relayerUrls, relayerUpdateCallback);
        } else {
            console.log("default.Hyperswarm");
            // @ts-ignore
            this.swarm = global.Hyperswarm || new Hyperswarm();
            setup();
        }
    }
    //Mark resources for garbage collection
    public async dispose() {
        this.leaveTopics();
    }
    public async join(topic: Buffer) {
        this.topics.push(topic);
        let discovery = this.swarm.join(topic, { server: true, client: true });
        console.log("joined topic", topic);
        return;
    }

    private rejoinTopics() {
        for (let topic of this.topics) {
            let discovery = this.swarm.join(topic, {
                server: true,
                client: true
            });
            console.log("joined topic", topic);
        }
    }

    private leaveTopics() {
        for (let topic of this.topics) {
            this.swarm.leave(topic);
            console.log("LEFT TOPIC", topic);
        }
        this.topics = [];
    }
}

export default Holepunch;
