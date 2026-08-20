// @spec-test-coverage-ignore: host-side support service for loopback guard tests
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import { AGuard } from "@/rpc/guards/AGuard";
import type ATransport from "@/transport/ATransport";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { LoopbackGuardProbeRpcMethods } from "./LoopbackGuardProbeRpcMethods";

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

export class LoopbackGuardProbeService extends ARpcService<
    LoopbackGuardProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    private guardChecks = 0;
    private endpointInvocations = 0;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "LoopbackGuardProbeService"
            })
        );
        this.guards = [new RejectingGuard(this)];
    }

    public createRPCMethods(
        transport: ATransport
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
