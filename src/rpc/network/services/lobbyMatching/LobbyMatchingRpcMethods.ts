import type LobbyMatchingService from "./LobbyMatchingService";
import type {
    LobbyAvailability,
    LobbyCommitResult,
    LobbyPickResult
} from "./LobbyMatchingTypes";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export default class LobbyMatchingRpcMethods extends ANetworkRpcMethods<LobbyMatchingService> {
    constructor(transport: NetworkTransport, service: LobbyMatchingService) {
        super(transport, service);
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

    // topic stays positional because LobbyRpcAdmissionGuard reads rpc.params[0].
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

    // topic stays positional because LobbyRpcAdmissionGuard reads rpc.params[0].
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
