// @spec-test-coverage-ignore: harness network observations used by mapped component and E2E declarations
import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { Address } from "@/types";
import NetworkRpcMethods from "./NetworkRpcMethods";

/** Connection / network control operations exposed to the test harness. */
export class NetworkService extends ARpcService<NetworkRpcMethods> {
    private readonly transportTokens = new WeakMap<ATransport, number>();
    private nextTransportToken = 1;

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessNetworkService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): NetworkRpcMethods {
        return new NetworkRpcMethods(transport, this);
    }

    public getTransportToken(peerAddress: Address): number | null {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(
                peerAddress
            );
        if (!transport || transport.isClosed) return null;
        const existing = this.transportTokens.get(transport);
        if (existing !== undefined) return existing;
        const token = this.nextTransportToken++;
        this.transportTokens.set(transport, token);
        return token;
    }
}

export default NetworkService;
