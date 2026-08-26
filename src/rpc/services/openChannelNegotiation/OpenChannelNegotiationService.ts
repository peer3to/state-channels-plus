import { ethers, TransactionResponse } from "ethers";

import Clock from "@/Clock";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import ARpcService from "@/rpc/ARpcService";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import type ATransport from "@/transport/ATransport";
import {
    DEFAULT_ADMISSION_POLICY,
    type AdmissionMode,
    type AdmissionPolicy
} from "@/discovery/AdmissionPolicy";
import {
    Codec,
    DetachedPromises,
    SignatureUtils,
    Type,
    getChecksumAddress,
    tryDecodeCustomError
} from "@/utils";

import OpenChannelNegotiationRpcMethods, {
    type OpenChannelNegotiationP2PManager
} from "./OpenChannelNegotiationRpcMethods";
import {
    DEFAULT_JOIN_AMOUNT,
    NEGOTIATION_TIMEOUT_MS,
    OPEN_CHANNEL_DEADLINE_SECONDS,
    compareAddresses,
    getOpenChannelProposalMismatch,
    type Address
} from "./OpenChannelNegotiationHelpers";

// Valid AdmissionPolicy.mode values, checked in setAdmissionPolicy — a
// typo'd mode (e.g. "deny_all") must throw rather than silently fall through
// evaluateAdmission's switch to an implicit allow.
const ADMISSION_MODES = new Set<AdmissionMode>([
    "allowAll",
    "denyAll",
    "arbitrate"
]);

type NegotiationState = {
    channelOpened?: boolean;
    negotiatingWith?: Address;
    initiatedByMe?: boolean;
    myAmount: number;
    theirAmount?: number;
    proposalSent?: boolean;
    // Write-only/reserved: recorded once all decline checks pass in
    // openProposal, but read nowhere in src today. Don't treat its
    // relocation as load-bearing.
    receivedProposal?: {
        encodedOpenChannel: string;
        lowerSignature: string;
    };
    timeoutHandle?: ReturnType<typeof setTimeout>;
    startedAtMs?: number;
};

export default class OpenChannelNegotiationService extends ARpcService<
    OpenChannelNegotiationRpcMethods,
    OpenChannelNegotiationP2PManager
> {
    public state: NegotiationState = {
        myAmount: DEFAULT_JOIN_AMOUNT,
        channelOpened: false
    };
    // Declarative admission policy consulted at negotiateRequest (D1). Never
    // settable from OpenChannelNegotiationRpcMethods — see setAdmissionPolicy.
    public admissionPolicy: AdmissionPolicy = DEFAULT_ADMISSION_POLICY;

    constructor(p2pManager: OpenChannelNegotiationP2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "OpenChannelNegotiationService"
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

        const peer = getChecksumAddress(peerAddress);
        const me = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        if (peer === me) return;

        if (this.state.negotiatingWith) {
            return;
        }

        this.state.negotiatingWith = peer;
        this.state.initiatedByMe = true;
        this.state.startedAtMs = Date.now();
        this.startTimeout();

        const channelId = ethers.hexlify(
            this.p2pManager.stateManager.channelId
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
        balances: OpenChannelStruct["balances"];
        lower: Address;
    } {
        const me = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const peer = getChecksumAddress(peerAddress);

        const [a0, a1] =
            compareAddresses(me, peer) <= 0 ? [me, peer] : [peer, me];
        const lower = a0;

        const theirAmount =
            typeof this.state.theirAmount === "number"
                ? this.state.theirAmount
                : DEFAULT_JOIN_AMOUNT;

        const balances: OpenChannelStruct["balances"] = [
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

        const me = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        const peer = getChecksumAddress(peerAddress);

        const { participants, balances, lower } =
            this.getParticipantsAndBalances(peer);

        const channelId = this.p2pManager.stateManager.channelId;
        let [alreadyOpen] =
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isChannelOpen(
                channelId
            );

        if (!alreadyOpen) {
            await this.p2pManager.stateManager.refreshOpenedStatusFromChain();
            [alreadyOpen] =
                await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isChannelOpen(
                    channelId
                );
        }

        if (alreadyOpen) {
            this.state.channelOpened = true;
            this.resetNegotiation("channel already open");
            return;
        }

        const isLower = me === lower;
        const haveAmounts = typeof this.state.theirAmount === "number";
        if (!isLower) return;

        if (haveAmounts && !this.state.proposalSent) {
            const deadlineTimestamp =
                Clock.getTimeInSeconds() + OPEN_CHANNEL_DEADLINE_SECONDS;
            const openChannel: OpenChannelStruct = {
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
            this.scheduleDeadlineCheck(deadlineTimestamp, peer);
        }
    }

    public async openProposal(
        peerAddress: Address,
        encodedOpenChannel: string,
        lowerSignature: string
    ): Promise<void> {
        if (this.state.channelOpened) return;

        const peer = getChecksumAddress(peerAddress);
        const me = getChecksumAddress(
            String(this.p2pManager.stateManager.signerAddress)
        );
        if (peer === me) return;

        // Unreachable from the wire today: OpenChannelNegotiationRpcMethods
        // only forwards here when negotiatingWith === from, so this is a
        // dead-code defensive branch. Kept non-punitive (not blacklisted)
        // since it's a benign guard, not an attributable fraud signal.
        if (!this.state.negotiatingWith) {
            this.remoteRpc.openChannelNegotiationService
                .abort("decline:no negotiation in progress")
                .sendOne(peer);
            this.resetNegotiation("openProposal - no negotiation in progress");
            return;
        }

        const { participants, balances, lower } =
            this.getParticipantsAndBalances(peer);
        const isLower = me === lower;
        if (isLower) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            this.resetNegotiation("openProposal - lower address called");
            return;
        }

        const decoded = Codec.decode(
            encodedOpenChannel,
            Type.OpenChannel
        ) as OpenChannelStruct;
        const deadlineSeconds = Number(decoded.deadlineTimestamp);

        const recovered = getChecksumAddress(
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

        // Only co-sign once amounts were actually negotiated; otherwise the
        // reconstructed balances would fall back to defaults and we'd validate
        // against terms we never agreed. Benign (not attributable fraud) — a
        // peer that hasn't negotiated amounts with us yet, not a forged
        // signature or mismatched terms — so decline without blacklisting.
        if (typeof this.state.theirAmount !== "number") {
            this.remoteRpc.openChannelNegotiationService
                .abort("decline:no negotiated amount")
                .sendOne(peer);
            this.resetNegotiation("openProposal - no negotiated amount");
            return;
        }

        // The lower signature is valid, but it only proves the peer signed
        // *these* bytes — not that they match what we negotiated. Reconstruct
        // the expected terms and refuse to co-sign anything else, so a peer
        // can't make our signer authorize attacker-chosen channel parameters.
        const nowSeconds = Clock.getTimeInSeconds();
        const mismatch = getOpenChannelProposalMismatch(
            decoded,
            {
                channelId: this.p2pManager.stateManager.channelId,
                participants,
                balances
            },
            {
                nowSeconds,
                // Generous upper bound (2x the proposer's deadline offset) so
                // modest clock skew between peers can't reject a legitimate
                // proposal; the deadline is a sanity bound, not fund-critical.
                maxSeconds: nowSeconds + OPEN_CHANNEL_DEADLINE_SECONDS * 2
            }
        );
        if (mismatch) {
            this.logger.warn(
                `openProposal - proposed terms do not match negotiation; rejecting (${mismatch})`
            );
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peer);
            this.resetNegotiation(`openProposal terms mismatch: ${mismatch}`);
            return;
        }

        // Written only once all decline checks have passed — writing it
        // earlier would leave it behind in state on any future path that
        // rejects without calling resetNegotiation.
        this.state.receivedProposal = { encodedOpenChannel, lowerSignature };

        const { signature } = await SignatureUtils.signOpenChannel(
            decoded,
            this.p2pManager.stateManager.signer
        );

        let txResponse: TransactionResponse;
        const txResponsePromise =
            this.p2pManager.stateManager.stateChannelManagerContract
                .open(
                    {
                        encodedOpenChannel,
                        signatures: [lowerSignature, signature.toString()]
                    },
                    // Right-sized from 5M: open measures ~1.84M in e2e; 3M keeps
                    // headroom while freeing block gas under concurrency.
                    { gasLimit: 3_000_000 }
                )
                .then((tx) => {
                    txResponse = tx;
                    const txReceiptPromise = tx.wait();
                    DetachedPromises.collect(txReceiptPromise);
                    return txReceiptPromise;
                })
                .catch((e) => {
                    const custom = tryDecodeCustomError(e);
                    if (custom?.name === "RaceConditionChannelAlreadyOpen") {
                        this.logger.info(
                            "open race: channel already opened by peer; deferring to ChannelOpened event"
                        );
                    } else {
                        const msg = e instanceof Error ? e.message : String(e);
                        this.logger.error("Error opening channel", {
                            custom,
                            error: msg
                        });
                        this.remoteRpc.openChannelNegotiationService
                            .abort(`open failed: ${msg}`)
                            .sendOne(peer);
                        this.resetNegotiation("open tx failed");
                    }
                });
        DetachedPromises.collect(txResponsePromise);
        this.scheduleDeadlineCheck(deadlineSeconds, peer);
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

        peerAddress = getChecksumAddress(peerAddress);

        this.state.timeoutHandle = setTimeout(async () => {
            try {
                const channelId = this.p2pManager.stateManager.channelId;
                let [isOpen] =
                    await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isChannelOpen(
                        channelId
                    );

                if (!isOpen) {
                    await this.p2pManager.stateManager.refreshOpenedStatusFromChain();
                    [isOpen] =
                        await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.isChannelOpen(
                            channelId
                        );
                }
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

    /**
     * *Service*-only setter (never a wire endpoint — a remote peer setting
     * our admission policy is a trivial takeover; see
     * OpenChannelNegotiationRpcMethods, which never exposes this). Rejects
     * an unrecognized mode (fail closed, not a silent fall-through to
     * allow) and shallow-clones the policy (incl. its allow/deny arrays) so
     * a caller mutating its own object afterward can't retroactively change
     * an admission decision already taken with it.
     */
    public setAdmissionPolicy(policy: AdmissionPolicy): void {
        if (!ADMISSION_MODES.has(policy.mode)) {
            throw new Error(
                `OpenChannelNegotiation: invalid admission policy mode ${String(policy.mode)}`
            );
        }
        this.admissionPolicy = {
            ...policy,
            allow: policy.allow ? [...policy.allow] : undefined,
            deny: policy.deny ? [...policy.deny] : undefined
        };
    }

    /**
     * Set the stake we offer in the NEXT negotiation. Refuses mid-negotiation
     * (`negotiatingWith` set) — changing the stake mid-negotiation would
     * desync the terms the peer already accepted and trip
     * getOpenChannelProposalMismatch on the co-sign path. Abandon via
     * resetForNewChannel() first — it sends abort("abandoned") to the current
     * partner (if any) so their side resets immediately instead of us having
     * to wait out their next message or the 20s timeout.
     */
    public setStakeAmount(amount: number): void {
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            throw new Error(
                `OpenChannelNegotiation: invalid stake amount ${amount}; must be a positive safe integer`
            );
        }
        if (this.state.negotiatingWith) {
            throw new Error(
                "OpenChannelNegotiation: cannot change stake amount while a negotiation is in progress"
            );
        }
        this.state.myAmount = amount;
    }

    /**
     * Re-arm for a brand-new channel: run the usual reset (preserves
     * myAmount, clears the timer) and additionally drop the channelOpened
     * latch so a fresh OPEN attempt isn't a one-shot per process. Idempotent.
     * This is the sanctioned abandon path for an in-flight negotiation: it
     * does not guard on `negotiatingWith` like setStakeAmount does — instead,
     * if a partner is currently set, it sends abort("abandoned") to them
     * BEFORE clearing state.
     *
     * STOPGAP: without this, the partner's stale round-1 state
     * (proposalSent, etc.) survives our reset. If we immediately
     * beginNegotiation() with the same peer, their stale openProposal for
     * round 1 can arrive after our round-2 negotiatingWith is set, hit the
     * benign "no negotiated amount"/mismatch decline, and its
     * resetNegotiation wipes our fresh round-2 state — a silent mutual
     * deadlock. The abort clears the partner's state first so their stale
     * message never arrives. The durable fix is a negotiation round counter
     * (Phase-2 ADR candidate); do not build it here.
     */
    public resetForNewChannel(): void {
        const partner = this.state.negotiatingWith;
        if (partner) {
            this.remoteRpc.openChannelNegotiationService
                .abort("abandoned")
                .sendOne(partner);
        }
        this.resetNegotiation("reset for new channel");
        this.state.channelOpened = false;
    }
}
