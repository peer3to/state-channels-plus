// @spec-test-coverage-ignore: guard-chain probe endpoint for LocalOnlyGuard tests
import type { PingPongRpc } from "../PingPongRpcManifest";
import { LocalOnlyGuardChainTargetRpcMethods } from "./LocalOnlyGuardChainTargetRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { AGuard } from "@/rpc/network/guards/AGuard";
import { LocalOnlyGuard } from "@/rpc/network/guards/LocalOnlyGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

/** A real guard placed before the local-only guard; it rejects one endpoint. */
class EarlierGuard extends AGuard {
    public failures = 0;

    check(rpc: Rpc): boolean {
        return rpc.method !== "failEarlierGuard";
    }

    onFailure(): void {
        this.failures += 1;
    }
}

/** A service guarded by an earlier guard, then by the production LocalOnlyGuard. */
export class LocalOnlyGuardChainTargetService extends ANetworkRpcService<
    LocalOnlyGuardChainTargetRpcMethods,
    P2PManager<PingPongRpc>
> {
    public readonly invocations: string[] = [];
    public readonly earlier: EarlierGuard;
    public readonly localOnly: LocalOnlyGuard;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "LocalOnlyGuardChainTargetService"
            })
        );
        this.earlier = new EarlierGuard(this);
        this.localOnly = new LocalOnlyGuard(this);
        this.guards = [this.earlier, this.localOnly];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): LocalOnlyGuardChainTargetRpcMethods {
        return new LocalOnlyGuardChainTargetRpcMethods(transport, this);
    }
}
