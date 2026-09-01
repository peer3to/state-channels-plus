import { ethers, ZeroHash } from "ethers";

import Clock from "@/Clock";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import ARpcService from "@/rpc/ARpcService";
import type Rpc from "@/rpc/Rpc";
import {
    DeferredAdmissionGuard,
    HandshakeCompletedGuard,
    type DeferredAdmissionPolicy
} from "@/rpc/guards";
import type ATransport from "@/transport/ATransport";
import { Status } from "@/types";
import {
    Codec,
    DetachedPromises,
    EventBarrier,
    SignatureUtils,
    Type,
    getChecksumAddress,
    tryDecodeCustomError
} from "@/utils";
import type { LobbyMatch } from "@/rpc/services/lobbyMatching/LobbyMatchingTypes";
import type {
    LobbyJoinOptions,
    LobbyJoinResult
} from "@/rpc/services/lobbyMatching/LobbyMatchingTypes";

import OpenChannelNegotiationRpcMethods, {
    type OpenChannelNegotiationP2PManager
} from "./OpenChannelNegotiationRpcMethods";
import {
    DEFAULT_JOIN_AMOUNT,
    OPEN_CHANNEL_DEADLINE_SECONDS,
    compareAddresses,
    deriveNegotiatedChannelId,
    getOpenChannelProposalMismatch,
    type Address
} from "./OpenChannelNegotiationHelpers";

type MatchedAttempt = LobbyMatch & {
    channelId: string;
    peerAddress: Address;
    theirAmount?: number;
    acceptedProposal?: {
        encodedOpenChannel: string;
        lowerSignature: string;
        higherSignature: string;
    };
    localOpeningSignatureIssued: boolean;
    timeoutHandle?: ReturnType<typeof setTimeout>;
    unsubscribeDisconnected?: () => void;
    unsubscribeChannelOpened?: () => void;
    outcomePromise: Promise<NegotiationOutcome>;
    resolveOutcome: (outcome: NegotiationOutcome) => void;
};

export type NegotiationOutcome =
    | { status: "opened"; result: LobbyJoinResult }
    | { status: "retry" | "cancelled" };

export type NegotiationState = {
    myAmount: number;
    attempt?: MatchedAttempt;
    channelOpened: boolean;
};

class NegotiationAdmissionPolicy implements DeferredAdmissionPolicy {
    constructor(
        private readonly service: OpenChannelNegotiationService,
        private readonly readiness: EventBarrier
    ) {}

    isReady(rpc: Rpc, transport: ATransport): boolean {
        return this.service.isRpcAdmitted(rpc, transport);
    }

    canDefer(_rpc: Rpc, transport: ATransport): boolean {
        return (
            !!transport.peerAddress &&
            this.service.p2pManager.stateManager.status ===
                Status.DISCOVERING &&
            !this.service.state.attempt
        );
    }

    async waitUntilReady(
        transport: ATransport,
        timeoutMs: number
    ): Promise<boolean> {
        try {
            await this.readiness.waitFor(
                () => !!this.service.state.attempt && !transport.isClosed,
                {
                    timeoutMs,
                    timeoutMessage: "Matched negotiation was not initialized",
                    label: "OpenChannelNegotiation deferred admission"
                }
            );
            return true;
        } catch {
            return false;
        }
    }

    onRejected(_rpc: Rpc, transport: ATransport): void {
        this.service.rejectProtocolTransport(transport);
    }

    onExpired(_rpc: Rpc, transport: ATransport): void {
        this.service.rejectProtocolTransport(transport);
    }
}

export default class OpenChannelNegotiationService extends ARpcService<
    OpenChannelNegotiationRpcMethods,
    OpenChannelNegotiationP2PManager
> {
    public state: NegotiationState = {
        myAmount: DEFAULT_JOIN_AMOUNT,
        channelOpened: false
    };
    private readonly readiness: EventBarrier;

    constructor(p2pManager: OpenChannelNegotiationP2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "OpenChannelNegotiationService"
            })
        );
        this.readiness = new EventBarrier(this.logger);
        this.guards = [
            new HandshakeCompletedGuard(this),
            new DeferredAdmissionGuard(
                this,
                new NegotiationAdmissionPolicy(this, this.readiness)
            )
        ];
    }

    public createRPCMethods(
        transport: ATransport
    ): OpenChannelNegotiationRpcMethods {
        return new OpenChannelNegotiationRpcMethods(transport, this);
    }

    public async initMatchedNegotiation(
        match: LobbyMatch,
        options: LobbyJoinOptions = {}
    ): Promise<void> {
        if (this.state.attempt) {
            throw new Error("A matched negotiation is already active");
        }
        const me = this.p2pManager.stateManager.checksumSignerAddress;
        const peer = getChecksumAddress(match.peerAddress);
        if (peer === me) throw new Error("Cannot negotiate with self");
        const amount = options.amount ?? DEFAULT_JOIN_AMOUNT;
        if (!Number.isSafeInteger(amount) || amount < 0) {
            throw new Error("Invalid local opening amount");
        }
        this.state.myAmount = amount;
        const channelId = deriveNegotiatedChannelId(match);
        const [alreadyOpen] =
            await this.p2pManager.stateManager.stateChannelManagerContract.isChannelOpen(
                channelId
            );
        if (alreadyOpen) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            throw new Error("Negotiated channel ID is already open");
        }

        const profile =
            this.p2pManager.profileManager.getProfileByEvmAddress(peer);
        if (!profile) throw new Error("Matched peer is not connected");
        let resolveOutcome!: (outcome: NegotiationOutcome) => void;
        const outcomePromise = new Promise<NegotiationOutcome>((resolve) => {
            resolveOutcome = resolve;
        });
        const attempt: MatchedAttempt = {
            ...match,
            peerAddress: peer,
            channelId,
            localOpeningSignatureIssued: false,
            outcomePromise,
            resolveOutcome
        };
        attempt.unsubscribeDisconnected = profile.onDisconnected(() =>
            this.onCommittedPeerDisconnected(attempt)
        );
        this.state.attempt = attempt;
        // Reuse the runtime's accepted, deduplicated chain-event pipeline.
        // A second ethers subscription here would duplicate filtering,
        // replay, ordering, and lifecycle cleanup already owned by
        // StateChannelEventListener and EventSyncService.
        attempt.unsubscribeChannelOpened =
            this.p2pManager.stateManager.events.on(
                "eventHandler",
                "onChannelOpened",
                (openedChannelId) =>
                    this.observeChannelOpened(String(openedChannelId))
            );
        this.state.channelOpened = false;
        this.readiness.signal();

        if (compareAddresses(me, peer) < 0) {
            void this.runLowerAddressNegotiation(attempt);
        } else {
            this.startInitiatorDeadline(attempt);
        }
    }

    public waitForOutcome(attemptNonce: string): Promise<NegotiationOutcome> {
        const attempt = this.state.attempt;
        if (!attempt || attempt.attemptNonce !== attemptNonce) {
            throw new Error("Negotiation attempt is not active");
        }
        return attempt.outcomePromise;
    }

    public async dispose(): Promise<void> {
        if (!this.state.attempt) return;
        await this.clearAttempt("runtime disposed", false, false);
    }

    private observeChannelOpened(channelId: string): void {
        const attempt = this.state.attempt;
        if (!attempt || attempt.channelId !== channelId) return;
        this.state.channelOpened = true;
        this.completeOpenedAttempt(attempt);
    }

    public isRpcAdmitted(rpc: Rpc, transport: ATransport): boolean {
        const attempt = this.state.attempt;
        const peer = transport.peerAddress
            ? getChecksumAddress(transport.peerAddress)
            : undefined;
        return (
            !!attempt &&
            peer === attempt.peerAddress &&
            rpc.params[0] === attempt.attemptNonce &&
            rpc.params[1] === attempt.selectorChallenge &&
            rpc.params[2] === attempt.advertiserChallenge
        );
    }

    public async acceptTerms(
        transport: ATransport,
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        amount: number
    ): Promise<{ amount: number }> {
        const attempt = this.requireAttempt(
            transport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge
        );
        if (!Number.isSafeInteger(amount) || amount < 0) {
            this.protocolFailure(attempt, "invalid opening amount");
            throw new Error("Invalid opening amount");
        }
        if (attempt.theirAmount !== undefined) {
            if (attempt.theirAmount !== amount) {
                this.protocolFailure(attempt, "conflicting opening amount");
                throw new Error("Conflicting opening amount");
            }
            return { amount: this.state.myAmount };
        }
        await this.selectAttemptChannel(attempt);
        attempt.theirAmount = amount;
        this.clearAttemptTimeout(attempt);
        return { amount: this.state.myAmount };
    }

    public async acceptOpenProposal(
        transport: ATransport,
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        encodedOpenChannel: string,
        lowerSignature: string
    ): Promise<{ status: "submitted" }> {
        const attempt = this.requireAttempt(
            transport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge
        );
        const peer = attempt.peerAddress;
        const me = this.p2pManager.stateManager.checksumSignerAddress;
        if (
            compareAddresses(me, peer) < 0 ||
            attempt.theirAmount === undefined
        ) {
            this.protocolFailure(attempt, "proposal arrived in invalid state");
            throw new Error("Proposal arrived in invalid state");
        }
        const acceptedProposal = attempt.acceptedProposal;
        if (acceptedProposal) {
            if (
                acceptedProposal.encodedOpenChannel !== encodedOpenChannel ||
                acceptedProposal.lowerSignature !== lowerSignature
            ) {
                this.protocolFailure(attempt, "conflicting open proposal");
                throw new Error("Conflicting open proposal");
            }
            return { status: "submitted" };
        }

        const { participants, balances, lower } =
            this.getParticipantsAndBalances(attempt);
        let decoded: OpenChannelStruct;
        let recovered: Address;
        try {
            decoded = Codec.decode(
                encodedOpenChannel,
                Type.OpenChannel
            ) as OpenChannelStruct;
            recovered = getChecksumAddress(
                SignatureUtils.getSignerAddress(
                    encodedOpenChannel,
                    lowerSignature
                ).toString()
            );
        } catch {
            this.protocolFailure(attempt, "malformed open proposal");
            throw new Error("Malformed open proposal");
        }
        if (recovered !== lower) {
            this.protocolFailure(attempt, "invalid lower signature");
            throw new Error("Invalid lower signature");
        }
        const nowSeconds = Clock.getTimeInSeconds();
        const mismatch = getOpenChannelProposalMismatch(
            decoded,
            { channelId: attempt.channelId, participants, balances },
            {
                nowSeconds,
                maxSeconds: nowSeconds + OPEN_CHANNEL_DEADLINE_SECONDS * 2
            }
        );
        if (mismatch) {
            this.protocolFailure(attempt, `proposal mismatch: ${mismatch}`);
            throw new Error(`Proposal mismatch: ${mismatch}`);
        }

        const { signature } = await SignatureUtils.signOpenChannel(
            decoded,
            this.p2pManager.stateManager.signer
        );
        attempt.localOpeningSignatureIssued = true;
        attempt.acceptedProposal = {
            encodedOpenChannel,
            lowerSignature,
            higherSignature: signature.toString()
        };
        this.scheduleDeadlineObservation(
            attempt,
            Number(decoded.deadlineTimestamp)
        );
        const tx = await this.submitOpening(
            attempt,
            encodedOpenChannel,
            lowerSignature,
            attempt.acceptedProposal.higherSignature
        );
        if (tx) DetachedPromises.collect(tx.wait());
        return { status: "submitted" };
    }

    public acceptAbort(
        transport: ATransport,
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        reason: string
    ): void {
        const attempt = this.requireAttempt(
            transport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge
        );
        this.protocolFailure(attempt, `remote abort: ${reason}`);
    }

    public rejectProtocolTransport(transport: ATransport): void {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);
        if (
            transport.isClosed ||
            (profile && !profile.hasLiveTransport(transport))
        ) {
            return;
        }
        if (transport.peerAddress) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                transport.peerAddress
            );
            return;
        }
        this.p2pManager.disconnectAndBlacklistPeer(transport);
    }

    private async runLowerAddressNegotiation(
        attempt: MatchedAttempt
    ): Promise<void> {
        try {
            await this.selectAttemptChannel(attempt);
            const terms = await this.remoteRpc.openChannelNegotiationService
                .exchangeTerms(
                    attempt.attemptNonce,
                    attempt.selectorChallenge,
                    attempt.advertiserChallenge,
                    this.state.myAmount
                )
                .request(attempt.peerAddress, {
                    timeoutMs:
                        this.p2pManager.stateManager.timeConfig.agreementTime *
                        2 *
                        1000
                });
            if (this.state.attempt !== attempt) return;
            attempt.theirAmount = terms.amount;
            const { participants, balances } =
                this.getParticipantsAndBalances(attempt);
            const deadlineTimestamp =
                Clock.getTimeInSeconds() + OPEN_CHANNEL_DEADLINE_SECONDS;
            const openChannel: OpenChannelStruct = {
                channelId: attempt.channelId,
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
            attempt.localOpeningSignatureIssued = true;
            this.scheduleDeadlineObservation(attempt, deadlineTimestamp);
            await this.remoteRpc.openChannelNegotiationService
                .openProposal(
                    attempt.attemptNonce,
                    attempt.selectorChallenge,
                    attempt.advertiserChallenge,
                    encoded.toString(),
                    signature.toString()
                )
                .request(attempt.peerAddress, {
                    timeoutMs:
                        this.p2pManager.stateManager.timeConfig.agreementTime *
                        2 *
                        1000
                });
        } catch (error) {
            if (this.state.attempt === attempt) {
                if (attempt.localOpeningSignatureIssued) {
                    this.logger.warn(
                        "Opening proposal request failed after local signing; awaiting chain observation",
                        {
                            peerAddress: attempt.peerAddress,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        }
                    );
                } else {
                    this.protocolFailure(
                        attempt,
                        error instanceof Error ? error.message : String(error)
                    );
                }
            }
        }
    }

    private startInitiatorDeadline(attempt: MatchedAttempt): void {
        this.clearAttemptTimeout(attempt);
        attempt.timeoutHandle =
            this.p2pManager.stateManager.timeoutManager.scheduleTask(
                () => {
                    if (
                        this.state.attempt === attempt &&
                        attempt.theirAmount === undefined
                    ) {
                        this.protocolFailure(
                            attempt,
                            "lower-address initiator stayed silent"
                        );
                    }
                },
                this.p2pManager.stateManager.timeConfig.agreementTime *
                    2 *
                    1000,
                "matched negotiation initiator deadline"
            );
    }

    private async selectAttemptChannel(attempt: MatchedAttempt): Promise<void> {
        const selected = String(this.p2pManager.stateManager.channelId);
        if (selected === attempt.channelId) return;
        if (selected !== ZeroHash) {
            throw new Error("A different channel is already selected");
        }
        await this.p2pManager.stateManager.setChannelId(attempt.channelId);
        this.p2pManager.stateManager.setStatus(Status.NOT_OPENED);
    }

    private async submitOpening(
        attempt: MatchedAttempt,
        encodedOpenChannel: string,
        lowerSignature: string,
        higherSignature: string
    ) {
        try {
            return await this.p2pManager.stateManager.stateChannelManagerContract.open(
                {
                    encodedOpenChannel,
                    signatures: [lowerSignature, higherSignature]
                },
                { gasLimit: 3_000_000 }
            );
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom?.name === "RaceConditionChannelAlreadyOpen") {
                return undefined;
            }
            throw error;
        }
    }

    private scheduleDeadlineObservation(
        attempt: MatchedAttempt,
        deadlineTimestamp: number
    ): void {
        this.clearAttemptTimeout(attempt);
        const delayMs =
            Math.max(0, deadlineTimestamp - Clock.getTimeInSeconds()) * 1000 +
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000;
        attempt.timeoutHandle =
            this.p2pManager.stateManager.timeoutManager.scheduleTask(
                async () => {
                    if (this.state.attempt !== attempt) return;
                    const [isOpen] =
                        await this.p2pManager.stateManager.stateChannelManagerContract.isChannelOpen(
                            attempt.channelId
                        );
                    if (isOpen) {
                        this.state.channelOpened = true;
                        this.completeOpenedAttempt(attempt);
                        return;
                    }
                    const me =
                        this.p2pManager.stateManager.checksumSignerAddress;
                    if (compareAddresses(me, attempt.peerAddress) < 0) {
                        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                            attempt.peerAddress
                        );
                    }
                    await this.clearAttempt("opening payload expired", true);
                },
                delayMs,
                "opening payload expiry observation"
            );
    }

    private onCommittedPeerDisconnected(attempt: MatchedAttempt): void {
        if (this.state.attempt !== attempt) return;
        this.p2pManager.profileManager.blacklistPeer(attempt.peerAddress);
        if (!attempt.localOpeningSignatureIssued) {
            void this.clearAttempt("committed peer disconnected", true);
        }
    }

    private protocolFailure(attempt: MatchedAttempt, reason: string): void {
        this.logger.warn("Matched negotiation failed", {
            peerAddress: attempt.peerAddress,
            reason
        });
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            attempt.peerAddress
        );
        if (!attempt.localOpeningSignatureIssued) {
            void this.clearAttempt(reason, true);
        }
    }

    private async clearAttempt(
        reason: string,
        retryDiscovery: boolean,
        restoreDiscovery = true
    ): Promise<void> {
        const attempt = this.state.attempt;
        if (!attempt) return;
        this.logger.info("Negotiation attempt cleared", { reason });
        this.clearAttemptTimeout(attempt);
        attempt.unsubscribeDisconnected?.();
        attempt.unsubscribeChannelOpened?.();
        this.state.attempt = undefined;
        await this.p2pManager.stateManager.clearChannelId();
        if (!this.p2pManager.stateManager.isDisposed) {
            const canRestoreDiscovery =
                restoreDiscovery &&
                !!this.p2pManager.localRpc.lobbyMatchingService.rendezvousTopic;
            this.p2pManager.stateManager.setStatus(
                canRestoreDiscovery ? Status.DISCOVERING : Status.NOT_OPENED
            );
        }
        if (retryDiscovery) {
            const topic =
                this.p2pManager.localRpc.lobbyMatchingService.rendezvousTopic;
            if (topic) {
                await this.p2pManager.localRpc.lobbyMatchingService.releaseNegotiationHandoff(
                    topic
                );
            }
        }
        attempt.resolveOutcome({
            status: retryDiscovery ? "retry" : "cancelled"
        });
    }

    private completeOpenedAttempt(attempt: MatchedAttempt): void {
        if (this.state.attempt !== attempt) return;
        this.clearAttemptTimeout(attempt);
        attempt.unsubscribeDisconnected?.();
        attempt.unsubscribeChannelOpened?.();
        this.state.attempt = undefined;
        attempt.resolveOutcome({
            status: "opened",
            result: {
                channelId: attempt.channelId,
                peerAddress: attempt.peerAddress
            }
        });
    }

    private requireAttempt(
        transport: ATransport,
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string
    ): MatchedAttempt {
        const attempt = this.state.attempt;
        const peer = transport.peerAddress
            ? getChecksumAddress(transport.peerAddress)
            : undefined;
        if (
            !attempt ||
            peer !== attempt.peerAddress ||
            attemptNonce !== attempt.attemptNonce ||
            selectorChallenge !== attempt.selectorChallenge ||
            advertiserChallenge !== attempt.advertiserChallenge
        ) {
            throw new Error("Negotiation attempt does not match commitment");
        }
        return attempt;
    }

    private getParticipantsAndBalances(attempt: MatchedAttempt): {
        participants: [Address, Address];
        balances: OpenChannelStruct["balances"];
        lower: Address;
    } {
        const me = this.p2pManager.stateManager.checksumSignerAddress;
        const peer = attempt.peerAddress;
        const [lower, higher] =
            compareAddresses(me, peer) < 0 ? [me, peer] : [peer, me];
        const theirAmount = attempt.theirAmount ?? DEFAULT_JOIN_AMOUNT;
        return {
            participants: [lower, higher],
            balances: [
                {
                    amount: lower === me ? this.state.myAmount : theirAmount,
                    data: "0x"
                },
                {
                    amount: higher === me ? this.state.myAmount : theirAmount,
                    data: "0x"
                }
            ],
            lower
        };
    }

    private clearAttemptTimeout(attempt: MatchedAttempt): void {
        if (!attempt.timeoutHandle) return;
        this.p2pManager.stateManager.timeoutManager.cancelTask(
            attempt.timeoutHandle
        );
        attempt.timeoutHandle = undefined;
    }
}
