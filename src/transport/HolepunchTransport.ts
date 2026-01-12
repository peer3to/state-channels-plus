import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { Buffer } from "buffer";
import { TransportType } from "./TransportType";
class HolepunchTransport extends ATransport {
    transportType = TransportType.HOLEPUNCH;
    holepunchSocket: any;
    holepunchPeerInfo: any;
    constructor(
        holepunchSocket: any,
        holepunchPeerInfo: any,
        p2pManager: P2PManager
    ) {
        super(p2pManager);
        console.log("HOLEPUNCH TRANSPORT CREATED");
        this.holepunchSocket = holepunchSocket;
        this.holepunchPeerInfo = holepunchPeerInfo;
        this.holepunchSocket.on("data", async (data: any) => {
            if (data instanceof Uint8Array) {
                data = Buffer.from(data);
            }
            console.log("DATA RECEIVED", data);
            this.onMessage(data);
        });
        this.p2pManager.localRpc.initHandshakeService.initHandshake(this);
        this.holepunchSocket.on("close", () => {
            this.close();
        });
    }
    send(serializedRPC: string): void {
        console.log("SENDING RPC", serializedRPC);
        this.holepunchSocket.write(serializedRPC);
    }
    onMessage(data: any): void {
        const serializedRPC = data.toString();
        console.log("RECEIVED RPC", serializedRPC);
        this.p2pManager.onRpc(serializedRPC, this);
    }
    _close(): void {
        console.log("closing holepunch socket");
        this.holepunchPeerInfo.ban(true);
        this.holepunchSocket.end();

        //TODO! unban if transports are empty

        // setTimeout(() => {
        //     console.log("PeerInfo unban");
        //     this.holepunchPeerInfo.ban(false);
        // }, 10000);
    }
}
export default HolepunchTransport;
