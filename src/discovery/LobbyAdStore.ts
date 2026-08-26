import { Logger } from "@/utils/logging/Logger";
import { getChecksumAddress } from "@/utils/address";
import {
    AdId,
    AdKind,
    AdRejectReason,
    ChannelAdStruct,
    adId as computeAdId,
    decodeChannelAd,
    validateReceivedAd
} from "@/discovery/ChannelAd";

/**
 * Ads are hints, never authority — this store
 * never proves anything; the commit path re-verifies on chain.
 * Freshness order of strength: connection-scoped drop > TTL > commit-time
 * re-verification. `seq` is reserved and intentionally NOT enforced here.
 */
export type AdStoreRejectReason =
    | AdRejectReason
    | "malformed"
    | "peer-cap"
    | "open-cap"
    | "global-cap"
    | "not-owner";

export type StoredAd = {
    adId: AdId;
    encodedAd: string;
    ad: ChannelAdStruct;
    receivedAtMs: number;
};

type AdStoreDeps = {
    // Must return an integer millisecond timestamp (Date.now()-like).
    // Fractional values throw a RangeError at BigInt conversion, including
    // inside validateReceivedAd.
    now: () => number;
    expectedApp: string;
    logger: Logger;
    // Caps are passed in explicitly (never read from the global config
    // singleton) so callers control sourcing/defaults and
    // tests can vary caps per-instance instead of mutating process-global
    // config.
    maxAdsPerPeer: number;
    maxOpenAdsPerPeer: number;
    maxAds: number;
};

/** True iff `amount` falls within the inclusive [minAmount, maxAmount] decimal-string bounds. */
function withinAmountBounds(
    amount: bigint | number,
    minAmount?: string,
    maxAmount?: string
): boolean {
    const value = BigInt(amount);
    if (minAmount !== undefined && value < BigInt(minAmount)) return false;
    if (maxAmount !== undefined && value > BigInt(maxAmount)) return false;
    return true;
}

/** Shallow-copies a StoredAd (including its `ad`) so callers can't mutate store internals. */
function cloneStoredAd(stored: StoredAd): StoredAd {
    return {
        adId: stored.adId,
        encodedAd: stored.encodedAd,
        ad: { ...stored.ad },
        receivedAtMs: stored.receivedAtMs
    };
}

/**
 * In-memory ad store: TTL eviction, per-peer and global caps, drop-on-peer-
 * disconnect, receive-side validation and OPEN-ad exclusivity. Pure data
 * structure with an injected clock — no sockets, fully unit-testable.
 *
 * Keyed by adId = keccak256(encodedAd), NOT by channelId: a
 * re-publish of identical bytes is idempotent (same adId, no-op), while a
 * changed ad is a NEW adId and supersedes the advertiser's older ad for the
 * same channelId.
 */
export class LobbyAdStore {
    private readonly now: () => number;
    private readonly expectedApp: string;
    private readonly logger: Logger;
    private readonly maxAdsPerPeer: number;
    private readonly maxOpenAdsPerPeer: number;
    private readonly maxAds: number;
    private readonly adsById: Map<AdId, StoredAd> = new Map();
    // advertiser (checksummed address) -> set of adIds currently stored for that advertiser
    private readonly adIdsByAdvertiser: Map<string, Set<AdId>> = new Map();

    constructor(deps: AdStoreDeps) {
        this.now = deps.now;
        this.expectedApp = deps.expectedApp;
        this.logger = deps.logger;
        this.maxAdsPerPeer = deps.maxAdsPerPeer;
        this.maxOpenAdsPerPeer = deps.maxOpenAdsPerPeer;
        this.maxAds = deps.maxAds;
    }

    public get size(): number {
        return this.adsById.size;
    }

    /**
     * Validates and stores a received ad. `authenticatedPeer` is the
     * connection-authenticated lobby peer address — SECURITY: an ad whose
     * `advertiser` field differs from that address is rejected and never
     * stored, regardless of what the frame body claims — validation happens
     * on RECEIVE, never on send.
     *
     * `encodedAd` is untrusted wire input: malformed/garbage bytes are
     * rejected with "malformed" rather than throwing.
     */
    public accept(args: {
        encodedAd: string;
        authenticatedPeer: string;
    }):
        | { ok: true; adId: AdId; superseded?: AdId; evicted?: AdId }
        | { ok: false; reason: AdStoreRejectReason } {
        let ad: ChannelAdStruct;
        try {
            ad = decodeChannelAd(args.encodedAd);
        } catch {
            this.logger.debug("LobbyAdStore.accept rejected", {
                reason: "malformed"
            });
            return { ok: false, reason: "malformed" };
        }

        const authenticatedPeer = getChecksumAddress(args.authenticatedPeer);
        const nowMs = BigInt(Math.floor(this.now()));
        const rejectReason = validateReceivedAd(ad, {
            expectedAdvertiser: authenticatedPeer,
            expectedApp: this.expectedApp,
            nowMs: Number(nowMs)
        });
        if (rejectReason !== undefined) {
            this.logger.debug("LobbyAdStore.accept rejected", {
                reason: rejectReason
            });
            return { ok: false, reason: rejectReason };
        }

        const newAdId = computeAdId(args.encodedAd);
        // Ad decoded off-chain data comes back checksummed via ethers ABI
        // decoding, and equals authenticatedPeer (validateReceivedAd just
        // confirmed it) — normalize anyway so the advertiser key is never
        // sensitive to casing.
        const advertiser = getChecksumAddress(ad.advertiser);

        // Idempotent re-publish: identical bytes -> same adId -> no-op, does
        // not double-count against the per-peer cap.
        const existing = this.adsById.get(newAdId);
        if (existing !== undefined) {
            return { ok: true, adId: newAdId };
        }

        // Same advertiser + same channelId supersedes the
        // advertiser's older ad for that channelId (a changed ad is a new
        // adId, but only one ad per advertiser per channelId is kept).
        const superseded = this.findSupersededAdId(advertiser, ad.channelId);

        // Cap checks count only LIVE (non-expired) entries, so a store full
        // of ads nobody has swept yet doesn't block newcomers until the next
        // external sweep() call. That liveness win must not reopen the
        // PHYSICAL size bound the store guarantees (unswept expired ads
        // still occupy memory — an authenticated peer could otherwise flood
        // min-TTL ads that stay invisible to every live-count check and
        // never get reclaimed, growing adsById without bound). Mitigation:
        // once the physical count would already be at cap, purge THIS
        // advertiser's own expired entries inline before counting — after
        // the purge, physical == live for that advertiser, so the live gate
        // is also the physical gate. Net effect: an advertiser at cap with
        // expired ads of its own can still publish, AND its physical count
        // can never exceed maxAdsPerPeer.
        const advertiserAdIdsBeforePurge =
            this.adIdsByAdvertiser.get(advertiser);
        const physicalPeerCount =
            (advertiserAdIdsBeforePurge?.size ?? 0) -
            (superseded !== undefined ? 1 : 0);
        if (physicalPeerCount >= this.maxAdsPerPeer) {
            this.purgeExpiredOwnAds(advertiser, nowMs);
        }
        const effectivePeerCount = this.countLive(
            this.adIdsByAdvertiser.get(advertiser),
            nowMs,
            superseded
        );
        if (effectivePeerCount >= this.maxAdsPerPeer) {
            this.logger.debug("LobbyAdStore.accept rejected", {
                advertiser,
                reason: "peer-cap",
                size: this.adsById.size
            });
            return { ok: false, reason: "peer-cap" };
        }

        if (BigInt(ad.kind) === BigInt(AdKind.OPEN)) {
            // Exclude the superseded ad (it's about to be removed regardless
            // of its kind) so a same-channel re-publish of an OPEN ad isn't
            // double-counted against itself.
            const openCount = this.countOpenAds(advertiser, nowMs, superseded);
            if (openCount >= this.maxOpenAdsPerPeer) {
                this.logger.debug("LobbyAdStore.accept rejected", {
                    advertiser,
                    reason: "open-cap",
                    size: this.adsById.size
                });
                return { ok: false, reason: "open-cap" };
            }
        }

        // Global cap: a breach REJECTS the new ad unless the SAME advertiser
        // has an own soonest-expiring LIVE entry that expires sooner than
        // the incoming ad (anti-eviction-spam). The eviction candidate is
        // scoped to the incoming advertiser's own ads ONLY — never any other
        // peer's — so no wallet, fresh or otherwise, can ever evict an ad it
        // doesn't own, no matter how the chronological order of the whole
        // store lines up. This holds under repeated publish/withdraw
        // cycling by a single identity too: an advertiser can only ever
        // trade slots with itself.
        //
        // Same physical-size tradeoff as the peer cap above: counting only
        // LIVE entries would otherwise let unswept expired ads inflate
        // adsById past maxAds forever (memory-exhaustion DoS via min-TTL
        // flooding). Mitigation: once the PHYSICAL store size would already
        // be at cap, purge all expired entries store-wide inline first —
        // after the purge physical == live, so the live gate is also the
        // physical gate and adsById.size can never exceed maxAds.
        //
        // Residual (deferred, not mitigated here — belongs to a gossip layer):
        // this only bounds cross-peer eviction and physical size. It does
        // NOT globally cap same-advertiser renewal, so N throwaway wallets
        // can each hold a long-lived slot ("slot squatting") without ever
        // evicting anyone; fair-share/reputation weighting is out of scope
        let evictedAdId: AdId | undefined;
        const physicalGlobalCount =
            this.adsById.size - (superseded !== undefined ? 1 : 0);
        if (physicalGlobalCount >= this.maxAds) {
            this.purgeExpiredGlobal(nowMs);
        }
        const effectiveGlobalCount = this.countLive(
            this.adsById.keys(),
            nowMs,
            superseded
        );
        if (effectiveGlobalCount >= this.maxAds) {
            const soonestOwn = this.findSoonestOwnExpiring(
                advertiser,
                superseded
            );
            if (
                soonestOwn === undefined ||
                BigInt(soonestOwn.ad.expiresAtMs) >= BigInt(ad.expiresAtMs)
            ) {
                this.logger.debug("LobbyAdStore.accept rejected", {
                    advertiser,
                    reason: "global-cap",
                    size: this.adsById.size
                });
                return { ok: false, reason: "global-cap" };
            }
            evictedAdId = soonestOwn.adId;
            this.logger.debug("LobbyAdStore.accept evicting own ad", {
                advertiser,
                evictedAdId,
                size: this.adsById.size
            });
        }

        if (superseded !== undefined) {
            this.removeAd(superseded);
        }
        if (evictedAdId !== undefined) {
            this.removeAd(evictedAdId);
        }

        const stored: StoredAd = {
            adId: newAdId,
            encodedAd: args.encodedAd,
            ad,
            receivedAtMs: this.now()
        };
        this.adsById.set(newAdId, stored);
        let ids = this.adIdsByAdvertiser.get(advertiser);
        if (ids === undefined) {
            ids = new Set();
            this.adIdsByAdvertiser.set(advertiser, ids);
        }
        ids.add(newAdId);

        const result: {
            ok: true;
            adId: AdId;
            superseded?: AdId;
            evicted?: AdId;
        } = { ok: true, adId: newAdId };
        if (superseded !== undefined) result.superseded = superseded;
        if (evictedAdId !== undefined) result.evicted = evictedAdId;
        return result;
    }

    /** Withdraws an ad. Only the owning advertiser may withdraw it. */
    public withdraw(args: { adId: AdId; requester: string }): {
        ok: boolean;
        reason?: AdStoreRejectReason;
    } {
        const stored = this.adsById.get(args.adId);
        if (stored === undefined) {
            return { ok: false };
        }
        const requester = getChecksumAddress(args.requester);
        if (stored.ad.advertiser !== requester) {
            return { ok: false, reason: "not-owner" };
        }
        this.removeAd(args.adId);
        return { ok: true };
    }

    /** Removes ALL ads from `advertiser`; returns the removed adIds. */
    public dropByPeer(advertiser: string): AdId[] {
        const normalizedAdvertiser = getChecksumAddress(advertiser);
        const ids = this.adIdsByAdvertiser.get(normalizedAdvertiser);
        if (ids === undefined) return [];
        const removed = Array.from(ids);
        for (const id of removed) {
            this.removeAd(id);
        }
        return removed;
    }

    /** Removes every ad whose expiresAtMs is <= now; returns the removed adIds. */
    public sweep(): AdId[] {
        return this.purgeExpiredGlobal(BigInt(Math.floor(this.now())));
    }

    /** Lists non-expired ads, optionally filtered by kind and/or amount bounds (inclusive). */
    public list(filter?: {
        kind?: AdKind;
        minAmount?: string;
        maxAmount?: string;
    }): StoredAd[] {
        const nowMs = BigInt(Math.floor(this.now()));
        const result: StoredAd[] = [];
        for (const stored of this.adsById.values()) {
            if (BigInt(stored.ad.expiresAtMs) <= nowMs) continue;
            if (
                filter?.kind !== undefined &&
                BigInt(stored.ad.kind) !== BigInt(filter.kind)
            )
                continue;
            if (
                !withinAmountBounds(
                    stored.ad.amount,
                    filter?.minAmount,
                    filter?.maxAmount
                )
            )
                continue;
            result.push(cloneStoredAd(stored));
        }
        return result;
    }

    public get(adId: AdId): StoredAd | undefined {
        const stored = this.adsById.get(adId);
        return stored === undefined ? undefined : cloneStoredAd(stored);
    }

    /** Finds the existing adId from `advertiser` for the same `channelId`, if any. */
    private findSupersededAdId(
        advertiser: string,
        channelId: string
    ): AdId | undefined {
        const ids = this.adIdsByAdvertiser.get(advertiser);
        if (ids === undefined) return undefined;
        for (const id of ids) {
            const stored = this.adsById.get(id);
            if (stored !== undefined && stored.ad.channelId === channelId) {
                return id;
            }
        }
        return undefined;
    }

    /** Counts LIVE (non-expired) ads in `ids`, excluding `excludeAdId`. */
    private countLive(
        ids: Iterable<AdId> | undefined,
        nowMs: bigint,
        excludeAdId?: AdId
    ): number {
        if (ids === undefined) return 0;
        let count = 0;
        for (const id of ids) {
            if (id === excludeAdId) continue;
            const stored = this.adsById.get(id);
            if (stored !== undefined && BigInt(stored.ad.expiresAtMs) > nowMs) {
                count++;
            }
        }
        return count;
    }

    /** Counts LIVE OPEN ads from `advertiser`, excluding `excludeAdId` (the ad about to be superseded). */
    private countOpenAds(
        advertiser: string,
        nowMs: bigint,
        excludeAdId?: AdId
    ): number {
        const ids = this.adIdsByAdvertiser.get(advertiser);
        if (ids === undefined) return 0;
        let count = 0;
        for (const id of ids) {
            if (id === excludeAdId) continue;
            const stored = this.adsById.get(id);
            if (
                stored !== undefined &&
                BigInt(stored.ad.expiresAtMs) > nowMs &&
                BigInt(stored.ad.kind) === BigInt(AdKind.OPEN)
            ) {
                count++;
            }
        }
        return count;
    }

    /**
     * Finds `advertiser`'s OWN soonest-expiring entry, excluding
     * `excludeAdId`. Scoped strictly to `advertiser` — the global-cap
     * eviction candidate must never come from a different peer's ads.
     */
    private findSoonestOwnExpiring(
        advertiser: string,
        excludeAdId?: AdId
    ): StoredAd | undefined {
        const ids = this.adIdsByAdvertiser.get(advertiser);
        if (ids === undefined) return undefined;
        let soonest: StoredAd | undefined;
        for (const id of ids) {
            if (id === excludeAdId) continue;
            const stored = this.adsById.get(id);
            if (stored === undefined) continue;
            if (
                soonest === undefined ||
                BigInt(stored.ad.expiresAtMs) < BigInt(soonest.ad.expiresAtMs)
            ) {
                soonest = stored;
            }
        }
        return soonest;
    }

    /** Removes `advertiser`'s own expired entries (physical-size mitigation, see accept()). */
    private purgeExpiredOwnAds(advertiser: string, nowMs: bigint): void {
        const ids = this.adIdsByAdvertiser.get(advertiser);
        if (ids === undefined) return;
        const expired: AdId[] = [];
        for (const id of ids) {
            const stored = this.adsById.get(id);
            if (
                stored !== undefined &&
                BigInt(stored.ad.expiresAtMs) <= nowMs
            ) {
                expired.push(id);
            }
        }
        for (const id of expired) {
            this.removeAd(id);
        }
    }

    /** Removes every expired entry store-wide; returns the removed adIds. Backs both sweep() and the inline global-cap purge (see accept()). */
    private purgeExpiredGlobal(nowMs: bigint): AdId[] {
        const expired: AdId[] = [];
        for (const stored of this.adsById.values()) {
            if (BigInt(stored.ad.expiresAtMs) <= nowMs) {
                expired.push(stored.adId);
            }
        }
        for (const id of expired) {
            this.removeAd(id);
        }
        return expired;
    }

    private removeAd(id: AdId): void {
        const stored = this.adsById.get(id);
        if (stored === undefined) return;
        this.adsById.delete(id);
        const ids = this.adIdsByAdvertiser.get(stored.ad.advertiser);
        if (ids !== undefined) {
            ids.delete(id);
            if (ids.size === 0) {
                this.adIdsByAdvertiser.delete(stored.ad.advertiser);
            }
        }
    }
}
