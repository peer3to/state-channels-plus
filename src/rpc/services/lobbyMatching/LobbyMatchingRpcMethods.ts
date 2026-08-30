import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type LobbyMatchingService from "./LobbyMatchingService";
import type {
    LobbyAvailability,
    LobbyCommitResult,
    LobbyPickResult
} from "./LobbyMatchingTypes";

export default class LobbyMatchingRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: LobbyMatchingService
    ) {
        super(transport, service.p2pManager);
    }

    public advertise(
        topic: string,
        role: LobbyAvailability["role"],
        roleEpoch: number,
        available: boolean
    ): void {
        this.service.receiveAvailability(this.senderTransport, {
            topic,
            role,
            roleEpoch,
            available
        });
    }

    public pick(
        topic: string,
        attemptNonce: string,
        roleEpoch: number,
        selectorChallenge: string
    ): LobbyPickResult {
        return this.service.receivePick(
            this.senderTransport,
            attemptNonce,
            roleEpoch,
            selectorChallenge
        );
    }

    public commit(
        topic: string,
        attemptNonce: string,
        roleEpoch: number,
        selectorChallenge: string,
        advertiserChallenge: string
    ): LobbyCommitResult {
        return this.service.receiveCommit(
            this.senderTransport,
            attemptNonce,
            roleEpoch,
            selectorChallenge,
            advertiserChallenge
        );
    }
}
