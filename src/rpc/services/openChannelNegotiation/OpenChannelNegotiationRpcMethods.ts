import type OpenChannelNegotiationService from "./OpenChannelNegotiationService";
import type P2PManager from "@/P2PManager";
import ARpcMethods from "@/rpc/ARpcMethods";
import type MainRpcService from "@/rpc/MainRpcService";
import type ATransport from "@/transport/ATransport";

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
