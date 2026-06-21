import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { Address } from "@/types/types";
import HandshakeRpcMethods from "./HandshakeRpcMethods";

/**
 * White-box driver for the handshake / dispute-acknowledgment RPC flows.
 * Accessors and helpers live here (not on the RpcMethods class) since every
 * RpcMethods method is routable by name at runtime.
 */
export class HandshakeService extends ARpcService<HandshakeRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessHandshakeService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }
    get initHandshake() {
        return this.p2pManager.localRpc.initHandshakeService;
    }
    get isForkDisputed() {
        return this.p2pManager.localRpc.isForkDisputedService;
    }

    /** Resolve the live transport toward a peer address, or throw. */
    transportTo(address: Address): ATransport {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(address);
        if (!transport) {
            throw new Error(`No open transport toward peer ${String(address)}`);
        }
        return transport;
    }

    public createRPCMethods(transport: ATransport): HandshakeRpcMethods {
        return new HandshakeRpcMethods(transport, this);
    }
}

export default HandshakeService;
