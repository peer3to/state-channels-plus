// @spec-test-coverage-ignore: test-only endpoint for observing handler-entry mutex state
import type { MutexProbeService } from "./MutexProbeService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class MutexProbeRpcMethods extends ANetworkRpcMethods<MutexProbeService> {
    constructor(transport: NetworkTransport, service: MutexProbeService) {
        super(transport, service);
    }

    public isLockedAtHandlerEntry(): boolean {
        return (
            this.service.p2pManager.stateManager.mutex as unknown as {
                isLocked: boolean;
            }
        ).isLocked;
    }
}
