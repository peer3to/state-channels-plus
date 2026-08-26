import { Status } from "@/types";
import type { ChannelId } from "@/types/types";
import { config } from "@/utils/config";
import { getChecksumAddress } from "@/utils/address";
import type { Logger } from "@/utils/logging/Logger";
import type { EventBus } from "@/events/EventBus";
import Clock from "@/Clock";
import type LocalP2pSigner from "@/evm/signer/LocalP2pSigner";
import type LobbyService from "@/rpc/services/lobby/LobbyService";
import { ChannelIndex, type EnumerateOptions } from "@/discovery/ChannelIndex";
import { ChannelProber, type ProbeResult } from "@/discovery/ChannelProber";
import type { RequestIntentResult } from "@/discovery/LobbyIntentTypes";
import { type IntentDeclineReason } from "@/discovery/LobbyIntentTypes";
import {
    AdKind,
    type AdId,
    type ChannelAdStruct,
    adId as computeAdId,
    encodeChannelAd
} from "@/discovery/ChannelAd";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import type { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

// This is the single-candidate acquisition
// coordinator. It is host-side coordination code invoked through the mirror
// - NOT an RPC service and NOT a *RpcMethods class - so it calls
// LobbyService/LocalP2pSigner/OpenChannelNegotiationService directly rather
// than going through remoteRpc.

export type AcquireCandidates = ChannelAdStruct[];
export type AcquireStage =
    | "intent"
    | "connect"
    | "sync"
    | "confirm"
    | "negotiate";
export type AcquireAttempt = {
    adId: AdId;
    advertiser: string;
    kind: AdKind;
    stage: AcquireStage;
    outcome: "accepted" | "declined" | "timeout" | "error" | "ok";
    reason?: IntentDeclineReason | string;
};
export type AcquireOptions = {
    /**
     * Explicit lobby ads to try. OPTIONAL: when omitted, discovery is
     * chain-first - the chain is enumerated for open channels and those are
     * probed directly, and the lobby is consulted only once every chain
     * candidate has failed, timed out or been rejected. Passing candidates
     * explicitly keeps the old lobby-only behaviour for callers that already
     * hold ads (and for "open a NEW channel with this peer", which the chain
     * cannot answer by definition).
     */
    candidates?: AcquireCandidates;
    /**
     * Skips the chain phase and goes straight to the lobby. Escape hatch for
     * a caller that knows the chain has nothing useful (or wants to open a
     * new channel); the default is chain-first.
     */
    lobbyOnly?: boolean;
    parallelism?: number; // K; only 1 is currently supported
    maxWinners?: number; // only 1 is currently supported
    deadlineMs?: number;
    // REQUIRED, decimal string. The coordinator is the SINGLE consumer
    // of this value - it converts once and drives requestIntent's amount,
    // setStakeAmount (OPEN) and the JoinChannelStruct balance (JOIN). Ads are
    // hints, never authority (see SECURITY note below) - the ad's own
    // `amount` field is never used for anything fund-relevant.
    amount: string;
};
export type AcquireResult =
    | { status: "acquired"; channelId: string; attempts: AcquireAttempt[] }
    | { status: "exhausted"; attempts: AcquireAttempt[] }
    | { status: "deadline"; attempts: AcquireAttempt[] }
    | {
          status: "unsupported";
          reason:
              | "parallelism>1"
              | "maxWinners>1"
              | "negotiation-service-absent";
          attempts: AcquireAttempt[];
      };

/**
 * The capability this coordinator needs from chain enumeration - a real
 * `ChannelIndex` satisfies it structurally, and a test can hand in a plain
 * object without a mocking framework.
 */
export type ChannelEnumerator = {
    listOpenChannels(opts?: EnumerateOptions): Promise<ChannelId[]>;
};

/** The capability this coordinator needs from probing. See {@link ChannelEnumerator}. */
export type ChannelProbeRunner = {
    probe(candidates: ChannelId[]): Promise<ProbeResult>;
};

export type ChannelAcquisitionCoordinatorDeps = {
    lobby: LobbyService;
    signer: LocalP2pSigner;
    logger: Logger;
    events: EventBus;
    /** Test seam. Defaults to a ChannelIndex over the signer's provider/contract. */
    channelIndex?: ChannelEnumerator;
    /** Test seam. Defaults to a ChannelProber over the signer. */
    channelProber?: ChannelProbeRunner;
};

/** One candidate resolved to a concrete adId. */
type Candidate = { adId: AdId; ad: ChannelAdStruct };

/**
 * The only thing a commit path needs from whatever produced the candidate:
 * labels for the per-attempt report. Chain-discovered candidates have no ad,
 * so the commit paths take this instead of a `Candidate` - fabricating a
 * synthetic `ChannelAdStruct` just to satisfy a signature would put a
 * made-up ad on a fund-relevant path, which is exactly what the "ads are
 * hints, never authority" rule exists to prevent.
 */
type AttemptReporting = { adId: AdId; advertiser: string; kind: AdKind };

const reportingFor = (candidate: Candidate): AttemptReporting => ({
    adId: candidate.adId,
    advertiser: candidate.ad.advertiser,
    kind: candidate.ad.kind
});

/** Distinguishes a per-stage timeout from any other stage failure. */
class StageTimeoutError extends Error {
    constructor(stage: AcquireStage) {
        super(`ChannelAcquisitionCoordinator: stage "${stage}" timed out`);
    }
}

// Buffer added to the current chain time for a JOIN's deadlineTimestamp,
// mirroring the harness's own JoinChannelStruct construction
// (test/harness/actions/JoinActions.ts) - generous enough that collecting
// threshold signatures never races it under normal conditions.
const JOIN_DEADLINE_BUFFER_SECONDS = 120;

/**
 * Single-candidate (K=1) channel acquisition coordinator. Drives the
 * requester side of both commit paths:
 *   JOIN:  connect -> wait for sync -> collectJoinChannelConfirmation -> joinChannel
 *   OPEN:  isChannelOpen precheck -> connect -> setStakeAmount -> beginNegotiation
 * A failed commit releases the loser's hold via releaseIntent (protocol
 * layer only - never a transport close/blacklist/ban), resets the
 * negotiation latch, leaves the abandoned channel topic, and falls back to
 * the next candidate. Ads are hints; the isChannelOpen precheck and the
 * WE-set stake/balance are the only chain-relevant truths this class acts on.
 */
export class ChannelAcquisitionCoordinator {
    private readonly lobby: LobbyService;
    private readonly signer: LocalP2pSigner;
    private readonly logger: Logger;
    private readonly events: EventBus;
    // Chain-first discovery. Both are constructed on first use and reused for
    // the lifetime of the coordinator: ChannelIndex carries incremental
    // ingest state across scans, and rebuilding the prober per call would
    // throw away nothing useful but cost an extra allocation per acquire.
    private readonly channelIndexOverride?: ChannelEnumerator;
    private readonly channelProberOverride?: ChannelProbeRunner;
    private channelIndexInstance?: ChannelEnumerator;
    private channelProberInstance?: ChannelProbeRunner;

    constructor(deps: ChannelAcquisitionCoordinatorDeps) {
        this.lobby = deps.lobby;
        this.signer = deps.signer;
        this.logger = deps.logger.child({
            component: "ChannelAcquisitionCoordinator"
        });
        this.events = deps.events;
        this.channelIndexOverride = deps.channelIndex;
        this.channelProberOverride = deps.channelProber;
    }

    /** Lazily built over the signer's provider/contract; injectable for tests. */
    private getChannelIndex(): ChannelEnumerator {
        if (this.channelIndexOverride) return this.channelIndexOverride;
        if (!this.channelIndexInstance) {
            const stateManager = this.signer.p2pManager.stateManager;
            const provider = stateManager.signer.provider;
            if (!provider) {
                throw new Error(
                    "ChannelAcquisitionCoordinator: chain-first discovery needs a provider on the signer"
                );
            }
            this.channelIndexInstance = new ChannelIndex({
                provider,
                stateChannelManagerContract:
                    stateManager.stateChannelManagerContract,
                logger: this.logger
            });
        }
        return this.channelIndexInstance;
    }

    /** Lazily built over the signer; injectable for tests. */
    private getChannelProber(): ChannelProbeRunner {
        if (this.channelProberOverride) return this.channelProberOverride;
        if (!this.channelProberInstance) {
            this.channelProberInstance = new ChannelProber({
                signer: this.signer,
                logger: this.logger,
                events: this.events
            });
        }
        return this.channelProberInstance;
    }

    public async acquireChannel(
        options: AcquireOptions
    ): Promise<AcquireResult> {
        // `parallelism`/`maxWinners` are the seam for racing several
        // candidates at once later; callers can already pass them today and
        // won't have to change when that lands.
        const parallelism = options.parallelism ?? 1;
        if (parallelism > 1) {
            return {
                status: "unsupported",
                reason: "parallelism>1",
                attempts: []
            };
        }
        const maxWinners = options.maxWinners ?? 1;
        if (maxWinners > 1) {
            return {
                status: "unsupported",
                reason: "maxWinners>1",
                attempts: []
            };
        }

        // Canonical decimal digits only - rejects "5e2"/"500.0"/"-1"/"" up
        // front, before any wire call, rather than letting them pass
        // Number() only to throw BigInt(rawString) mid-commit (JOIN balance).
        if (!/^\d+$/.test(options.amount)) {
            throw new Error(
                `ChannelAcquisitionCoordinator: invalid amount "${options.amount}"; must be a canonical decimal string (digits only)`
            );
        }
        const stakeAmountNumber = Number(options.amount);
        if (
            !Number.isSafeInteger(stakeAmountNumber) ||
            stakeAmountNumber <= 0
        ) {
            throw new Error(
                `ChannelAcquisitionCoordinator: invalid amount "${options.amount}"; must be a positive safe integer decimal string`
            );
        }

        const attempts: AcquireAttempt[] = [];
        const startedAtMs = Date.now();
        const overallDeadlineMs =
            options.deadlineMs ?? Number.POSITIVE_INFINITY;
        const remainingDeadlineMs = (): number =>
            Number.isFinite(overallDeadlineMs)
                ? overallDeadlineMs - (Date.now() - startedAtMs)
                : Number.POSITIVE_INFINITY;

        // Soft-deprioritization memory for the session (this single
        // acquireChannel call) - a peer that declines/fails sinks to the
        // back of any subsequently-resolved candidate pool, so one
        // uncooperative peer can't livelock re-selection. Keyed by checksum
        // advertiser address.
        const declineCounts = new Map<string, number>();
        const recordDecline = (advertiser: string): void => {
            const key = getChecksumAddress(advertiser);
            declineCounts.set(key, (declineCounts.get(key) ?? 0) + 1);
        };
        const sortByDeclines = (list: Candidate[]): Candidate[] =>
            [...list].sort(
                (a, b) =>
                    (declineCounts.get(getChecksumAddress(a.ad.advertiser)) ??
                        0) -
                    (declineCounts.get(getChecksumAddress(b.ad.advertiser)) ??
                        0)
            );

        const record = (attempt: AcquireAttempt): void => {
            attempts.push(attempt);
            this.events.emit("discovery", "acquireStage", [
                {
                    adId: attempt.adId,
                    stage: attempt.stage,
                    outcome: attempt.outcome,
                    reason:
                        attempt.reason === undefined
                            ? undefined
                            : String(attempt.reason)
                }
            ]);
        };

        // CHAIN FIRST. Existing channels are discovered from chain and probed
        // directly; the lobby is fallback infrastructure, not a dependency
        // for every peer that wants to join. Skipped when the caller passed
        // explicit ads (it already has candidates) or asked for lobbyOnly.
        if (!options.lobbyOnly && options.candidates === undefined) {
            const chain = await this.attemptChainCandidates(
                stakeAmountNumber,
                remainingDeadlineMs,
                record
            );
            if (chain.status === "acquired") {
                return {
                    status: "acquired",
                    channelId: chain.channelId,
                    attempts
                };
            }
            if (chain.status === "deadline") {
                return { status: "deadline", attempts };
            }
            // Every chain candidate failed/timed out/was rejected - fall
            // through to the lobby, which is where peers looking to open a
            // NEW channel are found.
        }

        // The lobby phase. Explicit candidates win; otherwise use whatever
        // ads this peer has already heard on the lobby topic.
        const lobbyCandidates =
            options.candidates ??
            this.lobby.listAds().map((stored) => stored.ad);
        const pool = sortByDeclines(this.resolveCandidates(lobbyCandidates));
        let poolIndex = 0;

        // MIXED-POOL SAFE (fix): a capability-absent OPEN candidate is a
        // per-candidate skip, never a whole-acquire abort. Only when EVERY
        // candidate this call ever attempted was such a skip (never even a
        // real intent) does exhaustion mean "unsupported" rather than a
        // genuine "exhausted" (some candidate got a real attempt and lost).
        let attemptedAny = false;
        let allAttemptsWereCapabilitySkips = true;
        const exhausted = (): AcquireResult =>
            attemptedAny && allAttemptsWereCapabilitySkips
                ? {
                      status: "unsupported",
                      reason: "negotiation-service-absent",
                      attempts
                  }
                : { status: "exhausted", attempts };

        for (;;) {
            if (remainingDeadlineMs() <= 0) {
                return { status: "deadline", attempts };
            }
            if (poolIndex >= pool.length) {
                return exhausted();
            }

            const candidate = pool[poolIndex++];
            const outcome = await this.attemptCandidate(
                candidate,
                options.amount,
                stakeAmountNumber,
                remainingDeadlineMs,
                record
            );
            switch (outcome.terminal) {
                case "acquired":
                    return {
                        status: "acquired",
                        channelId: outcome.channelId,
                        attempts
                    };
                case "deadline":
                    return { status: "deadline", attempts };
                case false:
                    attemptedAny = true;
                    if (!outcome.capabilitySkip) {
                        allAttemptsWereCapabilitySkips = false;
                    }
                    recordDecline(candidate.ad.advertiser);
                    break;
            }
        }
    }

    /**
     * The chain-first phase: enumerate open channels from chain, probe them
     * directly, and commit a JOIN on the first one that proves usable.
     *
     * A candidate counts as usable only when the probe's spectate/sync
     * completes and confirms a live peer - "a socket connected" is not
     * enough. The probe leaves that channel connected and synced, so
     * commitJoin's own connect/sync stages resolve immediately and only the
     * confirm stage does real work.
     *
     * Enumeration or probing failing is never fatal: it degrades to the
     * lobby, which is the whole point of the ordering.
     */
    private async attemptChainCandidates(
        stakeAmountNumber: number,
        remainingDeadlineMs: () => number,
        record: (attempt: AcquireAttempt) => void
    ): Promise<
        | { status: "acquired"; channelId: string }
        | { status: "exhausted" | "deadline" }
    > {
        if (remainingDeadlineMs() <= 0) return { status: "deadline" };

        let candidates: ChannelId[];
        try {
            candidates = await this.getChannelIndex().listOpenChannels();
        } catch (error) {
            // A provider that can't serve logs must not sink the acquire -
            // the lobby path may still succeed.
            this.logger.warn(
                "Chain enumeration failed; falling back to lobby",
                {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            return { status: "exhausted" };
        }

        if (candidates.length === 0) {
            this.logger.debug("Chain enumeration returned no open channels");
            return { status: "exhausted" };
        }

        let probed;
        try {
            probed = await this.getChannelProber().probe(candidates);
        } catch (error) {
            this.logger.warn("Channel probing failed; falling back to lobby", {
                error: error instanceof Error ? error.message : String(error)
            });
            return { status: "exhausted" };
        }

        if (probed.status !== "usable") {
            this.logger.debug(
                "No chain candidate proved usable; falling back to lobby",
                { candidates: candidates.length }
            );
            return { status: "exhausted" };
        }

        if (remainingDeadlineMs() <= 0) return { status: "deadline" };

        // Report chain candidates against the peer that actually proved the
        // channel usable. There is no ad here, so the adId slot carries the
        // channelId - the attempt log stays readable without inventing one.
        const committed = await this.commitJoin(
            {
                adId: String(probed.channelId),
                advertiser: getChecksumAddress(String(probed.peerAddress)),
                kind: AdKind.JOIN
            },
            String(probed.channelId),
            stakeAmountNumber,
            remainingDeadlineMs,
            record
        );
        if (committed.status === "acquired") {
            return { status: "acquired", channelId: String(probed.channelId) };
        }
        return {
            status: committed.status === "deadline" ? "deadline" : "exhausted"
        };
    }

    /** Resolves the caller's explicit candidate array into concrete {adId, ad} pairs. */
    private resolveCandidates(candidates: AcquireCandidates): Candidate[] {
        return candidates.map((ad) => {
            const { encodedAd } = encodeChannelAd(ad);
            return { adId: computeAdId(encodedAd), ad };
        });
    }

    /**
     * One candidate's full lifecycle: intent -> commit -> cleanup on
     * failure. `terminal` is `false` when the caller should advance to the
     * next candidate; otherwise it names the shape acquireChannel must
     * return immediately (acquireChannel owns the accumulated `attempts`
     * array, so this never carries its own copy).
     */
    private async attemptCandidate(
        candidate: Candidate,
        decimalAmount: string,
        stakeAmountNumber: number,
        remainingDeadlineMs: () => number,
        record: (attempt: AcquireAttempt) => void
    ): Promise<
        | { terminal: "acquired"; channelId: string }
        | { terminal: "deadline" }
        | { terminal: false; capabilitySkip?: boolean }
    > {
        const { adId, ad } = candidate;
        const advertiser = ad.advertiser;
        const kind = ad.kind;

        // SECURITY (F9 capability check), MIXED-POOL SAFE: an OPEN candidate
        // on a node without the opt-in service is a per-candidate SKIP, not
        // a whole-acquire abort - never waste the peer's hold on a commit we
        // can't perform, but a JOIN candidate later in the SAME pool must
        // still be tried (spec: "JOIN candidates must still work without
        // it"). acquireChannel only surfaces {status:"unsupported"} if EVERY
        // attempted candidate hit this skip.
        if (
            kind === AdKind.OPEN &&
            this.getNegotiationService() === undefined
        ) {
            record({
                adId,
                advertiser,
                kind,
                stage: "negotiate",
                outcome: "error",
                reason: "negotiation-service-absent"
            });
            return { terminal: false, capabilitySkip: true };
        }

        let intentResult: RequestIntentResult;
        try {
            intentResult = await this.lobby.requestIntent({
                peerAddress: advertiser,
                adId,
                amount: decimalAmount
            });
        } catch (error) {
            // The contract note: requestIntent may reject on its own bounded
            // client-side timeout (a non-responding peer no longer hangs
            // us) - treat exactly like a decline and fall back.
            record({
                adId,
                advertiser,
                kind,
                stage: "intent",
                outcome: "timeout",
                reason: error instanceof Error ? error.message : String(error)
            });
            return { terminal: false };
        }

        if (!intentResult.accepted) {
            record({
                adId,
                advertiser,
                kind,
                stage: "intent",
                outcome: "declined",
                reason: intentResult.reason
            });
            return { terminal: false };
        }
        record({
            adId,
            advertiser,
            kind,
            stage: "intent",
            outcome: "accepted"
        });

        // Adopt the AUTHORITATIVE proposed channelId from the accept,
        // never the ad's own (hint) field, for the isChannelOpen precheck,
        // the connect, and the returned channelId. Not a live bug today
        // (the acceptor always echoes the ad's channelId back), but the
        // mandatory anti-lying-ad precheck must key on the accept.
        const channelId = intentResult.channelId ?? ad.channelId;
        if (
            intentResult.channelId !== undefined &&
            intentResult.channelId !== ad.channelId
        ) {
            this.logger.warn(
                "requestIntent accept channelId differs from the ad's own channelId; using the accept's value",
                {
                    adChannelId: ad.channelId,
                    acceptedChannelId: intentResult.channelId
                }
            );
        }

        const commitOutcome =
            kind === AdKind.OPEN
                ? await this.commitOpen(
                      candidate,
                      channelId,
                      stakeAmountNumber,
                      remainingDeadlineMs,
                      record
                  )
                : await this.commitJoin(
                      reportingFor(candidate),
                      channelId,
                      stakeAmountNumber,
                      remainingDeadlineMs,
                      record
                  );

        if (commitOutcome.status === "acquired") {
            return { terminal: "acquired", channelId };
        }

        // Commit failed or the deadline ran out mid-commit: release the
        // loser's hold at the protocol layer, reset the negotiation latch,
        // and leave the abandoned channel topic before falling back.
        await this.abandonCandidate(candidate, channelId);

        if (commitOutcome.status === "deadline") {
            return { terminal: "deadline" };
        }
        return { terminal: false };
    }

    /** Releases the accepted-but-abandoned candidate's hold, resets any negotiation latch, and leaves its (authoritative) channel topic - never a transport close/blacklist/ban. */
    private async abandonCandidate(
        candidate: Candidate,
        channelId: string
    ): Promise<void> {
        try {
            await this.lobby.releaseIntent({
                peerAddress: candidate.ad.advertiser,
                adId: candidate.adId
            });
        } catch (error) {
            this.logger.warn(
                "releaseIntent failed for an abandoned candidate",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    adId: candidate.adId
                }
            );
        }
        this.getNegotiationService()?.resetForNewChannel();
        this.leaveChannelTopic(channelId);
    }

    /** COMMIT — JOIN: connectToChannel -> wait for sync -> collectJoinChannelConfirmation -> joinChannel -> wait for PARTICIPATING. */
    private async commitJoin(
        reporting: AttemptReporting,
        channelId: string,
        stakeAmountNumber: number,
        remainingDeadlineMs: () => number,
        record: (attempt: AcquireAttempt) => void
    ): Promise<{ status: "acquired" | "failed" | "deadline" }> {
        const { adId, advertiser, kind } = reporting;

        const connected = await this.runStage(
            "connect",
            () => this.signer.connectToChannel(channelId),
            config.LOBBY_COMMIT_CONNECT_TIMEOUT_MS,
            remainingDeadlineMs,
            adId,
            advertiser,
            kind,
            record
        );
        if (connected.status !== "ok") return { status: connected.status };

        const synced = await this.runStage(
            "sync",
            () => this.waitForStatusAtLeast(Status.SYNCED),
            config.LOBBY_COMMIT_SYNC_TIMEOUT_MS,
            remainingDeadlineMs,
            adId,
            advertiser,
            kind,
            record
        );
        if (synced.status !== "ok") return { status: synced.status };

        const confirmed = await this.runStage(
            "confirm",
            async () => {
                const chainTime = await Clock.getBlockchainTime();
                const ownAddress = await this.signer.getAddress();
                const joinChannel: JoinChannelStruct = {
                    channelId,
                    participant: ownAddress,
                    balance: { amount: BigInt(stakeAmountNumber), data: "0x" },
                    deadlineTimestamp: BigInt(
                        chainTime.timestamp + JOIN_DEADLINE_BUFFER_SECONDS
                    )
                };
                const prepared =
                    await this.signer.collectJoinChannelConfirmation(
                        joinChannel
                    );
                await this.signer.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
                await this.waitForStatusAtLeast(Status.PARTICIPATING);
            },
            config.LOBBY_COMMIT_CONFIRM_TIMEOUT_MS,
            remainingDeadlineMs,
            adId,
            advertiser,
            kind,
            record
        );
        if (confirmed.status !== "ok") return { status: confirmed.status };

        return { status: "acquired" };
    }

    /** COMMIT — OPEN: isChannelOpen precheck -> connect -> setStakeAmount -> beginNegotiation -> wait for PARTICIPATING. */
    private async commitOpen(
        candidate: Candidate,
        channelId: string,
        stakeAmountNumber: number,
        remainingDeadlineMs: () => number,
        record: (attempt: AcquireAttempt) => void
    ): Promise<{ status: "acquired" | "failed" | "deadline" }> {
        const { adId, ad } = candidate;
        const advertiser = ad.advertiser;
        const kind = ad.kind;

        // SECURITY — a stale/lying ad: the isChannelOpen precheck runs
        // against the chain-backed contract, never a cached ad field,
        // and keys on the AUTHORITATIVE proposed id
        // from the accept - `channelId`, not the ad's own hint.
        // Mirrors OpenChannelNegotiationService's own refresh-then-recheck
        // idiom.
        const stateManager = this.signer.p2pManager.stateManager;
        let [alreadyOpen] =
            await stateManager.diamondStateMachine.localDiamondContract.isChannelOpen(
                channelId
            );
        if (!alreadyOpen) {
            await stateManager.refreshOpenedStatusFromChain();
            [alreadyOpen] =
                await stateManager.diamondStateMachine.localDiamondContract.isChannelOpen(
                    channelId
                );
        }
        if (alreadyOpen) {
            record({
                adId,
                advertiser,
                kind,
                stage: "negotiate",
                outcome: "declined",
                reason: "channel-already-open"
            });
            return { status: "failed" };
        }

        const connected = await this.runStage(
            "connect",
            () => this.signer.connectToChannel(channelId),
            config.LOBBY_COMMIT_CONNECT_TIMEOUT_MS,
            remainingDeadlineMs,
            adId,
            advertiser,
            kind,
            record
        );
        if (connected.status !== "ok") return { status: connected.status };

        const negotiationService = this.getNegotiationService();
        if (negotiationService === undefined) {
            // Checked already in attemptCandidate before the intent was
            // sent; re-checked defensively since capability can't change
            // mid-commit in practice, but never assume.
            record({
                adId,
                advertiser,
                kind,
                stage: "negotiate",
                outcome: "error",
                reason: "negotiation-service-absent"
            });
            return { status: "failed" };
        }

        const negotiated = await this.runStage(
            "negotiate",
            async () => {
                negotiationService.setStakeAmount(stakeAmountNumber);
                await negotiationService.beginNegotiation(advertiser);
                await this.waitForStatusAtLeast(Status.PARTICIPATING);
            },
            config.LOBBY_COMMIT_CONFIRM_TIMEOUT_MS,
            remainingDeadlineMs,
            adId,
            advertiser,
            kind,
            record
        );
        if (negotiated.status !== "ok") return { status: negotiated.status };

        return { status: "acquired" };
    }

    /** Bounds a stage by the SMALLER of its own configured budget and the overall remaining deadline - a hung stage never eats the whole deadline, and the deadline is still respected if smaller. */
    private stageBudget(
        configuredTimeoutMs: number,
        remainingDeadlineMs: () => number
    ): number {
        return Math.min(
            configuredTimeoutMs,
            Math.max(0, remainingDeadlineMs())
        );
    }

    /** Runs one commit stage under its own budget, records a typed attempt on failure, and classifies the failure as "failed" (fall back) or "deadline" (terminal). */
    private async runStage(
        stage: AcquireStage,
        action: () => Promise<void>,
        configuredTimeoutMs: number,
        remainingDeadlineMs: () => number,
        adId: AdId,
        advertiser: string,
        kind: AdKind,
        record: (attempt: AcquireAttempt) => void
    ): Promise<{ status: "ok" | "failed" | "deadline" }> {
        if (remainingDeadlineMs() <= 0) {
            return { status: "deadline" };
        }
        const budgetMs = this.stageBudget(
            configuredTimeoutMs,
            remainingDeadlineMs
        );
        try {
            await this.withTimeout(action(), budgetMs, stage);
            record({ adId, advertiser, kind, stage, outcome: "ok" });
            return { status: "ok" };
        } catch (error) {
            if (error instanceof StageTimeoutError) {
                record({
                    adId,
                    advertiser,
                    kind,
                    stage,
                    outcome: "timeout",
                    reason: error.message
                });
            } else {
                record({
                    adId,
                    advertiser,
                    kind,
                    stage,
                    outcome: "error",
                    reason:
                        error instanceof Error ? error.message : String(error)
                });
            }
            return {
                status: remainingDeadlineMs() <= 0 ? "deadline" : "failed"
            };
        }
    }

    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        stage: AcquireStage
    ): Promise<T> {
        if (timeoutMs <= 0) {
            throw new StageTimeoutError(stage);
        }
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () => reject(new StageTimeoutError(stage)),
                timeoutMs
            );
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }

    /**
     * Resolves once `getChannelStatus()` reaches AT LEAST `minStatus`.
     * Subscribes to onStatusChanged BEFORE reading the current status
     * (LOST-WAKEUP fix): a transition landing between the read and the
     * subscribe would otherwise be missed entirely, hanging the stage to its
     * timeout on a spurious commit failure. Never self-times-out - it is
     * always called as the `action` inside {@link runStage}, whose outer
     * {@link withTimeout} owns the stage budget; racing a SECOND independent
     * timer here would either fire first (wasted work) or leave an orphaned
     * rejection with no listener (unhandled-rejection risk). On an outer
     * timeout this promise is simply abandoned - its listener unsubscribes
     * itself once/if the status eventually changes, or lives harmlessly
     * until the coordinator instance is GC'd.
     */
    private async waitForStatusAtLeast(minStatus: Status): Promise<void> {
        await new Promise<void>((resolve) => {
            const unsubscribe = this.events.on(
                "p2pEventHooks",
                "onStatusChanged",
                (_oldStatus, newStatus) => {
                    if (newStatus >= minStatus) {
                        unsubscribe();
                        resolve();
                    }
                }
            );
            this.signer
                .getChannelStatus()
                .then((current) => {
                    if (current >= minStatus) {
                        unsubscribe();
                        resolve();
                    }
                })
                .catch((error) => {
                    // Left subscribed: a subsequent real onStatusChanged
                    // transition still resolves this correctly, and the
                    // outer stage timeout is the backstop if it never comes.
                    this.logger.warn("getChannelStatus check failed", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    });
                });
        });
    }

    /**
     * Defensive capability check: OpenChannelNegotiationService
     * is opt-in and never guaranteed on p2pManager.localRpc's static type
     * (MainRpcService doesn't declare it) - resolve it narrowly at runtime
     * rather than reaching for it and risking a swallowed TypeError.
     */
    private getNegotiationService(): OpenChannelNegotiationService | undefined {
        const localRpc = this.signer.p2pManager.localRpc as unknown as {
            openChannelNegotiationService?: unknown;
        };
        return localRpc.openChannelNegotiationService instanceof
            OpenChannelNegotiationService
            ? localRpc.openChannelNegotiationService
            : undefined;
    }

    /** Holepunch.leave for an abandoned candidate's channel topic - mirrors P2PManager.tryOpenConnectionToChannel's own topic derivation exactly. A no-op if we never joined (leave() checks its own tracked topic list). */
    private leaveChannelTopic(channelId: string): void {
        if (config.DEBUG_LOCAL_TRANSPORT) return;
        const topic = Buffer.alloc(32).fill(channelId);
        this.signer.p2pManager.holepunch.leave(topic).catch((error) => {
            this.logger.warn("Failed to leave abandoned channel topic", {
                error: error instanceof Error ? error.message : String(error)
            });
        });
    }
}
