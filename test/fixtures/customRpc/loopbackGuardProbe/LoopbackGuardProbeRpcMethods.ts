// @spec-test-coverage-ignore: loopback guard probe endpoint
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { PingPongRpc } from "../PingPongRpcManifest";
import type {
    LoopbackGuardProbeResult,
    LoopbackGuardProbeService
} from "./LoopbackGuardProbeService";

export class LoopbackGuardProbeRpcMethods extends ARpcMethods<
    P2PManager<PingPongRpc>
> {
    constructor(
        transport: ATransport,
        private readonly service: LoopbackGuardProbeService
    ) {
        super(transport, service.p2pManager);
    }

    public probe(): LoopbackGuardProbeResult {
        return this.service.probe();
    }
}
