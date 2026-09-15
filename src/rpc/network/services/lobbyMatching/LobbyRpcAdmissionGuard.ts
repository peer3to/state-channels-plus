import type LobbyMatchingService from "./LobbyMatchingService";
import { AGuard } from "@/rpc/network/guards";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

export default class LobbyRpcAdmissionGuard extends AGuard<LobbyMatchingService> {
    check(rpc: Rpc, transport: NetworkTransport): boolean {
        return !!transport.peerAddress && this.service.isRpcAdmitted(rpc);
    }

    onFailure(_rpc: Rpc, transport: NetworkTransport): void {
        this.service.recordRejectedRpc(transport);
    }

    // Overrides AGuard.suppressesFailureResponse: notifications have no reply.
    override suppressesFailureResponse(rpc: Rpc): boolean {
        return rpc.requestId === undefined;
    }
}
