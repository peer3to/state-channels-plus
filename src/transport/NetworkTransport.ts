import ATransport, { isTransport } from "./ATransport";
import { TransportType } from "./TransportType";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import Rpc, {
    RpcResponse,
    serializeRpc,
    serializeRpcResponse
} from "@/rpc/Rpc";
import { Address } from "@/types";
import { getChecksumAddress } from "@/utils/address";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { hasProperty } from "@/utils/ObjectChecks";

abstract class NetworkTransport extends ATransport {
    abstract transportType: TransportType;
    // Only ProfileManager.authenticateTransport sets this after proof and admission; trusted loopback names itself.
    // A set address authenticates this exact transport for guarded RPC.
    peerAddress: string | undefined = undefined;

    constructor(public readonly router: NetworkRpcRouter) {
        super();
        this.p2pManager.profileManager.registerTransport(this);
    }

    /**
     * True if both transports belong to the same peer. The same transport
     * object always matches; otherwise their peer addresses are compared by
     * checksum so transport upgrades (e.g. HOLEPUNCH -> WEBRTC) are tolerated.
     * Returns `false` unless both peer addresses are known.
     */
    static isSamePeer(a: NetworkTransport, b: NetworkTransport): boolean {
        if (a === b) return true;
        if (!a.peerAddress || !b.peerAddress) return false;
        return (
            getChecksumAddress(a.peerAddress) ===
            getChecksumAddress(b.peerAddress)
        );
    }

    get p2pManager() {
        return this.router.p2pManager;
    }

    public onMessage(data: unknown): void {
        // Convert host input before the common network frame admission path.
        void this.router.onRpc(
            (data as { toString(): string }).toString(),
            this
        );
    }

    abstract _send(serializedRPC: string): void;
    protected abstract _close(): void;

    /**
     * Self-originated, trusted transports (e.g. the in-process loopback used for
     * "send to self" delivery) bypass peer-facing guards. Real network
     * transports return `false`.
     */
    get isTrusted(): boolean {
        return false;
    }

    // Overrides ATransport.beforeClose to retire network identity before closure.
    protected override beforeClose(isExpected: boolean): void {
        LoggerUtils.logTransportDisconnect(this, isExpected);
    }

    protected afterClose(isExpected: boolean): void {
        if (!isExpected) {
            this.p2pManager.stateManager.p2pEventHooks?.onDisconnection?.(
                this.peerAddress as Address
            );
        }
        this.p2pManager.disconnectConnection(this);
        this._close();
    }

    send(rpc: Rpc): void {
        this.p2pManager.logger.verbose("Sending RPC", {
            transportType: TransportType[this.transportType],
            peerAddress: this.peerAddress,
            rpc: LoggerUtils.getRpcLogMetadata(rpc)
        });
        const serializedRPC = serializeRpc(rpc);
        this._send(serializedRPC);
    }

    sendRpcResponse(response: RpcResponse): void {
        this.p2pManager.logger.verbose("Sending RPC response", {
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
export function isNetworkTransport(value: unknown): value is NetworkTransport {
    return (
        hasProperty(value, "transportType") &&
        typeof value.transportType === "number" &&
        isTransport(value) &&
        hasProperty(value, "peerAddress") &&
        (value.peerAddress === undefined ||
            typeof value.peerAddress === "string")
    );
}

export default NetworkTransport;
