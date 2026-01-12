import P2PManager from "@/P2PManager";
import { TransportType } from "./TransportType";

abstract class ATransport {
    abstract transportType: TransportType;
    isClosed: boolean = false;
    peerAddress?: string;
    p2pManager: P2PManager;

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
    }

    abstract send(serializedRPC: string): void;
    abstract onMessage(data: any): void;
    protected abstract _close(): void;

    close(): void {
        if (!this.isClosed) {
            this.isClosed = true;
            this.p2pManager.disconnectConnection(this);
            this._close();
        }
    }
}
export default ATransport;
