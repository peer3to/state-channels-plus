import { ethers } from "ethers";

import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import { getChecksumAddress } from "@/utils";
import type P2PManager from "@/P2PManager";
import type MainRpcService from "@/rpc/MainRpcService";
import { evaluateAdmission } from "@/discovery/AdmissionPolicy";

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
            this.p2pManager.stateManager.channelId
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

        // Guard before String(amount)/the policy consult: evaluateAmountBounds
        // is a no-op when the policy has no min/max configured (the default),
        // so an unchecked NaN/Infinity/float/negative amount would sail
        // through the consult, get written to state.theirAmount, and later
        // throw unhandled from the ABI encoder in getParticipantsAndBalances
        // (via maybeProgress), wedging the slot for the full timeout. Denying
        // here makes String(amount) total for every downstream comparison.
        if (!Number.isSafeInteger(amount) || amount < 0) {
            this.remoteRpc.openChannelNegotiationService
                .abort("decline:terms")
                .sendOne(from);
            if (this.service.state.negotiatingWith === from) {
                this.service.resetNegotiation(
                    "admission declined: invalid amount"
                );
            }
            return;
        }

        const decision = evaluateAdmission(this.service.admissionPolicy, {
            kind: "negotiate",
            peerAddress: from,
            amount: String(amount),
            channelId
        });
        if (!decision.allow) {
            this.remoteRpc.openChannelNegotiationService
                .abort(`decline:${decision.reason}`)
                .sendOne(from);
            // If we were already negotiating with `from` (crossing/
            // simultaneous initiation, or a policy narrowed mid-negotiation),
            // leaving negotiatingWith set here would keep our single slot +
            // 20s timer armed after WE declined, answering every other peer
            // negotiateBusy for the rest of that window. A fresh slot
            // (negotiatingWith unset) stays byte-identical, per spec.
            if (this.service.state.negotiatingWith === from) {
                this.service.resetNegotiation("admission declined");
            }
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
            this.p2pManager.stateManager.channelId
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

        // An openProposal from a peer we are not already negotiating with
        // must never adopt them as our negotiation partner. In every
        // legitimate ordering negotiatingWith is already set before
        // openProposal arrives, so adoption is never needed by the honest
        // flow — but it let an unsolicited openProposal transiently seize
        // the single negotiation slot and arm a 20s timer, starving a
        // concurrent legitimate negotiateRequest with negotiateBusy
        // (:40-48). Decline without touching any state instead.
        if (this.service.state.negotiatingWith !== from) {
            this.remoteRpc.openChannelNegotiationService
                .abort("decline:policy")
                .sendOne(from);
            return;
        }

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
