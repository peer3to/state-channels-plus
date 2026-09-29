// @spec-test-coverage-ignore: guarded probe endpoint for LocalOnlyGuard tests
import type { PingPongRpc } from "../PingPongRpcManifest";
import { LocalOnlyGuardTargetRpcMethods } from "./LocalOnlyGuardTargetRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { LocalOnlyGuard } from "@/rpc/network/guards/LocalOnlyGuard";
import type NetworkTransport from "@/transport/NetworkTransport";

/** A service restricted by the production LocalOnlyGuard; counts endpoint runs. */
export class LocalOnlyGuardTargetService extends ANetworkRpcService<
    LocalOnlyGuardTargetRpcMethods,
    P2PManager<PingPongRpc>
> {
    public readonly invocations: string[] = [];
    public readonly localOnly: LocalOnlyGuard;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "LocalOnlyGuardTargetService"
            })
        );
        this.localOnly = new LocalOnlyGuard(this);
        this.guards = [this.localOnly];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): LocalOnlyGuardTargetRpcMethods {
        return new LocalOnlyGuardTargetRpcMethods(transport, this);
    }
}
