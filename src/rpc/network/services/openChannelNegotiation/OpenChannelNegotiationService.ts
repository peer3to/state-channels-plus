import {
    DEFAULT_JOIN_AMOUNT,
    OPEN_CHANNEL_DEADLINE_SECONDS,
    OPEN_CHANNEL_MIN_REMAINING_SECONDS,
    compareAddresses,
    deriveNegotiatedChannelId,
    getOpenChannelProposalMismatch,
    type Address
} from "./OpenChannelNegotiationHelpers";
import OpenChannelNegotiationRpcMethods, {
    type OpenChannelNegotiationP2PManager
} from "./OpenChannelNegotiationRpcMethods";
import Clock from "@/Clock";
import { DisconnectPolicy } from "@/DisconnectPolicy";

import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import {
    DeferredAdmissionGuard,
    HandshakeCompletedGuard,
    type DeferredAdmissionPolicy
} from "@/rpc/network/guards";
import type {
    LobbyMatch,
    LobbyJoinResult
} from "@/rpc/network/services/lobbyMatching/LobbyMatchingTypes";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";
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
import { requireBytes32 } from "@/utils/bytes32";
import { errorMessage } from "@/utils/errorMessage";
import type {
    BalanceStruct,
    OpenChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers, ZeroHash, type BytesLike } from "ethers";

type MatchedAttempt = LobbyMatch & {
    mode: NegotiationMode;
    channelId: string;
    peerAddress: Address;
    myBalance: BalanceStruct;
    theirBalance?: BalanceStruct;
    acceptedProposal?: {
        encodedOpenChannel: string;
        lowerSignature: string;
        higherSignature: string;
    };
    localOpeningSignatureIssued: boolean;
    proposalRequestInFlight: boolean;
    openingSubmissionStarted: boolean;
    observedOpenHandoff: boolean;
    /** This runtime's ChannelOpened handling (genesis install) finished. */
    ownGenesisInstalled: boolean;
    classifyObservedOpening?: Promise<void>;
    timeoutHandle?: ReturnType<typeof setTimeout>;
    unsubscribeDisconnected?: () => void;
    unsubscribeChannelOpened?: () => void;
    outcomePromise: Promise<NegotiationOutcome>;
    resolveOutcome: (outcome: NegotiationOutcome) => void;
};

export type NegotiationOutcome =
    | { status: "opened"; result: LobbyJoinResult }
    | { status: "observed-target-open"; channelId: string }
    | { status: "retry" | "targeted-failed" | "cancelled" };

export type NegotiationMode = "ordinary" | "targeted";

export type MatchedNegotiationOptions = {
    mode?: NegotiationMode;
    balance?: BalanceStruct;
    channelId?: string;
};

export type NegotiationState = {
    myBalance: BalanceStruct;
    attempt?: MatchedAttempt;
    channelOpened: boolean;
};

class NegotiationAdmissionPolicy implements DeferredAdmissionPolicy {
    constructor(
        private readonly service: OpenChannelNegotiationService,
        private readonly readiness: EventBarrier
    ) {}

    isReady(rpc: Rpc, transport: NetworkTransport): boolean {
        return this.service.isRpcAdmitted(rpc, transport);
    }

    canDefer(_rpc: Rpc, transport: NetworkTransport): boolean {
        return (
            !!transport.peerAddress &&
            this.service.p2pManager.localRpc.lobbyMatchingService.ownsNegotiationPeer(
                transport
            ) &&
            !this.service.state.attempt
        );
    }

    async waitUntilReady(
        transport: NetworkTransport,
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

    onRejected(_rpc: Rpc, transport: NetworkTransport): void {
        this.service.rejectProtocolTransport(transport);
    }

    onExpired(_rpc: Rpc, transport: NetworkTransport): void {
        this.service.rejectProtocolTransport(transport);
    }
}

export default class OpenChannelNegotiationService extends ANetworkRpcService<
    OpenChannelNegotiationRpcMethods,
    OpenChannelNegotiationP2PManager
> {
    public state: NegotiationState = {
        myBalance: { amount: DEFAULT_JOIN_AMOUNT, data: "0x" },
        channelOpened: false
    };
    private readonly readiness: EventBarrier;

    constructor(p2pManager: OpenChannelNegotiationP2PManager) {
        super(
            p2pManager.rpcRouter,
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
        transport: NetworkTransport
    ): OpenChannelNegotiationRpcMethods {
        return new OpenChannelNegotiationRpcMethods(transport, this);
    }

    /**
     * Application opening data placed in `OpenChannel.data` and handed to the
     * consumer facet's genesis hook on-chain. The default root opens with no
     * data. A custom root overrides this to supply its genesis; the result
     * MUST be a pure function of the agreed channel, participants, and
     * balances, because the lower address builds the proposal with it and the
     * higher address rebuilds it independently and rejects any proposal whose
     * data differs.
     */
    protected async buildOpeningData(
        _terms: Pick<
            OpenChannelStruct,
            "channelId" | "participants" | "balances"
        >
    ): Promise<BytesLike> {
        return "0x";
    }

    public async initMatchedNegotiation(
        match: LobbyMatch,
        options: MatchedNegotiationOptions = {}
    ): Promise<NegotiationOutcome> {
        if (this.state.attempt) {
            throw new Error("A matched negotiation is already active");
        }
        const me = this.p2pManager.stateManager.checksumSignerAddress;
        const peer = getChecksumAddress(match.peerAddress);
        if (peer === me) throw new Error("Cannot negotiate with self");
        const mode = options.mode ?? "ordinary";
        const balance = options.balance ?? {
            amount: DEFAULT_JOIN_AMOUNT,
            data: "0x"
        };
        await this.p2pManager.stateManager.diamondStateMachine.requirePositiveBalance(
            balance,
            "local opening balance"
        );
        this.state.myBalance = balance;
        const channelId =
            mode === "targeted"
                ? this.requireTargetChannelId(options.channelId)
                : deriveNegotiatedChannelId(match);
        const [alreadyOpen] =
            await this.p2pManager.stateManager.stateChannelManagerContract.isChannelOpen(
                channelId
            );
        if (alreadyOpen) {
            if (mode === "targeted") {
                return { status: "observed-target-open", channelId };
            }
            // A peer that matched us into an already-open channel has a stale
            // view, not a fault: close without a strike.
            this.p2pManager.disconnectConnection(peer, DisconnectPolicy.ALLOW);
            await this.p2pManager.stateManager.clearChannelId();
            return { status: "retry" };
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
            mode,
            peerAddress: peer,
            channelId,
            myBalance: balance,
            localOpeningSignatureIssued: false,
            proposalRequestInFlight: false,
            openingSubmissionStarted: false,
            observedOpenHandoff: false,
            ownGenesisInstalled: false,
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
        void this.readiness.signal();

        if (compareAddresses(me, peer) < 0) {
            void this.runLowerAddressNegotiation(attempt);
        } else {
            this.startInitiatorDeadline(attempt);
        }
        return attempt.outcomePromise;
    }

    public async dispose(): Promise<void> {
        const attempt = this.state.attempt;
        if (!attempt) return;
        await this.clearAttempt(attempt, "runtime disposed", "cancelled");
    }

    private observeChannelOpened(channelId: string): void {
        const attempt = this.state.attempt;
        if (!attempt || attempt.channelId !== channelId) return;
        this.state.channelOpened = true;
        attempt.ownGenesisInstalled = true;
        attempt.classifyObservedOpening = this.classifyObservedOpening(attempt);
    }

    public isRpcAdmitted(rpc: Rpc, transport: NetworkTransport): boolean {
        return (
            this.findCommittedAttempt(
                transport,
                rpc.params[0],
                rpc.params[1],
                rpc.params[2]
            ) !== undefined
        );
    }

    public async acceptTerms(
        transport: NetworkTransport,
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string,
        encodedBalance: string
    ): Promise<{ encodedBalance: string }> {
        const attempt = this.requireAttempt(
            transport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge
        );
        let balance: BalanceStruct;
        try {
            balance = Codec.decode(encodedBalance, Type.Balance);
            await this.p2pManager.stateManager.diamondStateMachine.requirePositiveBalance(
                balance,
                "remote opening balance"
            );
        } catch {
            this.protocolFailure(attempt, "invalid opening balance");
            throw new Error("Invalid opening balance");
        }
        if (attempt.theirBalance !== undefined) {
            if (!this.balancesMatch(attempt.theirBalance, balance)) {
                this.protocolFailure(attempt, "conflicting opening balance");
                throw new Error("Conflicting opening balance");
            }
            return {
                encodedBalance: String(
                    Codec.encode(attempt.myBalance, Type.Balance)
                )
            };
        }
        await this.selectAttemptChannel(attempt);
        attempt.theirBalance = balance;
        this.clearAttemptTimeout(attempt);
        return {
            encodedBalance: String(
                Codec.encode(attempt.myBalance, Type.Balance)
            )
        };
    }

    public async acceptOpenProposal(
        transport: NetworkTransport,
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
            attempt.theirBalance === undefined
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
        let expectedData: BytesLike;
        try {
            expectedData = await this.buildOpeningData({
                channelId: attempt.channelId,
                participants,
                balances
            });
        } catch (error) {
            // A local failure to derive the terms is not the peer's fault.
            await this.clearAttempt(
                attempt,
                `opening data unavailable: ${errorMessage(error)}`,
                this.failureOutcome(attempt)
            );
            throw new Error("Opening data unavailable");
        }
        if (this.state.attempt !== attempt) {
            return { status: "submitted" };
        }
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
            {
                channelId: attempt.channelId,
                participants,
                balances,
                data: expectedData
            },
            {
                minSeconds: nowSeconds + OPEN_CHANNEL_MIN_REMAINING_SECONDS,
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
        if (this.state.channelOpened) {
            await attempt.classifyObservedOpening;
        }
        if (this.state.attempt !== attempt || attempt.observedOpenHandoff) {
            return { status: "submitted" };
        }
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
        attempt.openingSubmissionStarted = true;
        try {
            const tx = await this.submitOpening(
                encodedOpenChannel,
                lowerSignature,
                attempt.acceptedProposal.higherSignature
            );
            if (this.state.attempt !== attempt) {
                return { status: "submitted" };
            }
            DetachedPromises.collect(this.observeOpeningReceipt(attempt, tx));
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom?.name === "RaceConditionChannelAlreadyOpen") {
                if (attempt.mode === "targeted") {
                    await this.completeObservedTargetOpen(attempt);
                } else {
                    this.protocolFailure(
                        attempt,
                        "ordinary negotiated channel opened before submission"
                    );
                }
            } else {
                throw error;
            }
        }
        return { status: "submitted" };
    }

    public acceptAbort(
        transport: NetworkTransport,
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
        this.remoteAbort(attempt, `remote abort: ${reason}`);
    }

    public rejectProtocolTransport(transport: NetworkTransport): void {
        const profile =
            this.p2pManager.profileManager.getProfileByTransport(transport);
        if (
            transport.isClosed ||
            (profile && !profile.hasLiveTransport(transport))
        ) {
            return;
        }
        this.p2pManager.disconnectConnection(
            transport,
            DisconnectPolicy.BLACKLIST
        );
    }

    private async runLowerAddressNegotiation(
        attempt: MatchedAttempt
    ): Promise<void> {
        try {
            await this.selectAttemptChannel(attempt);
            if (this.state.attempt !== attempt) return;
            const terms = await this.remoteRpc.openChannelNegotiationService
                .exchangeTerms(
                    attempt.attemptNonce,
                    attempt.selectorChallenge,
                    attempt.advertiserChallenge,
                    String(Codec.encode(attempt.myBalance, Type.Balance))
                )
                .request(attempt.peerAddress, {
                    timeoutMs:
                        this.p2pManager.stateManager.timeConfig.agreementTime *
                        2 *
                        1000
                });
            if (this.state.attempt !== attempt) return;
            let theirBalance: BalanceStruct;
            try {
                theirBalance = Codec.decode(terms.encodedBalance, Type.Balance);
                await this.p2pManager.stateManager.diamondStateMachine.requirePositiveBalance(
                    theirBalance,
                    "remote opening balance"
                );
            } catch {
                this.protocolFailure(attempt, "invalid opening balance");
                return;
            }
            attempt.theirBalance = theirBalance;
            const { participants, balances } =
                this.getParticipantsAndBalances(attempt);
            let data: BytesLike;
            try {
                data = await this.buildOpeningData({
                    channelId: attempt.channelId,
                    participants,
                    balances
                });
            } catch (error) {
                // A local failure to derive the terms is not the peer's fault;
                // the peer's initiator deadline releases its side.
                await this.clearAttempt(
                    attempt,
                    `opening data unavailable: ${errorMessage(error)}`,
                    this.failureOutcome(attempt)
                );
                return;
            }
            if (this.state.attempt !== attempt) return;
            const deadlineTimestamp =
                Clock.getTimeInSeconds() + OPEN_CHANNEL_DEADLINE_SECONDS;
            const openChannel: OpenChannelStruct = {
                channelId: attempt.channelId,
                participants,
                balances,
                deadlineTimestamp,
                isAtomic: true,
                data
            };
            const { encoded, signature } = await SignatureUtils.signOpenChannel(
                openChannel,
                this.p2pManager.stateManager.signer
            );
            attempt.localOpeningSignatureIssued = true;
            this.scheduleDeadlineObservation(attempt, deadlineTimestamp);
            attempt.proposalRequestInFlight = true;
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
            attempt.proposalRequestInFlight = false;
            if (this.state.attempt === attempt && this.state.channelOpened) {
                await this.classifyObservedOpening(attempt);
            }
        } catch (error) {
            attempt.proposalRequestInFlight = false;
            if (this.state.attempt === attempt) {
                if (this.state.channelOpened && attempt.mode === "targeted") {
                    await this.completeObservedTargetOpen(attempt);
                    return;
                }
                if (attempt.localOpeningSignatureIssued) {
                    this.logger.warn(
                        "Opening proposal request failed after local signing; awaiting chain observation",
                        {
                            peerAddress: attempt.peerAddress,
                            error: errorMessage(error)
                        }
                    );
                } else {
                    if (attempt.mode === "targeted") {
                        await this.clearAttempt(
                            attempt,
                            errorMessage(error),
                            "targeted-failed"
                        );
                    } else {
                        this.protocolFailure(attempt, errorMessage(error));
                    }
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
                        attempt.theirBalance === undefined
                    ) {
                        this.lifecycleFailure(
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
        if (this.state.attempt !== attempt) return;
        const selected = String(this.p2pManager.stateManager.channelId);
        if (selected === attempt.channelId) return;
        if (selected !== ZeroHash) {
            throw new Error("A different channel is already selected");
        }
        await this.p2pManager.stateManager.setChannelId(attempt.channelId);
        // cleared while selecting -> the clear owns channel and status
        if (this.state.attempt !== attempt) return;
        this.p2pManager.stateManager.setStatus(Status.NOT_OPENED);
    }

    private async submitOpening(
        encodedOpenChannel: string,
        lowerSignature: string,
        higherSignature: string
    ) {
        return this.p2pManager.stateManager.stateChannelManagerContract.open(
            {
                encodedOpenChannel,
                signatures: [lowerSignature, higherSignature]
            },
            { gasLimit: 3_000_000 }
        );
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
                        await this.classifyObservedOpening(attempt);
                        return;
                    }
                    const me =
                        this.p2pManager.stateManager.checksumSignerAddress;
                    if (compareAddresses(me, attempt.peerAddress) < 0) {
                        // A burned opening window is not proven misbehaviour:
                        // it spends the higher peer's shared retry bound.
                        this.closeAttemptPeer(
                            attempt,
                            DisconnectPolicy.allowRetry()
                        );
                    }
                    await this.clearAttempt(
                        attempt,
                        "opening payload expired",
                        this.failureOutcome(attempt)
                    );
                },
                delayMs,
                "opening payload expiry observation"
            );
    }

    private onCommittedPeerDisconnected(attempt: MatchedAttempt): void {
        if (this.state.attempt !== attempt) return;
        if (attempt.mode === "ordinary") {
            // Losing the committed peer mid-negotiation is a lifecycle event
            // (closed tab, lost link): one strike against its identity, no
            // verdict. There is no transport left to close.
            this.p2pManager.disconnectConnection(
                attempt.peerAddress,
                DisconnectPolicy.allowRetry()
            );
        }
        if (!attempt.localOpeningSignatureIssued) {
            void this.clearAttempt(
                attempt,
                "committed peer disconnected",
                this.failureOutcome(attempt)
            );
        }
    }

    /**
     * Every close this service makes against the committed peer goes through
     * here: the close is ours, not a loss of the peer, so the disconnect
     * observer is detached first and cannot turn it into a second strike.
     */
    private closeAttemptPeer(
        attempt: MatchedAttempt,
        policy: DisconnectPolicy,
        reason?: string
    ): void {
        attempt.unsubscribeDisconnected?.();
        attempt.unsubscribeDisconnected = undefined;
        this.p2pManager.disconnectConnection(
            attempt.peerAddress,
            policy,
            reason
        );
    }

    /** A negotiation step the peer got wrong. Objective fault: blacklist. */
    private protocolFailure(attempt: MatchedAttempt, reason: string): void {
        this.logger.warn("Matched negotiation failed", {
            peerAddress: attempt.peerAddress,
            reason
        });
        this.closeAttemptPeer(attempt, DisconnectPolicy.BLACKLIST, reason);
        this.endFailedAttempt(attempt, reason);
    }

    /**
     * The peer failed a negotiation obligation without proving misbehaviour
     * (silence, a burned window). It spends the peer's shared retry bound.
     */
    private lifecycleFailure(attempt: MatchedAttempt, reason: string): void {
        this.logger.warn("Matched negotiation failed without fault", {
            peerAddress: attempt.peerAddress,
            reason
        });
        this.closeAttemptPeer(attempt, DisconnectPolicy.allowRetry());
        this.endFailedAttempt(attempt, reason);
    }

    /**
     * The peer ended the negotiation with the protocol's own abort message.
     * That is lifecycle, not fault: the connection closes with no strike.
     */
    private remoteAbort(attempt: MatchedAttempt, reason: string): void {
        this.logger.warn("Matched negotiation aborted by peer", {
            peerAddress: attempt.peerAddress,
            reason
        });
        this.closeAttemptPeer(attempt, DisconnectPolicy.ALLOW);
        this.endFailedAttempt(attempt, reason);
    }

    /** Shared tail of both failure paths; a signed attempt keeps running. */
    private endFailedAttempt(attempt: MatchedAttempt, reason: string): void {
        if (!attempt.localOpeningSignatureIssued) {
            void this.clearAttempt(
                attempt,
                reason,
                this.failureOutcome(attempt)
            );
        }
    }

    private detachAttempt(attempt: MatchedAttempt): void {
        this.clearAttemptTimeout(attempt);
        attempt.unsubscribeDisconnected?.();
        attempt.unsubscribeChannelOpened?.();
        this.state.attempt = undefined;
    }

    private failureOutcome(
        attempt: MatchedAttempt
    ): "retry" | "targeted-failed" {
        return attempt.mode === "targeted" ? "targeted-failed" : "retry";
    }

    /**
     * Ends `attempt` only while it is still the current attempt. A failure
     * that settles after its attempt was cancelled or replaced must not
     * clear the newer attempt or resolve it with the old outcome.
     */
    private async clearAttempt(
        attempt: MatchedAttempt,
        reason: string,
        outcome: "retry" | "targeted-failed" | "cancelled"
    ): Promise<void> {
        if (this.state.attempt !== attempt) return;
        this.logger.info("Negotiation attempt cleared", { reason });
        this.detachAttempt(attempt);
        if (attempt.mode === "ordinary") {
            await this.p2pManager.stateManager.clearChannelId();
            if (!this.p2pManager.stateManager.isDisposed) {
                this.p2pManager.stateManager.setStatus(
                    this.p2pManager.localRpc.lobbyMatchingService
                        .rendezvousTopic
                        ? Status.DISCOVERING
                        : Status.NOT_OPENED
                );
            }
        }
        attempt.resolveOutcome({ status: outcome });
    }

    private completeOpenedAttempt(attempt: MatchedAttempt): void {
        if (this.state.attempt !== attempt) return;
        this.detachAttempt(attempt);
        attempt.resolveOutcome({
            status: "opened",
            result: {
                channelId: attempt.channelId,
                peerAddress: attempt.peerAddress
            }
        });
    }

    private async completeObservedTargetOpen(
        attempt: MatchedAttempt
    ): Promise<void> {
        if (
            this.state.attempt !== attempt ||
            attempt.mode !== "targeted" ||
            attempt.observedOpenHandoff
        ) {
            return;
        }
        attempt.observedOpenHandoff = true;
        this.detachAttempt(attempt);
        attempt.resolveOutcome({
            status: "observed-target-open",
            channelId: attempt.channelId
        });
    }

    private async classifyObservedOpening(
        attempt: MatchedAttempt
    ): Promise<void> {
        if (this.state.attempt !== attempt) return;
        let participants: string[];
        try {
            participants = (
                await this.p2pManager.stateManager.stateChannelManagerContract.getParticipants(
                    attempt.channelId
                )
            ).map((participant) => getChecksumAddress(String(participant)));
        } catch {
            return;
        }
        if (this.state.attempt !== attempt) return;
        const me = this.p2pManager.stateManager.checksumSignerAddress;
        if (
            participants.includes(me) &&
            participants.includes(attempt.peerAddress)
        ) {
            // A founder completes, and so announces, only after its own
            // genesis is installed; before that its runtime would act as an
            // observer and wait for an initial sync. The ChannelOpened
            // handling classifies again once the genesis is in.
            if (!attempt.ownGenesisInstalled) return;
            this.completeOpenedAttempt(attempt);
            return;
        }
        if (attempt.mode === "targeted") {
            await this.completeObservedTargetOpen(attempt);
            return;
        }
        this.protocolFailure(
            attempt,
            "ordinary negotiated channel opened by another participant set"
        );
        await this.clearAttempt(
            attempt,
            "ordinary negotiated channel opened before completion",
            "retry"
        );
    }

    private async observeOpeningReceipt(
        attempt: MatchedAttempt,
        tx: { wait(): Promise<unknown> }
    ): Promise<void> {
        try {
            await tx.wait();
            // The landed opening completes from this runtime's ChannelOpened
            // handling; marking the founder OPENED here would make it an
            // observer.
        } catch (error) {
            if (this.state.attempt !== attempt) return;
            if (attempt.mode === "targeted") {
                await this.p2pManager.stateManager.refreshOpenedStatusFromChain();
                if (this.p2pManager.stateManager.status !== Status.NOT_OPENED) {
                    await this.completeObservedTargetOpen(attempt);
                    return;
                }
                await this.clearAttempt(
                    attempt,
                    "targeted opening receipt failed",
                    "targeted-failed"
                );
                throw error;
            }
            // The receipt may have failed on our own chain provider, so the
            // peer is closed without a strike.
            this.closeAttemptPeer(attempt, DisconnectPolicy.ALLOW);
            await this.clearAttempt(
                attempt,
                "ordinary opening receipt failed",
                "retry"
            );
            throw error;
        }
    }

    private findCommittedAttempt(
        transport: NetworkTransport,
        attemptNonce: unknown,
        selectorChallenge: unknown,
        advertiserChallenge: unknown
    ): MatchedAttempt | undefined {
        const attempt = this.state.attempt;
        const peer = transport.peerAddress
            ? getChecksumAddress(transport.peerAddress)
            : undefined;
        return attempt &&
            peer === attempt.peerAddress &&
            attemptNonce === attempt.attemptNonce &&
            selectorChallenge === attempt.selectorChallenge &&
            advertiserChallenge === attempt.advertiserChallenge
            ? attempt
            : undefined;
    }

    private requireAttempt(
        transport: NetworkTransport,
        attemptNonce: string,
        selectorChallenge: string,
        advertiserChallenge: string
    ): MatchedAttempt {
        const attempt = this.findCommittedAttempt(
            transport,
            attemptNonce,
            selectorChallenge,
            advertiserChallenge
        );
        if (!attempt) {
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
        const theirBalance = attempt.theirBalance ?? {
            amount: DEFAULT_JOIN_AMOUNT,
            data: "0x"
        };
        return {
            participants: [lower, higher],
            balances: [
                lower === me ? attempt.myBalance : theirBalance,
                higher === me ? attempt.myBalance : theirBalance
            ],
            lower
        };
    }

    private balancesMatch(a: BalanceStruct, b: BalanceStruct): boolean {
        return (
            BigInt(a.amount) === BigInt(b.amount) &&
            ethers.hexlify(a.data) === ethers.hexlify(b.data)
        );
    }

    private requireTargetChannelId(channelId?: string): string {
        requireBytes32(
            channelId,
            "Targeted negotiation requires a bytes32 channel ID"
        );
        const normalized = ethers.hexlify(channelId);
        if (
            ethers.hexlify(String(this.p2pManager.stateManager.channelId)) !==
            normalized
        ) {
            throw new Error(
                "Targeted negotiation channel does not match selection"
            );
        }
        return normalized;
    }

    private clearAttemptTimeout(attempt: MatchedAttempt): void {
        if (!attempt.timeoutHandle) return;
        this.p2pManager.stateManager.timeoutManager.cancelTask(
            attempt.timeoutHandle
        );
        attempt.timeoutHandle = undefined;
    }
}
