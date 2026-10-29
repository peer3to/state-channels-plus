import NetworkTransport from "./NetworkTransport";
import { TransportType } from "./TransportType";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";

/**
 * In-process transport that delivers RPCs back to the same {@link P2PManager}.
 *
 * Used for "send to self" delivery (calling `request()`/`sendOne()` with no
 * target): the node invokes its own RPC methods through the normal
 * request/response plumbing. It is trusted (bypasses peer guards) and is never
 * tracked as a peer connection.
 */
class LoopbackTransport extends NetworkTransport {
    transportType = TransportType.LOOPBACK;

    constructor(router: NetworkRpcRouter) {
        super(router);
        this.peerAddress =
            router.p2pManager.stateManager.signerAddress.toString();
    }

    // Overrides NetworkTransport.isTrusted: self delivery is trusted.
    override get isTrusted(): boolean {
        return true;
    }

    _send(serializedRPC: string): void {
        void this.router.onRpc(serializedRPC, this);
    }

    // Overrides NetworkTransport.onMessage; loopback delivery enters the router directly.
    override onMessage(): void {
        // Loopback never receives external data; sends re-enter the network router.
    }

    /** The loopback is never a real connection, so closing is a no-op. */
    // Overrides ATransport.close so a disposal RPC can still return to its caller.
    override close(): void {}

    protected _close(): void {}
}

export default LoopbackTransport;
