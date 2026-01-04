import {
    ARpcMethods,
    ATransport,
    P2PManager
} from "@peer3/state-channels-plus";

import { ethers } from "@peer3/state-channels-plus";

import { normalizeAddress } from "./OpenChannelNegotiationHelpers";

import type OpenChannelNegotiationService from "./OpenChannelNegotiationService.ts";

export type NegotiationFactories = {
    openChannelNegotiationService: (
        p2pManager: P2PManager<NegotiationFactories>
    ) => OpenChannelNegotiationService;
};

export type NegotiationP2PManager = P2PManager<NegotiationFactories>;

export default class OpenChannelNegotiationRpcMethods extends ARpcMethods<NegotiationP2PManager> {
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
            ? normalizeAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        const currentChannel = ethers.hexlify(
            this.p2pManager.stateManager.getChannelId()
        );
        if (channelId !== currentChannel) return;

        // Busy with someone else -> reject.
        if (
            this.service.state.negotiatingWith &&
            this.service.state.negotiatingWith !== from
        ) {
            this.remoteRpc.openChannelNegotiationService
                .negotiateBusy()
                .sendOne(from);
            return;
        }

        // Start or continue negotiation with this sender.
        if (!this.service.state.negotiatingWith) {
            this.service.state.negotiatingWith = from;
            this.service.state.initiatedByMe = false;
            this.service.state.startedAtMs = Date.now();
            this.service.startTimeout();
        }

        this.service.state.theirAmount = amount;

        // Respond with my amount.
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
            ? normalizeAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        const currentChannel = ethers.hexlify(
            this.p2pManager.stateManager.getChannelId()
        );
        if (channelId !== currentChannel) return;

        // If we're not negotiating or negotiating with someone else, ignore.
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
            ? normalizeAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        if (this.service.state.negotiatingWith === from) {
            this.service.resetNegotiation(
                `remote busy: negotiating with someone else`
            );
        }
    }

    public async openProposal(
        encodedOpenChannel: string,
        lowerSignature: string
    ): Promise<void> {
        const from = this.senderTransport.peerAddress
            ? normalizeAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        // Only accept from current counterparty if set.
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
            ? normalizeAddress(this.senderTransport.peerAddress)
            : undefined;
        if (!from) return;

        if (this.service.state.negotiatingWith === from) {
            this.service.resetNegotiation(`remote abort: ${reason}`);
        }
    }

    // helper functions moved to the service
}
