import { TransportType } from "./TransportType";
import type P2PManager from "@/P2PManager";
import Rpc, {
    RpcResponse,
    serializeRpc,
    serializeRpcResponse
} from "@/rpc/Rpc";
import type { RpcRouter } from "@/rpc/RpcRouter";
import { getChecksumAddress } from "@/utils/address";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { hasMethod, hasProperty } from "@/utils/ObjectChecks";

abstract class ATransport {
    abstract transportType: TransportType;
    isClosed: boolean = false;
    // Only ProfileManager.authenticateTransport sets this after proof and admission; trusted loopback names itself.
    // A set address authenticates this exact transport for guarded RPC.
    peerAddress?: string;
    /** the router this transport delivers to: the peer manager or a port router */
    readonly router: RpcRouter<any, any>;
    private readonly closedListeners = new Set<
        (transport: ATransport) => void
    >();

    constructor(router: RpcRouter<any, any>) {
        this.router = router;
        // the router tracks the line from here on; a peer router also gives
        // every transport its profile as it is built
        this.router.onTransportCreated(this);
    }

    /** the peer transports live on the peer manager */
    get p2pManager(): P2PManager {
        return this.router as P2PManager;
    }

    /**
     * True if both transports belong to the same peer. The same transport
     * object always matches; otherwise their peer addresses are compared by
     * checksum so transport upgrades (e.g. HOLEPUNCH -> WEBRTC) are tolerated.
     * Returns `false` unless both peer addresses are known.
     */
    static isSamePeer(a: ATransport, b: ATransport): boolean {
        if (a === b) return true;
        if (!a.peerAddress || !b.peerAddress) return false;
        return (
            getChecksumAddress(a.peerAddress) ===
            getChecksumAddress(b.peerAddress)
        );
    }

    abstract _send(serializedRPC: string): void;
    onMessage(data: any): void {
        const serializedRPC = data.toString();
        this.p2pManager.onRpc(serializedRPC, this);
    }
    protected abstract _close(): void;

    /**
     * Self-originated, trusted transports (e.g. the in-process loopback used for
     * "send to self" delivery) bypass peer-facing guards. Real network
     * transports return `false`.
     */
    get isTrusted(): boolean {
        return false;
    }

    close(isExpected = false): void {
        if (!this.isClosed) {
            LoggerUtils.logTransportDisconnect(this, isExpected);
            this.isClosed = true;
            for (const listener of [...this.closedListeners]) listener(this);
            this.closedListeners.clear();
            this.router.onTransportClosed(this, isExpected);
            this._close();
        }
    }

    /** run once when this transport closes, or now if it already has */
    onClosed(listener: (transport: ATransport) => void): () => void {
        if (this.isClosed) {
            listener(this);
            return () => undefined;
        }
        this.closedListeners.add(listener);
        return () => this.closedListeners.delete(listener);
    }

    send(rpc: Rpc): void {
        this.router.logger.verbose("Sending RPC", {
            transportType: TransportType[this.transportType],
            peerAddress: this.peerAddress,
            rpc: LoggerUtils.getRpcLogMetadata(rpc)
        });
        const serializedRPC = serializeRpc(rpc);
        this._send(serializedRPC);
    }

    sendRpcResponse(response: RpcResponse): void {
        this.router.logger.verbose("Sending RPC response", {
            transportType: TransportType[this.transportType],
            peerAddress: this.peerAddress,
            requestId: response.requestId,
            ok: response.ok
        });
        this._send(serializeRpcResponse(response));
    }
}

/**
 * Type guard for transports loaded from any JavaScript module graph.
 */
export function isTransport(value: unknown): value is ATransport {
    return (
        hasProperty(value, "transportType") &&
        typeof value.transportType === "number" &&
        hasMethod(value, "send") &&
        hasMethod(value, "sendRpcResponse")
    );
}

export default ATransport;
