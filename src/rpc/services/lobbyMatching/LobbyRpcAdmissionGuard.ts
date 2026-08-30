import type Rpc from "@/rpc/Rpc";
import { AGuard } from "@/rpc/guards";
import type ATransport from "@/transport/ATransport";
import type LobbyMatchingService from "./LobbyMatchingService";

export default class LobbyRpcAdmissionGuard extends AGuard<LobbyMatchingService> {
    check(rpc: Rpc, transport: ATransport): boolean {
        return !!transport.peerAddress && this.service.isRpcAdmitted(rpc);
    }

    onFailure(_rpc: Rpc, transport: ATransport): void {
        this.service.recordRejectedRpc(transport);
    }

    suppressesFailureResponse(rpc: Rpc): boolean {
        return rpc.requestId === undefined;
    }
}
