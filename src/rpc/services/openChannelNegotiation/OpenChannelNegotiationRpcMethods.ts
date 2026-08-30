import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type P2PManager from "@/P2PManager";
import type MainRpcService from "@/rpc/MainRpcService";
import type OpenChannelNegotiationService from "./OpenChannelNegotiationService";

export type OpenChannelNegotiationCustomRpc = MainRpcService & {
    openChannelNegotiationService: OpenChannelNegotiationService;
};

export type OpenChannelNegotiationP2PManager =
    P2PManager<OpenChannelNegotiationCustomRpc>;

export default class OpenChannelNegotiationRpcMethods extends ARpcMethods<OpenChannelNegotiationP2PManager> {
    constructor(
        transport: ATransport,
        private readonly service: OpenChannelNegotiationService
    ) {
        super(transport, service.p2pManager);
    }

    public async exchangeTerms(
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        amount: number
    ): Promise<{ amount: number }> {
        return this.service.acceptTerms(
            this.senderTransport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge,
            amount
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
