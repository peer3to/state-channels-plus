// @spec-test-coverage-ignore: worker-side support service for mapped opening-data component cases
import type { OpeningDataRpc } from "../OpeningDataRpcManifest";
import {
    deriveOpeningData,
    type OpeningTerms
} from "./OpeningDataNegotiationService";
import { OpeningDataProbeRpcMethods } from "./OpeningDataProbeRpcMethods";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import PeerProfile from "@/PeerProfile";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type { LobbyMatch } from "@/rpc/network/services/lobbyMatching/LobbyMatchingTypes";
import {
    compareAddresses,
    deriveNegotiatedChannelId,
    type Address
} from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import OpenChannelNegotiationService from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService";
import type { NegotiationOutcome } from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService";
import type Rpc from "@/rpc/Rpc";
import NetworkTransport from "@/transport/NetworkTransport";
import { TransportType } from "@/transport/TransportType";
import { Status } from "@/types";
import { Codec, SignatureUtils, Type, getChecksumAddress } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import type {
    BalanceStruct,
    OpenChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";

/** The committed peer's end of the connection: records every frame sent. */
class ProbePeerTransport extends NetworkTransport {
    public transportType = TransportType.HOLEPUNCH;
    public readonly frames: string[] = [];

    public _send(frame: string): void {
        this.frames.push(frame);
    }

    // Overrides NetworkTransport.onMessage: the probe answers requests
    // through the router instead of a socket.
    public override onMessage(): void {}

    protected _close(): void {}
}

/** Which side of the address order the local runtime takes. */
export type NegotiationRole = "lower" | "higher";

/** Where the opening data comes from. */
export type OpeningDataSource = "default" | "derived";

/** How the held derivation settles after its attempt was cancelled. */
export type StaleSettlement = "resolve" | "reject";

export type OpeningTermsProjection = {
    channelId: string;
    participants: string[];
    balances: { amount: string; data: string }[];
};

export type OpeningDataProbe = {
    derivationCalls: OpeningTermsProjection[];
    expectedTerms: OpeningTermsProjection;
    expectedData: string;
    proposalData: string;
    outcomeStatus: string;
    channelOpen: boolean;
};

export type DerivationFailureProbe = {
    error: string;
    outcomeStatus: string;
    attemptCleared: boolean;
    channelIdCleared: boolean;
    proposalFrames: number;
    channelOpen: boolean;
    peerBlacklisted: boolean;
    peerStrikes: number;
    peerTransportClosed: boolean;
};

export type StaleDerivationProbe = {
    cancelledOutcome: string;
    staleResult: string;
    replacementCurrent: boolean;
    replacementChannelKept: boolean;
    replacementTimeoutKept: boolean;
    replacementOutcomePending: boolean;
    replacementOutcome: string;
    replacementChannelOpen: boolean;
    replacementParticipantsMatch: boolean;
    oldProposalFrames: number;
    oldChannelOpen: boolean;
    oldPeerBlacklisted: boolean;
    oldPeerStrikes: number;
    oldPeerTransportClosed: boolean;
    replacementPeerBlacklisted: boolean;
};

type StagedAttempt = {
    wallet: ethers.HDNodeWallet;
    peerAddress: Address;
    transport: ProbePeerTransport;
    profile: PeerProfile;
    match: LobbyMatch;
    channelId: string;
    localBalance: BalanceStruct;
    peerBalance: BalanceStruct;
    outcome: Promise<NegotiationOutcome>;
    settledOutcome: () => NegotiationOutcome | undefined;
};

export class OpeningDataProbeService extends ANetworkRpcService<
    OpeningDataProbeRpcMethods,
    P2PManager<OpeningDataRpc>
> {
    constructor(p2pManager: P2PManager<OpeningDataRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "OpeningDataProbeService"
            })
        );
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): OpeningDataProbeRpcMethods {
        return new OpeningDataProbeRpcMethods(transport, this);
    }

    private get sm() {
        return this.p2pManager.stateManager;
    }

    private get rootService() {
        return this.p2pManager.localRpc.openChannelNegotiationService;
    }

    private get localAddress(): Address {
        return getChecksumAddress(String(this.sm.signerAddress));
    }

    /**
     * Opens a channel through one negotiation role. `default` runs the
     * SDK's base service; `derived` runs the custom root's service, which
     * derives the opening data from the agreed terms.
     */
    public async probeOpeningData(
        role: NegotiationRole,
        source: OpeningDataSource
    ): Promise<OpeningDataProbe> {
        await this.resetLifecycle();
        const service =
            source === "default"
                ? new OpenChannelNegotiationService(this.p2pManager)
                : this.rootService;
        const staged = await this.stageAttempt(service, role);
        const expectedTerms = this.expectedTerms(staged);
        const expectedData =
            source === "default" ? "0x" : deriveOpeningData(expectedTerms);
        let proposalData: string;
        if (role === "lower") {
            await this.answerTerms(staged);
            proposalData = await this.completeLowerOpening(staged);
        } else {
            await this.acceptTerms(service, staged);
            await this.acceptProposal(service, staged, expectedData);
            proposalData = expectedData;
        }
        const outcome = await staged.outcome;
        return {
            derivationCalls: this.rootService.derivationCalls.map((terms) =>
                this.projectTerms(terms)
            ),
            expectedTerms: this.projectTerms(expectedTerms),
            expectedData,
            proposalData,
            outcomeStatus: outcome.status,
            channelOpen: await this.isChannelOpen(staged.channelId)
        };
    }

    /** A local derivation failure ends the attempt without blaming the peer. */
    public async probeDerivationFailure(
        role: NegotiationRole
    ): Promise<DerivationFailureProbe> {
        await this.resetLifecycle();
        const service = this.rootService;
        service.derivationFailure = "opening data source offline";
        const staged = await this.stageAttempt(service, role);
        let error = "";
        if (role === "lower") {
            await this.answerTerms(staged);
        } else {
            await this.acceptTerms(service, staged);
            try {
                await this.acceptProposal(
                    service,
                    staged,
                    deriveOpeningData(this.expectedTerms(staged))
                );
            } catch (caught) {
                error = errorMessage(caught);
            }
        }
        const outcome = await staged.outcome;
        service.derivationFailure = undefined;
        return {
            error,
            outcomeStatus: outcome.status,
            attemptCleared: !service.state.attempt,
            channelIdCleared: String(this.sm.channelId) === ethers.ZeroHash,
            proposalFrames: this.framesOf(staged.transport, "openProposal")
                .length,
            channelOpen: await this.isChannelOpen(staged.channelId),
            peerBlacklisted: staged.profile.isBlackListed,
            peerStrikes: this.strikesOf(staged.profile),
            peerTransportClosed: staged.transport.isClosed
        };
    }

    /**
     * Holds the old attempt's derivation, cancels that attempt, starts a
     * replacement with another peer, and settles the held derivation while
     * the replacement is active. The replacement then opens the channel.
     */
    public async probeStaleDerivation(
        role: NegotiationRole,
        settlement: StaleSettlement
    ): Promise<StaleDerivationProbe> {
        await this.resetLifecycle();
        const service = this.rootService;
        service.holdNextDerivation();
        const old = await this.stageAttempt(service, role);
        let staleProposal: Promise<string> | undefined;
        if (role === "lower") {
            await this.answerTerms(old);
        } else {
            await this.acceptTerms(service, old);
            staleProposal = this.acceptProposal(
                service,
                old,
                deriveOpeningData(this.expectedTerms(old))
            ).then(
                (result) => result.status,
                (error: unknown) => errorMessage(error)
            );
        }
        const held = await this.waitUntil(
            () => service.takeHeldDerivation(),
            "old attempt derivation was not held"
        );
        await service.dispose();
        const cancelledOutcome = (await old.outcome).status;

        const replacement = await this.stageAttempt(service, role);
        if (role === "lower") {
            // The replacement signs its proposal, which schedules its
            // opening deadline, and waits for the peer's answer.
            await this.answerTerms(replacement);
            await this.waitForFrame(replacement.transport, "openProposal");
        }
        // A higher-address replacement still waits for terms under its
        // initiator deadline.
        const replacementAttempt = service.state.attempt;
        const replacementTimeout = replacementAttempt?.timeoutHandle;

        if (settlement === "resolve") {
            held.resolve(deriveOpeningData(held.terms));
        } else {
            held.reject(new Error("opening data source offline"));
        }
        const staleResult = staleProposal ? await staleProposal : "settled";
        await this.settleMicrotasks();

        const replacementCurrent =
            replacementAttempt !== undefined &&
            service.state.attempt === replacementAttempt;
        // The lower replacement selected its channel when it asked for
        // terms; the higher one selects it only when terms arrive.
        const expectedSelection =
            role === "lower" ? replacement.channelId : ethers.ZeroHash;
        const replacementChannelKept =
            service.state.attempt?.channelId === replacement.channelId &&
            String(this.sm.channelId) === expectedSelection;
        const replacementTimeoutKept =
            replacementTimeout !== undefined &&
            service.state.attempt?.timeoutHandle === replacementTimeout;
        const replacementOutcomePending =
            replacement.settledOutcome() === undefined;

        if (role === "lower") {
            await this.completeLowerOpening(replacement);
        } else {
            await this.acceptTerms(service, replacement);
            await this.acceptProposal(
                service,
                replacement,
                deriveOpeningData(this.expectedTerms(replacement))
            );
        }
        const outcome = await replacement.outcome;
        const participants = (
            await this.sm.stateChannelManagerContract.getParticipants(
                replacement.channelId
            )
        ).map((participant) => getChecksumAddress(String(participant)));
        return {
            cancelledOutcome,
            staleResult,
            replacementCurrent,
            replacementChannelKept,
            replacementTimeoutKept,
            replacementOutcomePending,
            replacementOutcome: outcome.status,
            replacementChannelOpen: await this.isChannelOpen(
                replacement.channelId
            ),
            replacementParticipantsMatch:
                participants.length === 2 &&
                participants.includes(this.localAddress) &&
                participants.includes(replacement.peerAddress),
            oldProposalFrames: this.framesOf(old.transport, "openProposal")
                .length,
            oldChannelOpen: await this.isChannelOpen(old.channelId),
            oldPeerBlacklisted: old.profile.isBlackListed,
            oldPeerStrikes: this.strikesOf(old.profile),
            oldPeerTransportClosed: old.transport.isClosed,
            replacementPeerBlacklisted: replacement.profile.isBlackListed
        };
    }

    private async resetLifecycle(): Promise<void> {
        this.rootService.derivationCalls.length = 0;
        await this.sm.clearChannelId();
        this.sm.setStatus(Status.DISCOVERING);
    }

    /**
     * Connects a peer wallet on the other side of the address order and
     * starts an ordinary matched negotiation with it.
     */
    private async stageAttempt(
        service: OpenChannelNegotiationService,
        role: NegotiationRole
    ): Promise<StagedAttempt> {
        const local = this.localAddress;
        let wallet = ethers.Wallet.createRandom();
        const wantPeerAbove = role === "lower";
        while (compareAddresses(local, wallet.address) < 0 !== wantPeerAbove) {
            wallet = ethers.Wallet.createRandom();
        }
        const peerAddress = getChecksumAddress(wallet.address);
        const transport = new ProbePeerTransport(this.p2pManager.rpcRouter);
        transport.peerAddress = peerAddress;
        const profile = new PeerProfile(transport, peerAddress);
        this.p2pManager.profileManager.registerProfile(profile);
        const match: LobbyMatch = {
            peerAddress,
            attemptNonce: ethers.hexlify(ethers.randomBytes(32)),
            selectorAddress: peerAddress,
            advertiserAddress: local,
            selectorChallenge: ethers.hexlify(ethers.randomBytes(32)),
            advertiserChallenge: ethers.hexlify(ethers.randomBytes(32))
        };
        const localBalance: BalanceStruct = { amount: 321n, data: "0x1234" };
        const peerBalance: BalanceStruct = { amount: 700n, data: "0x5678" };
        const outcome = service.initMatchedNegotiation(match, {
            balance: localBalance
        });
        let settled: NegotiationOutcome | undefined;
        let failure: unknown;
        outcome.then(
            (value) => {
                settled = value;
            },
            (error: unknown) => {
                failure = error;
            }
        );
        await this.waitUntil(() => {
            if (failure) {
                throw new Error(
                    `Negotiation did not start: ${errorMessage(failure)}`
                );
            }
            return service.state.attempt?.attemptNonce === match.attemptNonce
                ? true
                : undefined;
        }, "negotiation attempt did not initialize");
        return {
            wallet,
            peerAddress,
            transport,
            profile,
            match,
            channelId: deriveNegotiatedChannelId(match),
            localBalance,
            peerBalance,
            outcome,
            settledOutcome: () => settled
        };
    }

    private expectedTerms(staged: StagedAttempt): OpeningTerms {
        const localIsLower =
            compareAddresses(this.localAddress, staged.peerAddress) < 0;
        return {
            channelId: staged.channelId,
            participants: localIsLower
                ? [this.localAddress, staged.peerAddress]
                : [staged.peerAddress, this.localAddress],
            balances: localIsLower
                ? [staged.localBalance, staged.peerBalance]
                : [staged.peerBalance, staged.localBalance]
        };
    }

    /** The lower-address local runtime asks for terms; the peer answers. */
    private async answerTerms(staged: StagedAttempt): Promise<void> {
        const request = await this.waitForFrame(
            staged.transport,
            "exchangeTerms"
        );
        await this.answer(staged.transport, request, {
            encodedBalance: this.encodeBalance(staged.peerBalance)
        });
    }

    /**
     * Plays the higher peer against a lower-address local runtime: checks
     * the local signature, co-signs, submits the opening, and answers.
     * Returns the proposal's opening data.
     */
    private async completeLowerOpening(staged: StagedAttempt): Promise<string> {
        const request = await this.waitForFrame(
            staged.transport,
            "openProposal"
        );
        const encodedOpenChannel = String(request.params[3]);
        const lowerSignature = String(request.params[4]);
        const signer = getChecksumAddress(
            SignatureUtils.getSignerAddress(
                encodedOpenChannel,
                lowerSignature
            ).toString()
        );
        if (signer !== this.localAddress) {
            throw new Error("Proposal is not signed by the local runtime");
        }
        const proposal = Codec.decode(
            encodedOpenChannel,
            Type.OpenChannel
        ) as OpenChannelStruct;
        const { signature } = await SignatureUtils.signOpenChannel(
            proposal,
            staged.wallet
        );
        await (
            await this.sm.stateChannelManagerContract.open(
                {
                    encodedOpenChannel,
                    signatures: [lowerSignature, signature.toString()]
                },
                { gasLimit: 3_000_000 }
            )
        ).wait();
        await this.answer(staged.transport, request, { status: "submitted" });
        return ethers.hexlify(proposal.data);
    }

    private async acceptTerms(
        service: OpenChannelNegotiationService,
        staged: StagedAttempt
    ): Promise<void> {
        await service.acceptTerms(
            staged.transport,
            staged.match.attemptNonce,
            staged.match.selectorChallenge,
            staged.match.advertiserChallenge,
            this.encodeBalance(staged.peerBalance)
        );
    }

    /** The lower-address peer proposes the opening with `data`. */
    private async acceptProposal(
        service: OpenChannelNegotiationService,
        staged: StagedAttempt,
        data: string
    ): Promise<{ status: "submitted" }> {
        const terms = this.expectedTerms(staged);
        const signed = await SignatureUtils.signOpenChannel(
            {
                ...terms,
                deadlineTimestamp: Clock.getTimeInSeconds() + 60,
                isAtomic: true,
                data
            },
            staged.wallet
        );
        return service.acceptOpenProposal(
            staged.transport,
            staged.match.attemptNonce,
            staged.match.selectorChallenge,
            staged.match.advertiserChallenge,
            signed.encoded.toString(),
            signed.signature.toString()
        );
    }

    private framesOf(transport: ProbePeerTransport, method: string): Rpc[] {
        return transport.frames
            .map((frame) => JSON.parse(frame) as Rpc)
            .filter((rpc) => rpc.method === method);
    }

    private waitForFrame(
        transport: ProbePeerTransport,
        method: string
    ): Promise<Rpc> {
        return this.waitUntil(
            () => this.framesOf(transport, method).at(-1),
            `no ${method} request reached the peer`
        );
    }

    private async answer(
        transport: ProbePeerTransport,
        request: Rpc,
        result: unknown
    ): Promise<void> {
        await this.p2pManager.rpcRouter.onRpc(
            JSON.stringify({
                rpcResponse: true,
                requestId: request.requestId,
                ok: true,
                result
            }),
            transport
        );
    }

    /** Polls `read` until it returns a value; the staging steps are local. */
    private async waitUntil<T>(
        read: () => T | undefined,
        message: string
    ): Promise<T> {
        for (let poll = 0; poll < 500; poll += 1) {
            const value = read();
            if (value !== undefined) return value;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(message);
    }

    private async settleMicrotasks(): Promise<void> {
        for (let turn = 0; turn < 5; turn += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    private async isChannelOpen(channelId: string): Promise<boolean> {
        const [open] =
            await this.sm.stateChannelManagerContract.isChannelOpen(channelId);
        return open;
    }

    private strikesOf(profile: PeerProfile): number {
        const key = this.p2pManager.profileManager.profileKey(profile);
        return key ? this.p2pManager.profileManager.getStrikes(key) : 0;
    }

    private projectTerms(terms: OpeningTerms): OpeningTermsProjection {
        return {
            channelId: String(terms.channelId),
            participants: terms.participants.map((participant) =>
                getChecksumAddress(String(participant))
            ),
            balances: terms.balances.map((balance) => ({
                amount: BigInt(balance.amount).toString(),
                data: ethers.hexlify(balance.data)
            }))
        };
    }

    private encodeBalance(balance: BalanceStruct): string {
        return String(Codec.encode(balance, Type.Balance));
    }
}
