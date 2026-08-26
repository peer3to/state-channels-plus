import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import { PunishmentService } from "./PunishmentService";

/** Read-only punishment-counter queries exposed to the test harness. */
export class PunishmentRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: PunishmentService
    ) {
        super(transport, service.p2pManager);
    }

    /** This peer's own disconnectAndBlacklistPeer* call count. */
    public getBlacklistCallCount(): number {
        return this.service.blacklistCallCount;
    }

    /** Process-wide holepunchPeerInfo.ban(true) call count. */
    public getBanCallCount(): number {
        return PunishmentService.banCallCount;
    }
}

export default PunishmentRpcMethods;
