import { TransportType } from "./TransportType";
import { outboundRateLimiter } from "@/utils/RateLimiter";

abstract class ATransport {
    abstract transportType: TransportType;
    isClosed: boolean = false;

    /**
     * Public send method that handles rate limiting and other shared logic
     */
    send(serializedRPC: string): void {
        // Check outbound rate limiting
        if (outboundRateLimiter) {
            const dataSizeBytes = Buffer.byteLength(serializedRPC, "utf8");
            if (!outboundRateLimiter.checkAndConsume(dataSizeBytes)) {
                console.warn(
                    `${this.transportType} rate limit exceeded, dropping message`
                );
                return; // Drop the message
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
