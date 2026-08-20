import { expect } from "chai";
import { ethers } from "ethers";
import { createLogger } from "@/utils";
import { config } from "@/utils/config";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    ChannelAdStruct,
    adId,
    encodeChannelAd
} from "@/discovery/ChannelAd";
import { LobbyAdStore } from "@/discovery/LobbyAdStore";
import * as factory from "../factory";

function bytes32(): string {
    return ethers.hexlify(ethers.randomBytes(32));
}

function dataOfLength(bytesLen: number): string {
    return `0x${"ab".repeat(bytesLen)}`;
}

const expectedApp = bytes32();

function baseAd(overrides: Partial<ChannelAdStruct> = {}): ChannelAdStruct {
    return {
        v: CHANNEL_AD_VERSION,
        kind: AdKind.JOIN,
        channelId: bytes32(),
        advertiser: factory.randomWallet().address,
        app: expectedApp,
        seq: 0n,
        expiresAtMs: 1_000_000n,
        capacity: 2,
        filled: 0,
        amount: 100n,
        data: dataOfLength(16),
        signature: "0x",
        ...overrides
    };
}

// Caps are constructor deps (not read from the global config singleton), so
// tests vary them per-instance instead of mutating process-global config.
function makeStore(
    nowMs: { value: number },
    caps: {
        maxAdsPerPeer?: number;
        maxOpenAdsPerPeer?: number;
        maxAds?: number;
    } = {}
) {
    return new LobbyAdStore({
        now: () => nowMs.value,
        expectedApp,
        logger: createLogger({}, {}, { level: "error" }),
        maxAdsPerPeer: caps.maxAdsPerPeer ?? config.LOBBY_MAX_ADS_PER_PEER,
        maxOpenAdsPerPeer:
            caps.maxOpenAdsPerPeer ?? config.LOBBY_MAX_OPEN_ADS_PER_PEER,
        maxAds: caps.maxAds ?? config.LOBBY_MAX_ADS
    });
}

describe("LobbyAdStore", () => {
    describe("accept — receive-side validation", () => {
        it("rejects an ad whose advertiser !== the authenticated peer, and does not store it", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const impostor = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);

            const result = store.accept({
                encodedAd,
                authenticatedPeer: impostor
            });

            expect(result.ok).to.equal(false);
            expect((result as { reason: string }).reason).to.equal(
                "advertiser-mismatch"
            );
            expect(store.size).to.equal(0);
        });

        it("rejects data longer than LOBBY_AD_MAX_DATA_BYTES with 'data-size'", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({
                advertiser,
                expiresAtMs: 10_000n,
                data: dataOfLength(config.LOBBY_AD_MAX_DATA_BYTES + 1)
            });
            const { encodedAd } = encodeChannelAd(ad);

            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });

            expect(result.ok).to.equal(false);
            expect((result as { reason: string }).reason).to.equal("data-size");
            expect(store.size).to.equal(0);
        });

        it("rejects expiresAtMs beyond the TTL cap with 'ttl-cap' rather than clamping", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({
                advertiser,
                expiresAtMs: BigInt(
                    nowMs.value + config.LOBBY_AD_MAX_TTL_MS + 1
                )
            });
            const { encodedAd } = encodeChannelAd(ad);

            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });

            expect(result.ok).to.equal(false);
            expect((result as { reason: string }).reason).to.equal("ttl-cap");
            expect(store.size).to.equal(0);
        });

        it("accepts a valid ad and stores it keyed by adId", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);

            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });

            expect(result.ok).to.equal(true);
            const expectedId = adId(encodedAd);
            expect((result as { adId: string }).adId).to.equal(expectedId);
            const stored = store.get(expectedId);
            expect(stored, "stored ad").to.not.be.undefined;
            expect(stored!.ad.advertiser).to.equal(advertiser);
        });

        it("rejects malformed/garbage encodedAd bytes with 'malformed' instead of throwing", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const someAddress = factory.randomWallet().address;

            for (const garbage of ["0xdeadbeef", "0x"]) {
                let result: ReturnType<typeof store.accept> | undefined;
                expect(() => {
                    result = store.accept({
                        encodedAd: garbage,
                        authenticatedPeer: someAddress
                    });
                }, `accept(${garbage}) must not throw`).to.not.throw();

                expect(result!.ok, `accept(${garbage}).ok`).to.equal(false);
                expect(
                    (result as { reason: string }).reason,
                    `accept(${garbage}).reason`
                ).to.equal("malformed");
            }
            expect(store.size).to.equal(0);
        });
    });

    describe("get/list return copies, not live references", () => {
        it("mutating a StoredAd returned by get() does not affect the store's internal bookkeeping", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            const storedAdId = (result as { adId: string }).adId;

            const first = store.get(storedAdId)!;
            first.ad.advertiser = factory.randomWallet().address;

            const second = store.get(storedAdId)!;
            expect(second.ad.advertiser).to.equal(advertiser);

            // dropByPeer must still find the ad under the original advertiser.
            const removed = store.dropByPeer(advertiser);
            expect(removed).to.deep.equal([storedAdId]);
        });
    });

    describe("idempotent re-publish", () => {
        it("re-publishing identical bytes is a no-op and does not double-count against the peer cap", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);

            const first = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            const second = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });

            expect(first.ok).to.equal(true);
            expect(second.ok).to.equal(true);
            expect((first as { adId: string }).adId).to.equal(
                (second as { adId: string }).adId
            );
            expect(store.size).to.equal(1);

            // Fill the rest of the peer cap with distinct ads to confirm the
            // re-publish above did not consume a slot.
            for (let i = 0; i < config.LOBBY_MAX_ADS_PER_PEER - 1; i++) {
                const distinct = baseAd({
                    advertiser,
                    channelId: bytes32(),
                    expiresAtMs: 10_000n
                });
                const { encodedAd: encodedDistinct } =
                    encodeChannelAd(distinct);
                const r = store.accept({
                    encodedAd: encodedDistinct,
                    authenticatedPeer: advertiser
                });
                expect(r.ok, `distinct ad #${i} accepted`).to.equal(true);
            }
            expect(store.size).to.equal(config.LOBBY_MAX_ADS_PER_PEER);
        });
    });

    describe("same-advertiser same-channelId supersede", () => {
        it("a changed ad for the same channelId gets a new adId and supersedes the older one", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const channelId = bytes32();
            const original = baseAd({
                advertiser,
                channelId,
                expiresAtMs: 10_000n
            });
            const { encodedAd: encodedOriginal } = encodeChannelAd(original);
            const originalResult = store.accept({
                encodedAd: encodedOriginal,
                authenticatedPeer: advertiser
            });
            expect(originalResult.ok).to.equal(true);
            const originalAdId = (originalResult as { adId: string }).adId;

            const changed = baseAd({
                advertiser,
                channelId,
                expiresAtMs: 20_000n,
                capacity: 5
            });
            const { encodedAd: encodedChanged } = encodeChannelAd(changed);
            const changedResult = store.accept({
                encodedAd: encodedChanged,
                authenticatedPeer: advertiser
            });

            expect(changedResult.ok).to.equal(true);
            const { adId: changedAdId, superseded } = changedResult as {
                adId: string;
                superseded?: string;
            };
            expect(changedAdId).to.not.equal(originalAdId);
            expect(superseded).to.equal(originalAdId);
            expect(store.get(originalAdId)).to.be.undefined;
            expect(store.get(changedAdId)).to.not.be.undefined;
            expect(store.size).to.equal(1);
        });
    });

    describe("caps", () => {
        it("the (LOBBY_MAX_ADS_PER_PEER+1)-th ad from one peer is rejected with 'peer-cap'", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;

            for (let i = 0; i < config.LOBBY_MAX_ADS_PER_PEER; i++) {
                const ad = baseAd({
                    advertiser,
                    channelId: bytes32(),
                    expiresAtMs: 10_000n
                });
                const { encodedAd } = encodeChannelAd(ad);
                const r = store.accept({
                    encodedAd,
                    authenticatedPeer: advertiser
                });
                expect(r.ok, `ad #${i} accepted`).to.equal(true);
            }

            const overflow = baseAd({
                advertiser,
                channelId: bytes32(),
                expiresAtMs: 10_000n
            });
            const { encodedAd: encodedOverflow } = encodeChannelAd(overflow);
            const result = store.accept({
                encodedAd: encodedOverflow,
                authenticatedPeer: advertiser
            });

            expect(result.ok).to.equal(false);
            expect((result as { reason: string }).reason).to.equal("peer-cap");
            expect(store.size).to.equal(config.LOBBY_MAX_ADS_PER_PEER);
        });

        it("a second OPEN ad from the same advertiser is rejected with 'open-cap' while a JOIN ad is still accepted", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;

            const openAd = baseAd({
                advertiser,
                kind: AdKind.OPEN,
                channelId: bytes32(),
                expiresAtMs: 10_000n
            });
            const { encodedAd: encodedOpen } = encodeChannelAd(openAd);
            const firstOpen = store.accept({
                encodedAd: encodedOpen,
                authenticatedPeer: advertiser
            });
            expect(firstOpen.ok).to.equal(true);

            const secondOpenAd = baseAd({
                advertiser,
                kind: AdKind.OPEN,
                channelId: bytes32(),
                expiresAtMs: 10_000n
            });
            const { encodedAd: encodedSecondOpen } =
                encodeChannelAd(secondOpenAd);
            const secondOpen = store.accept({
                encodedAd: encodedSecondOpen,
                authenticatedPeer: advertiser
            });
            expect(secondOpen.ok).to.equal(false);
            expect((secondOpen as { reason: string }).reason).to.equal(
                "open-cap"
            );

            const joinAd = baseAd({
                advertiser,
                kind: AdKind.JOIN,
                channelId: bytes32(),
                expiresAtMs: 10_000n
            });
            const { encodedAd: encodedJoin } = encodeChannelAd(joinAd);
            const join = store.accept({
                encodedAd: encodedJoin,
                authenticatedPeer: advertiser
            });
            expect(join.ok).to.equal(true);
            expect(store.size).to.equal(2);
        });

        describe("global cap — eviction is scoped to the publisher's OWN ads", () => {
            const GLOBAL_CAP = 3;

            function fillToGlobalCap(
                store: LobbyAdStore
            ): { advertiser: string; adId: string; expiresAtMs: bigint }[] {
                const stored: {
                    advertiser: string;
                    adId: string;
                    expiresAtMs: bigint;
                }[] = [];
                for (let i = 0; i < GLOBAL_CAP; i++) {
                    const advertiser = factory.randomWallet().address;
                    const expiresAtMs = BigInt(10_000 + i * 1000);
                    const ad = baseAd({
                        advertiser,
                        channelId: bytes32(),
                        expiresAtMs
                    });
                    const { encodedAd } = encodeChannelAd(ad);
                    const r = store.accept({
                        encodedAd,
                        authenticatedPeer: advertiser
                    });
                    expect(r.ok, `ad #${i} accepted`).to.equal(true);
                    stored.push({
                        advertiser,
                        adId: (r as { adId: string }).adId,
                        expiresAtMs
                    });
                }
                expect(store.size).to.equal(GLOBAL_CAP);
                return stored;
                // stored[0] expires soonest (10_000, the store-wide soonest),
                // stored[1] at 11_000, stored[2] at 12_000.
            }

            it("(a) a fresh advertiser with a long-TTL ad is REJECTED at the global cap — it owns nothing to evict, even though its ad expires later than every stored ad", () => {
                const nowMs = { value: 1000 };
                const store = makeStore(nowMs, { maxAds: GLOBAL_CAP });
                const stored = fillToGlobalCap(store);

                const attacker = factory.randomWallet().address;
                const longTtl = baseAd({
                    advertiser: attacker,
                    channelId: bytes32(),
                    expiresAtMs: 200_000n // later than every stored ad
                });
                const { encodedAd } = encodeChannelAd(longTtl);
                const result = store.accept({
                    encodedAd,
                    authenticatedPeer: attacker
                });

                expect(result.ok).to.equal(false);
                expect((result as { reason: string }).reason).to.equal(
                    "global-cap"
                );
                expect(store.size).to.equal(GLOBAL_CAP);
                for (const s of stored) {
                    expect(
                        store.get(s.adId),
                        `honest ad from ${s.advertiser} survives`
                    ).to.not.be.undefined;
                }
            });

            it("(b) an advertiser whose own entry is NOT the store-wide soonest may evict only its OWN entry — a global chronological scan would have picked a different peer's ad", () => {
                const nowMs = { value: 1000 };
                const store = makeStore(nowMs, { maxAds: GLOBAL_CAP });
                const stored = fillToGlobalCap(store);
                // owner's own entry (12_000) is the LATEST of the three, not
                // the store-wide soonest (stored[0], 10_000). A buggy
                // whole-store scan would evict stored[0] (a stranger's ad);
                // the correct impl must evict only the owner's own entry.
                const owner = stored[2];

                const laterOwnChannelId = bytes32(); // different channelId -> no supersede, a genuinely new adId
                const laterOwn = baseAd({
                    advertiser: owner.advertiser,
                    channelId: laterOwnChannelId,
                    expiresAtMs: 200_000n
                });
                const { encodedAd } = encodeChannelAd(laterOwn);
                const result = store.accept({
                    encodedAd,
                    authenticatedPeer: owner.advertiser
                });

                expect(result.ok).to.equal(true);
                expect(store.size).to.equal(GLOBAL_CAP);
                // S2: the eviction is reported back symmetrically to `superseded`.
                expect((result as { evicted?: string }).evicted).to.equal(
                    owner.adId
                );
                // The owner's own entry was evicted.
                expect(store.get(owner.adId)).to.be.undefined;
                expect(store.get((result as { adId: string }).adId)).to.not.be
                    .undefined;
                // The store-wide soonest ad (a DIFFERENT peer's) survived —
                // proof the eviction scan never left the owner's own set.
                expect(store.get(stored[0].adId)).to.not.be.undefined;
                expect(store.get(stored[1].adId)).to.not.be.undefined;
            });

            it("(b-negative) an advertiser whose only own entry expires LATER than the incoming ad gets 'global-cap' — even though a different peer's ad is chronologically sooner", () => {
                const nowMs = { value: 1000 };
                const store = makeStore(nowMs, { maxAds: GLOBAL_CAP });
                const stored = fillToGlobalCap(store);
                // owner's own entry (12_000) is later-expiring than the
                // incoming ad below. A buggy whole-store scan would still
                // find stored[0] (10_000, a stranger's ad) sooner than the
                // incoming ad and evict it; the correct impl must reject
                // instead, since the owner itself has nothing sooner.
                const owner = stored[2];

                const soonerThanOwn = baseAd({
                    advertiser: owner.advertiser,
                    channelId: bytes32(),
                    expiresAtMs: 11_500n // > stored[0]/stored[1], < owner's own 12_000
                });
                const { encodedAd } = encodeChannelAd(soonerThanOwn);
                const result = store.accept({
                    encodedAd,
                    authenticatedPeer: owner.advertiser
                });

                expect(result.ok).to.equal(false);
                expect((result as { reason: string }).reason).to.equal(
                    "global-cap"
                );
                expect(store.size).to.equal(GLOBAL_CAP);
                for (const s of stored) {
                    expect(
                        store.get(s.adId),
                        `honest ad from ${s.advertiser} survives`
                    ).to.not.be.undefined;
                }
            });

            it("(b-boundary) equal expiry between the incoming ad and the owner's own soonest entry is rejected with 'global-cap' (strict '>' required to evict)", () => {
                const nowMs = { value: 1000 };
                const store = makeStore(nowMs, { maxAds: GLOBAL_CAP });
                const stored = fillToGlobalCap(store);
                const owner = stored[2]; // owns the 12_000 entry

                const equalExpiry = baseAd({
                    advertiser: owner.advertiser,
                    channelId: bytes32(),
                    expiresAtMs: owner.expiresAtMs // exactly 12_000
                });
                const { encodedAd } = encodeChannelAd(equalExpiry);
                const result = store.accept({
                    encodedAd,
                    authenticatedPeer: owner.advertiser
                });

                expect(result.ok).to.equal(false);
                expect((result as { reason: string }).reason).to.equal(
                    "global-cap"
                );
                expect(store.get(owner.adId)).to.not.be.undefined;
            });

            it("(c) repeated publish attempts at the cap by an advertiser owning nothing are all rejected — footprint never leaves 0", () => {
                const nowMs = { value: 1000 };
                const store = makeStore(nowMs, { maxAds: GLOBAL_CAP });
                const stored = fillToGlobalCap(store);

                const attacker = factory.randomWallet().address;
                for (let i = 0; i < 3; i++) {
                    const ad = baseAd({
                        advertiser: attacker,
                        channelId: bytes32(),
                        expiresAtMs: 200_000n
                    });
                    const { encodedAd } = encodeChannelAd(ad);
                    const result = store.accept({
                        encodedAd,
                        authenticatedPeer: attacker
                    });
                    expect(result.ok, `attempt #${i} publish`).to.equal(false);
                    expect(
                        (result as { reason: string }).reason,
                        `attempt #${i} reason`
                    ).to.equal("global-cap");
                }

                expect(store.size).to.equal(GLOBAL_CAP);
                for (const s of stored) {
                    expect(
                        store.get(s.adId),
                        `honest ad from ${s.advertiser} survives`
                    ).to.not.be.undefined;
                }
            });

            it("(c-cycle) a genuine publish -> withdraw -> publish cycle by one identity never touches another peer's ad", () => {
                const nowMs = { value: 1000 };
                // Only 2 honest ads at start, leaving one free slot so the
                // cyclist can legitimately occupy it before the cap bites.
                const store = makeStore(nowMs, { maxAds: GLOBAL_CAP });
                const honestAdvertisers = [
                    factory.randomWallet().address,
                    factory.randomWallet().address
                ];
                const honestAdIds: string[] = [];
                for (const advertiser of honestAdvertisers) {
                    const ad = baseAd({
                        advertiser,
                        channelId: bytes32(),
                        expiresAtMs: 10_000n
                    });
                    const { encodedAd } = encodeChannelAd(ad);
                    const r = store.accept({
                        encodedAd,
                        authenticatedPeer: advertiser
                    });
                    expect(r.ok).to.equal(true);
                    honestAdIds.push((r as { adId: string }).adId);
                }
                expect(store.size).to.equal(2);

                const cyclist = factory.randomWallet().address;
                let previousCyclistAdId: string | undefined;
                for (let cycle = 0; cycle < 3; cycle++) {
                    // Publish: fills the cap to 3 legitimately (own slot).
                    const ad = baseAd({
                        advertiser: cyclist,
                        channelId: bytes32(),
                        expiresAtMs: 200_000n + BigInt(cycle)
                    });
                    const { encodedAd } = encodeChannelAd(ad);
                    const result = store.accept({
                        encodedAd,
                        authenticatedPeer: cyclist
                    });
                    expect(result.ok, `cycle #${cycle} publish`).to.equal(true);
                    const cyclistAdId = (result as { adId: string }).adId;
                    expect(store.size).to.equal(GLOBAL_CAP);
                    // Only the cyclist's own previous slot could have been
                    // evicted (never an honest one).
                    if (previousCyclistAdId !== undefined) {
                        expect(store.get(previousCyclistAdId)).to.be.undefined;
                    }

                    // Withdraw: frees the slot back to 2, under the cap.
                    const withdrawResult = store.withdraw({
                        adId: cyclistAdId,
                        requester: cyclist
                    });
                    expect(
                        withdrawResult.ok,
                        `cycle #${cycle} withdraw`
                    ).to.equal(true);
                    expect(store.size).to.equal(2);

                    previousCyclistAdId = cyclistAdId;

                    // Honest ads are untouched throughout every cycle.
                    for (const id of honestAdIds) {
                        expect(
                            store.get(id),
                            `honest ad survives cycle #${cycle}`
                        ).to.not.be.undefined;
                    }
                }
            });

            it("(physical bound) a min-TTL flood by one advertiser, without any external sweep(), keeps adsById's PHYSICAL size <= maxAds", () => {
                const nowMs = { value: 1000 };
                // A high peer cap isolates this test to the global physical
                // bound: only the global-cap inline purge is exercised.
                const store = makeStore(nowMs, {
                    maxAds: GLOBAL_CAP,
                    maxAdsPerPeer: 1000
                });
                const attacker = factory.randomWallet().address;

                for (let i = 0; i < 20; i++) {
                    // Distinct channelId each time -> never supersedes, so
                    // every accepted publish is a genuinely new physical
                    // entry. TTL expires almost immediately.
                    const ad = baseAd({
                        advertiser: attacker,
                        channelId: bytes32(),
                        expiresAtMs: BigInt(nowMs.value + 1)
                    });
                    const { encodedAd } = encodeChannelAd(ad);
                    store.accept({ encodedAd, authenticatedPeer: attacker });

                    // Nothing ever calls sweep() in this test — the only
                    // thing that may reclaim expired entries is the inline
                    // purge inside accept() itself.
                    expect(
                        store.size,
                        `physical size after publish #${i}`
                    ).to.be.at.most(GLOBAL_CAP);

                    // Advance the clock past this ad's TTL before the next
                    // publish, so the attacker's own LIVE count is back to
                    // (at most) 0 by the time it tries again — without the
                    // physical-size purge, that would let it keep adding
                    // physical entries the live-only gate never sees.
                    nowMs.value += 2;
                }

                expect(store.size).to.be.at.most(GLOBAL_CAP);
            });
        });
    });

    describe("list — kind/minAmount/maxAmount filters", () => {
        function acceptAd(
            store: LobbyAdStore,
            overrides: Partial<ChannelAdStruct>
        ): string {
            const advertiser =
                overrides.advertiser ?? factory.randomWallet().address;
            const ad = baseAd({
                channelId: bytes32(),
                expiresAtMs: 10_000n,
                ...overrides,
                advertiser
            });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            expect(result.ok, "ad accepted").to.equal(true);
            return (result as { adId: string }).adId;
        }

        it("filters by kind", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const openId = acceptAd(store, { kind: AdKind.OPEN });
            const joinId = acceptAd(store, { kind: AdKind.JOIN });

            const openOnly = store.list({ kind: AdKind.OPEN });
            expect(openOnly.map((s) => s.adId)).to.deep.equal([openId]);

            const joinOnly = store.list({ kind: AdKind.JOIN });
            expect(joinOnly.map((s) => s.adId)).to.deep.equal([joinId]);
        });

        it("filters by minAmount only (inclusive)", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const lowId = acceptAd(store, { amount: 50n });
            const boundaryId = acceptAd(store, { amount: 100n });
            const highId = acceptAd(store, { amount: 150n });

            const result = store.list({ minAmount: "100" });
            expect(result.map((s) => s.adId).sort()).to.deep.equal(
                [boundaryId, highId].sort()
            );
            expect(result.map((s) => s.adId)).to.not.include(lowId);
        });

        it("filters by maxAmount only (inclusive)", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const lowId = acceptAd(store, { amount: 50n });
            const boundaryId = acceptAd(store, { amount: 100n });
            const highId = acceptAd(store, { amount: 150n });

            const result = store.list({ maxAmount: "100" });
            expect(result.map((s) => s.adId).sort()).to.deep.equal(
                [lowId, boundaryId].sort()
            );
            expect(result.map((s) => s.adId)).to.not.include(highId);
        });

        it("filters by minAmount AND maxAmount together (inclusive range)", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const belowId = acceptAd(store, { amount: 40n });
            const lowBoundaryId = acceptAd(store, { amount: 50n });
            const midId = acceptAd(store, { amount: 75n });
            const highBoundaryId = acceptAd(store, { amount: 100n });
            const aboveId = acceptAd(store, { amount: 200n });

            const result = store.list({ minAmount: "50", maxAmount: "100" });
            expect(result.map((s) => s.adId).sort()).to.deep.equal(
                [lowBoundaryId, midId, highBoundaryId].sort()
            );
            expect(result.map((s) => s.adId)).to.not.include(belowId);
            expect(result.map((s) => s.adId)).to.not.include(aboveId);
        });
    });

    describe("TTL", () => {
        it("an ad past expiresAtMs is not returned by list(), and sweep() removes it returning its adId with reason 'ttl'", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 2000n });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            expect(result.ok).to.equal(true);
            const storedAdId = (result as { adId: string }).adId;

            nowMs.value = 2001;
            expect(store.list()).to.deep.equal([]);
            expect(store.get(storedAdId)).to.not.be.undefined; // sweep hasn't run yet

            const swept = store.sweep();
            expect(swept).to.deep.equal([storedAdId]);
            expect(store.get(storedAdId)).to.be.undefined;
            expect(store.size).to.equal(0);
        });

        it("an advertiser at its peer cap can publish a new ad once its old ones have expired, even before an external sweep()", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs, { maxAdsPerPeer: 1 });
            const advertiser = factory.randomWallet().address;

            const first = baseAd({
                advertiser,
                channelId: bytes32(),
                expiresAtMs: 2000n
            });
            const { encodedAd: encodedFirst } = encodeChannelAd(first);
            const firstResult = store.accept({
                encodedAd: encodedFirst,
                authenticatedPeer: advertiser
            });
            expect(firstResult.ok).to.equal(true);

            nowMs.value = 2001; // first ad now expired, but no sweep() call yet
            const second = baseAd({
                advertiser,
                channelId: bytes32(),
                expiresAtMs: 12_000n
            });
            const { encodedAd: encodedSecond } = encodeChannelAd(second);
            const secondResult = store.accept({
                encodedAd: encodedSecond,
                authenticatedPeer: advertiser
            });

            expect(secondResult.ok).to.equal(true);
        });
    });

    describe("drop-on-disconnect", () => {
        it("dropByPeer removes every ad from that advertiser and only from that advertiser, returning the removed ids", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const target = factory.randomWallet().address;
            const other = factory.randomWallet().address;

            const targetAdIds: string[] = [];
            for (let i = 0; i < 2; i++) {
                const ad = baseAd({
                    advertiser: target,
                    channelId: bytes32(),
                    expiresAtMs: 10_000n
                });
                const { encodedAd } = encodeChannelAd(ad);
                const r = store.accept({
                    encodedAd,
                    authenticatedPeer: target
                });
                targetAdIds.push((r as { adId: string }).adId);
            }
            const otherAd = baseAd({ advertiser: other, expiresAtMs: 10_000n });
            const { encodedAd: encodedOther } = encodeChannelAd(otherAd);
            const otherResult = store.accept({
                encodedAd: encodedOther,
                authenticatedPeer: other
            });
            const otherAdId = (otherResult as { adId: string }).adId;

            const removed = store.dropByPeer(target);

            expect(removed.sort()).to.deep.equal(targetAdIds.sort());
            for (const id of targetAdIds) {
                expect(store.get(id)).to.be.undefined;
            }
            expect(store.get(otherAdId)).to.not.be.undefined;
            expect(store.size).to.equal(1);
        });

        it("dropByPeer with a lowercased address still finds and removes the advertiser's ads (checksum-normalized)", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const target = factory.randomWallet().address;
            const ad = baseAd({ advertiser: target, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: target
            });
            const storedAdId = (result as { adId: string }).adId;

            const removed = store.dropByPeer(target.toLowerCase());

            expect(removed).to.deep.equal([storedAdId]);
            expect(store.get(storedAdId)).to.be.undefined;
        });
    });

    describe("withdraw", () => {
        it("withdraw by the owning advertiser removes the ad", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            const storedAdId = (result as { adId: string }).adId;

            const withdrawResult = store.withdraw({
                adId: storedAdId,
                requester: advertiser
            });

            expect(withdrawResult.ok).to.equal(true);
            expect(store.get(storedAdId)).to.be.undefined;
        });

        it("withdraw by the owning advertiser with a lowercased requester address still succeeds (checksum-normalized)", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            const storedAdId = (result as { adId: string }).adId;

            const withdrawResult = store.withdraw({
                adId: storedAdId,
                requester: advertiser.toLowerCase()
            });

            expect(withdrawResult.ok).to.equal(true);
            expect(store.get(storedAdId)).to.be.undefined;
        });

        it("withdraw of another peer's adId is rejected and removes nothing", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const advertiser = factory.randomWallet().address;
            const impostor = factory.randomWallet().address;
            const ad = baseAd({ advertiser, expiresAtMs: 10_000n });
            const { encodedAd } = encodeChannelAd(ad);
            const result = store.accept({
                encodedAd,
                authenticatedPeer: advertiser
            });
            const storedAdId = (result as { adId: string }).adId;

            const withdrawResult = store.withdraw({
                adId: storedAdId,
                requester: impostor
            });

            expect(withdrawResult.ok).to.equal(false);
            expect(withdrawResult.reason).to.equal("not-owner");
            expect(store.get(storedAdId)).to.not.be.undefined;
        });

        it("withdraw of a non-existent adId returns {ok: false} with no reason", () => {
            const nowMs = { value: 1000 };
            const store = makeStore(nowMs);
            const requester = factory.randomWallet().address;

            const withdrawResult = store.withdraw({
                adId: bytes32(),
                requester
            });

            expect(withdrawResult.ok).to.equal(false);
            expect(withdrawResult.reason).to.be.undefined;
        });
    });
});
