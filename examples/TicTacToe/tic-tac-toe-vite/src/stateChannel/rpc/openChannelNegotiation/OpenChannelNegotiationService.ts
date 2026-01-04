import {
    ARpcService,
    ATransport,
    Codec,
    Clock,
    HandshakeCompletedGuard,
    SignatureUtils,
    Type
} from "@peer3/state-channels-plus";

import type { DataTypes } from "@peer3/state-channels-plus";

import { ethers } from "@peer3/state-channels-plus";
import OpenChannelNegotiationRpcMethods, {
    type NegotiationFactories,
    type NegotiationP2PManager
} from "./OpenChannelNegotiationRpcMethods.ts";

import {
    DEFAULT_JOIN_AMOUNT,
    NEGOTIATION_TIMEOUT_MS,
    compareAddresses,
    normalizeAddress,
    type Address
} from "./OpenChannelNegotiationHelpers";

type NegotiationState = {
    channelOpened?: boolean;
    negotiatingWith?: Address;
    initiatedByMe?: boolean;
    myAmount: number;
    theirAmount?: number;
    proposalSent?: boolean;
    receivedProposal?: {
        encodedOpenChannel: string;
        lowerSignature: string;
    };
    timeoutHandle?: ReturnType<typeof setTimeout>;
    startedAtMs?: number;
};

export default class OpenChannelNegotiationService extends ARpcService<
    OpenChannelNegotiationRpcMethods,
    NegotiationP2PManager
> {
    public state: NegotiationState = {
        myAmount: DEFAULT_JOIN_AMOUNT,
        channelOpened: false
    };

    constructor(p2pManager: NegotiationP2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                module: "OpenChannelNegotiationService"
            })
        );

        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(
        transport: ATransport
    ): OpenChannelNegotiationRpcMethods {
        return new OpenChannelNegotiationRpcMethods(transport, this);
    }

    public async beginNegotiation(peerAddress: Address): Promise<void> {
        if (this.state.channelOpened) {
            return;
        }

        const peer = normalizeAddress(peerAddress);
        const me = normalizeAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        if (peer === me) return;

        // If we are already negotiating with someone else, do nothing.
        if (this.state.negotiatingWith) {
            return;
        }

        this.state.negotiatingWith = peer;
        this.state.initiatedByMe = true;
        this.state.startedAtMs = Date.now();
        this.startTimeout();

        const channelId = ethers.hexlify(
            this.p2pManager.stateManager.getChannelId()
        );

        this.remoteRpc.openChannelNegotiationService
            .negotiateRequest(channelId, this.state.myAmount)
            .sendOne(peer);
    }

    public startTimeout(): void {
        this.clearTimeout();
        this.state.timeoutHandle = setTimeout(() => {
            const peer = this.state.negotiatingWith;
            if (peer) {
                this.remoteRpc.openChannelNegotiationService
                    .abort("timeout")
                    .sendOne(peer);
            }
            this.resetNegotiation("timeout");
        }, NEGOTIATION_TIMEOUT_MS);
    }

    private getParticipantsAndBalances(peerAddress: Address): {
        participants: [Address, Address];
        balances: DataTypes.OpenChannelStruct["balances"];
        lower: Address;
    } {
        const me = normalizeAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const peer = normalizeAddress(peerAddress);

        const [a0, a1] =
            compareAddresses(me, peer) <= 0 ? [me, peer] : [peer, me];
        const lower = a0;

        const theirAmount =
            typeof this.state.theirAmount === "number"
                ? this.state.theirAmount
                : DEFAULT_JOIN_AMOUNT;

        const balances: DataTypes.OpenChannelStruct["balances"] = [
            {
                amount: a0 === me ? this.state.myAmount : theirAmount,
                data: "0x"
            },
            {
                amount: a1 === me ? this.state.myAmount : theirAmount,
                data: "0x"
            }
        ];

        return {
            participants: [a0, a1],
            balances,
            lower
        };
    }

    public async maybeProgress(peerAddress: Address): Promise<void> {
        if (this.state.channelOpened) return;
        if (!this.state.negotiatingWith) return;

        const me = normalizeAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const peer = normalizeAddress(peerAddress);

        const { participants, balances, lower } =
            this.getParticipantsAndBalances(peer);

        // If channel already open, finalize.
        const channelId = this.p2pManager.stateManager.getChannelId();
        const alreadyOpen =
            await this.p2pManager.stateManager.stateChannelManagerContract.isChannelOpen(
                channelId
            );
        if (alreadyOpen) {
            this.state.channelOpened = true;
            this.resetNegotiation("channel already open");
            return;
        }

        const isLower = me === lower;
        const haveAmounts = typeof this.state.theirAmount === "number";

        // Only the lower-address peer should progress negotiation via maybeProgress.
        if (!isLower) return;

        // Lower-address peer sends proposal once both amounts known.
        if (haveAmounts && !this.state.proposalSent) {
            const deadlineTimestamp = Clock.getTimeInSeconds() + 60;
            const openChannel: DataTypes.OpenChannelStruct = {
                channelId,
                participants,
                balances,
                deadlineTimestamp,
                isAtomic: true,
                data: "0x"
            };

            const { encoded, signature } = await SignatureUtils.signOpenChannel(
                openChannel,
                this.p2pManager.stateManager.signer
            );

            this.remoteRpc.openChannelNegotiationService
                .openProposal(encoded.toString(), signature.toString())
                .sendOne(peer);

            this.state.proposalSent = true;
            // Schedule a single deadline-based check (no polling).
            this.scheduleDeadlineCheck(deadlineTimestamp, peer);
            return;
        }
    }

    public async openProposal(
        peerAddress: Address,
        encodedOpenChannel: string,
        lowerSignature: string
    ): Promise<void> {
        if (this.state.channelOpened) return;

        const peer = normalizeAddress(peerAddress);
        const me = normalizeAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        if (peer === me) return;

        // Record proposal (optional, but useful for debugging/state).
        this.state.receivedProposal = { encodedOpenChannel, lowerSignature };

        // Ensure we have a negotiation context.
        if (!this.state.negotiatingWith) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            this.resetNegotiation("openProposal - no negotiation in progress");
            return;
        }

        const { lower } = this.getParticipantsAndBalances(peer);
        const isLower = me === lower;

        // openProposal should only be processed by the higher-address peer.
        if (isLower) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            this.resetNegotiation("openProposal - lower address called");
            return;
        }

        const decoded = Codec.decode(
            encodedOpenChannel,
            Type.OpenChannel
        ) as DataTypes.OpenChannelStruct;
        const deadlineSeconds = Number(decoded.deadlineTimestamp);

        // Verify proposal signature came from the lower address.
        const recovered = normalizeAddress(
            SignatureUtils.getSignerAddress(
                encodedOpenChannel,
                lowerSignature
            ).toString()
        );
        if (recovered !== lower) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            this.resetNegotiation("invalid lower signature");
            return;
        }

        const { signature } = await SignatureUtils.signOpenChannel(
            decoded,
            this.p2pManager.stateManager.signer
        );

        try {
            await this.p2pManager.stateManager.stateChannelManagerContract.open(
                {
                    encodedOpenChannel,
                    signatures: [lowerSignature, signature.toString()]
                }
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.remoteRpc.openChannelNegotiationService
                .abort(`open failed: ${msg}`)
                .sendOne(peer);
            this.resetNegotiation("open tx failed");
        }
    }

    public scheduleDeadlineCheck(
        deadlineTimestampSeconds: number,
        peerAddress: Address
    ): void {
        this.clearTimeout();

        if (this.state.channelOpened) {
            return;
        }

        const now = Clock.getTimeInSeconds();
        const agreementTimeSeconds = Number(
            this.p2pManager.stateManager.timeConfig.agreementTime
        );
        const sleepSeconds =
            deadlineTimestampSeconds > now
                ? deadlineTimestampSeconds - now + agreementTimeSeconds
                : agreementTimeSeconds;

        peerAddress = normalizeAddress(peerAddress);

        this.state.timeoutHandle = setTimeout(async () => {
            try {
                const channelId = this.p2pManager.stateManager.getChannelId();
                const isOpen =
                    await this.p2pManager.stateManager.stateChannelManagerContract.isChannelOpen(
                        channelId
                    );
                if (isOpen) {
                    this.state.channelOpened = true;
                    this.resetNegotiation("channel opened");
                    return;
                }

                const provider = this.p2pManager.stateManager.signer.provider;
                if (!provider) {
                    this.logger.error(
                        "scheduleDeadlineCheck: missing provider; cannot query chain timestamp"
                    );
                    throw new Error(
                        "OpenChannelNegotiation: missing provider for deadline check"
                    );
                }

                const block = await provider.getBlock("latest");
                const blockTimestampSeconds = Number(
                    (block?.timestamp ?? 0).toString()
                );

                if (blockTimestampSeconds > deadlineTimestampSeconds) {
                    this.remoteRpc.openChannelNegotiationService
                        .abort("deadline passed and channel not opened")
                        .sendOne(peerAddress);
                    this.resetNegotiation("deadline passed");
                }
            } catch {
                // best-effort
            }
        }, sleepSeconds * 1000);
    }

    private clearTimeout(): void {
        if (this.state.timeoutHandle) clearTimeout(this.state.timeoutHandle);
        this.state.timeoutHandle = undefined;
    }

    public resetNegotiation(reason: string): void {
        this.logger.info(`Negotiation reset: ${reason}`);
        this.clearTimeout();
        this.state = {
            myAmount: this.state.myAmount,
            channelOpened: this.state.channelOpened ?? false
        };
    }
}

export type { NegotiationFactories };
