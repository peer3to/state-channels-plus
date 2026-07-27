import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { Buffer } from "buffer";
import { TransportType } from "./TransportType";
import type {
    HolepunchConnectionSocket,
    HolepunchPeerInfo
} from "@/holepunch/HolepunchTypes";

class HolepunchTransport extends ATransport {
    transportType = TransportType.HOLEPUNCH;
    holepunchSocket: HolepunchConnectionSocket;
    holepunchPeerInfo: HolepunchPeerInfo;
    constructor(
        holepunchSocket: HolepunchConnectionSocket,
        holepunchPeerInfo: HolepunchPeerInfo,
        p2pManager: P2PManager
    ) {
        super(p2pManager);
        this.holepunchSocket = holepunchSocket;
        this.holepunchPeerInfo = holepunchPeerInfo;
        this.holepunchSocket.on("data", (data: Uint8Array) => {
            if (data instanceof Uint8Array) {
                data = Buffer.from(data);
            }
            this.onMessage(data);
        });
        this.p2pManager.localRpc.initHandshakeService.initHandshake(this);
        this.holepunchSocket.on("close", () => {
            this.close();
        });
        this.holepunchSocket.on("error", (error: Error) => {
            this.p2pManager.logger.error("Holepunch socket error", {
                socketState: this.holepunchSocket?.readyState,
                error
            });
            this.close();
        });
    }
    _send(serializedRPC: string): void {
        this.holepunchSocket.write(serializedRPC);
    }
    onMessage(data: Uint8Array): void {
        const serializedRPC = data.toString();
        this.p2pManager.onRpc(serializedRPC, this);
    }

    _close(): void {
        this.holepunchPeerInfo.ban(true);
        this.holepunchSocket.destroy();
    }
}
export default HolepunchTransport;
