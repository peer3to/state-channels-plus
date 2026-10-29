// @spec-test-coverage-ignore: host-side support service for loopback guard tests
import type { PingPongRpc } from "../PingPongRpcManifest";
import { LoopbackGuardProbeRpcMethods } from "./LoopbackGuardProbeRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { AGuard } from "@/rpc/network/guards/AGuard";
import type NetworkTransport from "@/transport/NetworkTransport";

export type LoopbackGuardProbeResult = {
    guardChecks: number;
    endpointInvocations: number;
};

class RejectingGuard extends AGuard<LoopbackGuardProbeService> {
    public check(): boolean {
        this.service.recordGuardCheck();
        return false;
    }

    public onFailure(): void {}
}

export class LoopbackGuardProbeService extends ANetworkRpcService<
    LoopbackGuardProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    private guardChecks = 0;
    private endpointInvocations = 0;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "LoopbackGuardProbeService"
            })
        );
        this.guards = [new RejectingGuard(this)];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): LoopbackGuardProbeRpcMethods {
        return new LoopbackGuardProbeRpcMethods(transport, this);
    }

    public recordGuardCheck(): void {
        this.guardChecks += 1;
    }

    public probe(): LoopbackGuardProbeResult {
        this.endpointInvocations += 1;
        return {
            guardChecks: this.guardChecks,
            endpointInvocations: this.endpointInvocations
        };
    }
}
