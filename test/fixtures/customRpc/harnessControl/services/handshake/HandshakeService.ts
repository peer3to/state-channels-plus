// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import HandshakeRpcMethods from "./HandshakeRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { Address } from "@/types/types";

/**
 * White-box driver for the handshake / dispute-acknowledgment RPC flows.
 * Accessors and helpers live here (not on the RpcMethods class) since every
 * RpcMethods method is routable by name at runtime.
 */
export class HandshakeService extends ANetworkRpcService<HandshakeRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
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
    transportTo(address: Address): NetworkTransport {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(address);
        if (!transport) {
            throw new Error(`No open transport toward peer ${String(address)}`);
        }
        return transport;
    }

    public createRPCMethods(transport: NetworkTransport): HandshakeRpcMethods {
        return new HandshakeRpcMethods(transport, this);
    }
}

export default HandshakeService;
