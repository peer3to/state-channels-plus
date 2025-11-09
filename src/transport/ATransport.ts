import { RateLimiter } from "@/utils/RateLimiter";
import { TransportType } from "./TransportType";

abstract class ATransport {
    abstract transportType: TransportType;
    isClosed: boolean = false;

    /**
     * Public send method that handles rate limiting and other shared logic
     */
    send(serializedRPC: string, rateLimiter?: RateLimiter): void {
        if (rateLimiter) {
            const dataSizeBytes = Buffer.byteLength(serializedRPC, "utf8");
            const isAllowed = rateLimiter.checkAndConsume(dataSizeBytes);
            if (!isAllowed) {
                // TODO Handle rate limit exceeded
                return;
            }
        }
        // Delegate to transport-specific implementation
        this._send(serializedRPC);
    }

    /**
     * Transport-specific send implementation
     * Override this method in concrete transport classes
     */
    protected abstract _send(serializedRPC: string): void;

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
