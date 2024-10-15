import P2PManager from "../P2PManager";
import ATransport from "./ATransport";
class HolepunchTransport extends ATransport {
    holepunchSocket: any;
    p2pManager: P2PManager;
    constructor(holepunchSocket: any, p2pManager: P2PManager) {
        super();
        this.holepunchSocket = holepunchSocket;
        this.p2pManager = p2pManager;
        this.holepunchSocket.on("data", async (data: any) => {
            this.onMessage(data);
        });
    }
    send(serializedRPC: string): void {
        this.holepunchSocket.write(serializedRPC);
    }
    onMessage(data: any): void {
        this.p2pManager.localRpcService.senderTransport = this;
        let serializedRPC = data.toString();
        this.p2pManager.onRpc(serializedRPC);
    }
    close(): void {
        console.log("closing holepunch socket");
        this.holepunchSocket.end();
    }
}
export default HolepunchTransport;
