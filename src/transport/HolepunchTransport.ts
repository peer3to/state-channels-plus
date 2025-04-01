import P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { Buffer } from "buffer";
import { TransportType } from "./TransportType";
class HolepunchTransport extends ATransport {
    transportType = TransportType.HOLEPUNCH;
    holepunchSocket: any;
    holepunchPeerInfo: any;
    p2pManager: P2PManager;
    constructor(
        holepunchSocket: any,
        holepunchPeerInfo: any,
        p2pManager: P2PManager
    ) {
        super();
        console.log("HOLEPUNCH TRANSPORT CREATED");
        this.holepunchSocket = holepunchSocket;
        this.holepunchPeerInfo = holepunchPeerInfo;
        this.p2pManager = p2pManager;
        this.holepunchSocket.on("data", async (data: any) => {
            if (data instanceof Uint8Array) {
                data = Buffer.from(data);
            }
            console.log("DATA RECEIVED", data);
            this.onMessage(data);
        });
        this.p2pManager.addConnection(this);
        this.holepunchSocket.on("close", () => {
            this.close();
        });
    }
    send(serializedRPC: string): void {
        console.log("SENDING RPC", serializedRPC);
        this.holepunchSocket.write(serializedRPC);
    }
    onMessage(data: any): void {
        this.p2pManager.localRpcService.senderTransport = this;
        let serializedRPC = data.toString();
        console.log("RECEIVED RPC", serializedRPC);
        this.p2pManager.onRpc(serializedRPC);
    }
    _close(): void {
        console.log("closing holepunch socket");
        this.holepunchPeerInfo.ban(true);
        this.holepunchSocket.end();
        this.p2pManager.removeConnection(this);
        //TODO! unban if transports are empty

        // setTimeout(() => {
        //     console.log("PeerInfo unban");
        //     this.holepunchPeerInfo.ban(false);
        // }, 10000);
    }
}
export default HolepunchTransport;
