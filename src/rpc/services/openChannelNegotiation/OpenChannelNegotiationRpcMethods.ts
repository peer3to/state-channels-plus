import { ethers } from "ethers";

import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import { getChecksumAddress } from "@/utils";
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

    public async negotiateRequest(
        channelId: string,
        amount: number
    ): Promise<void> {
        const from = this.senderTransport.peerAddress
            ? getChecksumAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        const currentChannel = ethers.hexlify(
            this.p2pManager.stateManager.getChannelId()
        );
        if (channelId !== currentChannel) return;

        if (
            this.service.state.negotiatingWith &&
            this.service.state.negotiatingWith !== from
        ) {
            this.remoteRpc.openChannelNegotiationService
                .negotiateBusy()
                .sendOne(from);
            return;
        }

        if (!this.service.state.negotiatingWith) {
            this.service.state.negotiatingWith = from;
            this.service.state.initiatedByMe = false;
            this.service.state.startedAtMs = Date.now();
            this.service.startTimeout();
        }

        this.service.state.theirAmount = amount;

        this.remoteRpc.openChannelNegotiationService
            .negotiateAccept(currentChannel, this.service.state.myAmount)
            .sendOne(from);

        await this.service.maybeProgress(from);
    }

    public async negotiateAccept(
        channelId: string,
        amount: number
    ): Promise<void> {
        const from = this.senderTransport.peerAddress
            ? getChecksumAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        const currentChannel = ethers.hexlify(
            this.p2pManager.stateManager.getChannelId()
        );
        if (channelId !== currentChannel) return;

        if (
            !this.service.state.negotiatingWith ||
            this.service.state.negotiatingWith !== from
        ) {
            return;
        }

        this.service.state.theirAmount = amount;
        await this.service.maybeProgress(from);
    }

    public negotiateBusy(): void {
        const from = this.senderTransport.peerAddress
            ? getChecksumAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        if (this.service.state.negotiatingWith === from) {
            this.service.resetNegotiation(
                "remote busy: negotiating with someone else"
            );
        }
    }

    public async openProposal(
        encodedOpenChannel: string,
        lowerSignature: string
    ): Promise<void> {
        const from = this.senderTransport.peerAddress
            ? getChecksumAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        if (
            this.service.state.negotiatingWith &&
            this.service.state.negotiatingWith !== from
        ) {
            return;
        }

        if (!this.service.state.negotiatingWith) {
            this.service.state.negotiatingWith = from;
            this.service.state.startedAtMs = Date.now();
            this.service.startTimeout();
        }

        this.service.state.receivedProposal = {
            encodedOpenChannel,
            lowerSignature
        };
        await this.service.openProposal(
            from,
            encodedOpenChannel,
            lowerSignature
        );
    }

    public abort(reason: string): void {
        const from = this.senderTransport.peerAddress
            ? getChecksumAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        if (this.service.state.negotiatingWith === from) {
            this.service.resetNegotiation(`remote abort: ${reason}`);
        }
    }
}
