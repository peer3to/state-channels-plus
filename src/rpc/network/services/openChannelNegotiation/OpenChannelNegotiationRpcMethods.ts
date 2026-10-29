import type OpenChannelNegotiationService from "./OpenChannelNegotiationService";
import type P2PManager from "@/P2PManager";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type MainRpcService from "@/rpc/network/MainRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";

export type OpenChannelNegotiationCustomRpc = MainRpcService & {
    openChannelNegotiationService: OpenChannelNegotiationService;
};

export type OpenChannelNegotiationP2PManager =
    P2PManager<OpenChannelNegotiationCustomRpc>;

export default class OpenChannelNegotiationRpcMethods extends ANetworkRpcMethods<OpenChannelNegotiationService> {
    constructor(
        transport: NetworkTransport,
        service: OpenChannelNegotiationService
    ) {
        super(transport, service);
    }

    public async exchangeTerms(
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        encodedBalance: string
    ): Promise<{ encodedBalance: string }> {
        return this.service.acceptTerms(
            this.senderTransport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge,
            encodedBalance
        );
    }

    public async openProposal(
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        encodedOpenChannel: string,
        lowerSignature: string
    ): Promise<{ status: "submitted" }> {
        return this.service.acceptOpenProposal(
            this.senderTransport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge,
            encodedOpenChannel,
            lowerSignature
        );
    }

    public abort(
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        reason: string
    ): { status: "acknowledged" } {
        this.service.acceptAbort(
            this.senderTransport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge,
            reason
        );
        return { status: "acknowledged" };
    }
}
