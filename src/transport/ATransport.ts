import { TransportType } from "./TransportType";

abstract class ATransport {
    abstract transportType: TransportType;
    isClosed: boolean = false;

    abstract send(serializedRPC: string): void;
    abstract onMessage(data: any): void;
    protected abstract _close(): void;

    close(): void {
        if (!this.isClosed) {
            this.isClosed = true;
            this._close();
        }
    }
}
export default ATransport;
