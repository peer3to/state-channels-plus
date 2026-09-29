import { DisconnectPolicy } from "@/DisconnectPolicy";
import { AGuard } from "@/rpc/network/guards/AGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Restricts a service to this node's own calls. Trusted loopback delivery
 * bypasses guards at service dispatch, so every invocation that reaches this
 * check came from another peer: it is rejected, and the sender is punished
 * and disconnected through the canonical disconnect owner.
 */
export class LocalOnlyGuard extends AGuard {
    // Requests this guard rejected; only their failure response is suppressed.
    private readonly rejectedRpcs = new WeakSet<Rpc>();

    check(): boolean {
        return false;
    }

    onFailure(rpc: Rpc, transport: NetworkTransport): void {
        this.rejectedRpcs.add(rpc);
        this.service.p2pManager.disconnectConnection(
            transport,
            DisconnectPolicy.BLACKLIST,
            "remote call to a local-only RPC"
        );
    }

    // Overrides AGuard.suppressesFailureResponse: the sender is already
    // disconnected, so the request this guard rejected gets no response.
    override suppressesFailureResponse(rpc: Rpc): boolean {
        return this.rejectedRpcs.has(rpc);
    }
}
