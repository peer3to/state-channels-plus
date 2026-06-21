import type P2PManager from "@/P2PManager";
import ATransport from "./ATransport";
import { TransportType } from "./TransportType";

/**
 * In-process transport that delivers RPCs back to the same {@link P2PManager}.
 *
 * Used for "send to self" delivery (calling `request()`/`sendOne()` with no
 * target): the node invokes its own RPC methods through the normal
 * request/response plumbing. It is trusted (bypasses peer guards) and is never
 * tracked as a peer connection.
 */
class LoopbackTransport extends ATransport {
    transportType = TransportType.LOOPBACK;

    constructor(p2pManager: P2PManager) {
        super(p2pManager);
        this.peerAddress = p2pManager.stateManager.signerAddress.toString();
    }

    get isTrusted(): boolean {
        return true;
    }

    _send(serializedRPC: string): void {
        this.p2pManager.onRpc(serializedRPC, this);
    }

    onMessage(): void {
        // Loopback never receives external data; sends re-enter `onRpc`.
    }

    /** The loopback is never a real connection, so closing is a no-op. */
    close(): void {}

    protected _close(): void {}
}

export default LoopbackTransport;
