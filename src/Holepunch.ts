//@ts-ignore
import Hyperswarm from "hyperswarm";
import P2PManager from "./P2PManager";
import HolepunchTransport from "./transport/HolepunchTransport";

class Holepunch {
    swarm: any;
    p2pManager: P2PManager;
    topics: Buffer[] = [];
    connectionCount = 0;
    constructor(p2pManager: P2PManager) {
        // @ts-ignore
        if (typeof window !== "undefined" && window.Hyperswarm) {
            // @ts-ignore
            this.swarm = window.Hyperswarm;
            console.log("window.Hyperswarm", this.swarm);
            // @ts-ignore
        } else if (typeof global !== "undefined" && global.Hyperswarm) {
            // @ts-ignore
            this.swarm = global.Hyperswarm;
            console.log("global.Hyperswarm", this.swarm);
        } else {
            this.swarm = new Hyperswarm();
        }
        this.p2pManager = p2pManager;
        this.swarm.removeAllListeners(["connection"]); // since hyperwarm is injected into the runtime, creating a new Holepunch object still holds the same refrence to hyperwarm
        this.swarm.on("connection", (socket: any, info: any) => {
            console.log("new connection", ++this.connectionCount);
            console.log("PeerInfo", info);
            console.trace();
            let hpTransport = new HolepunchTransport(socket, this.p2pManager);
            this.p2pManager.addConnection(hpTransport);
            socket.on("close", () => {
                this.p2pManager.removeConnection(hpTransport);
            });
        });
    }
    //Mark resources for garbage collection
    public async dispose() {
        for (let topic of this.topics) {
            await this.swarm.leave(topic);
            console.log("LEFT TOPIC", topic);
        }
        this.topics = [];
    }
    public async join(topic: Buffer) {
        this.topics.push(topic);
        let discovery = this.swarm.join(topic, { server: true, client: true });
        console.log("joined topic", topic);
        return;
    }
}

export default Holepunch;
