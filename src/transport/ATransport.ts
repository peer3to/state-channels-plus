import P2PManager from "@/P2PManager";
import { TransportType } from "./TransportType";
import Rpc, { serializeRpc } from "@/rpc/Rpc";
import { LoggerUtils } from "@/utils/LoggerUtils";

abstract class ATransport {
    abstract transportType: TransportType;
    isClosed: boolean = false;
    peerAddress?: string;
    p2pManager: P2PManager;

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
    }

    abstract _send(serializedRPC: string): void;
    abstract onMessage(data: any): void;
    protected abstract _close(): void;

    close(isExpected = false): void {
        if (!this.isClosed) {
            LoggerUtils.logTransportDisconnect(this, isExpected);
            this.isClosed = true;
            this._close();
        }
    }

    send(rpc: Rpc): void {
        this.p2pManager.logger.verbose("Sending RPC", {
            transportType: TransportType[this.transportType],
            peerAddress: this.peerAddress,
            rpc
        });
        const serializedRPC = serializeRpc(rpc);
        this._send(serializedRPC);
    }
}
export default ATransport;
