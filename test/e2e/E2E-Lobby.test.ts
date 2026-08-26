import { expect } from "chai";
import { ethers } from "ethers";
import { MathStateMachine } from "@typechain-types";

import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { DiscoveryRpc } from "@test/fixtures/customRpc/DiscoveryRpcManifest";
import path from "node:path";
import type { TestPeer } from "@test/harness/core/types";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    decodeChannelAd,
    type ChannelAdStruct
} from "@/discovery/ChannelAd";
import { PunishmentService } from "@test/fixtures/customRpc/harnessControl/services/punishment/PunishmentService";

/**
 * End-to-end lobby coverage under DEBUG_LOCAL_TRANSPORT (no
 * real DHT), driven entirely through the real public surface
 * (`p2pInstance.discovery`) over real `PeerTestHarness` peers - no mocks
 * (test/AGENTS.md). The lobby rides the SAME shared swarm/handshake stack as
 * the channel plane; under DEBUG_LOCAL_TRANSPORT that means
 * `network.connectToLobbyPeers` (harness control), mirroring
 * `network.connectToChannel`.
 *
 * Every peer in this file uses the `DiscoveryRpc` custom RPC manifest
 * (LobbyService is opt-in, not part of `MainRpcService` - no negotiation
 * service needed here, that is E2E-ChannelAcquire.test.ts's job).
 * The zero-blacklist/zero-ban counter is asserted here via the
 * `punishment` harness-control service, which is a real spy on
 * `P2PManager#disconnectAndBlacklistPeer*` / `HolepunchTransport#_close`,
 * never a monkey-patch.
 */
describe("E2E: Lobby", function () {
    let harness: PeerTestHarness<DiscoveryRpc, MathStateMachine> | undefined;

    const discoveryRpcManifest = {
        module: path.resolve(
            __dirname,
            "../fixtures/customRpc/DiscoveryRpcManifest.ts"
        )
    };

    /** joinLobby() + the harness-control wiring DEBUG_LOCAL_TRANSPORT needs to actually discover other lobby peers (LobbyService's own swarm join is a no-op there). */
    async function joinLobbyAndDiscover(
        peer: TestPeer<DiscoveryRpc, MathStateMachine>
    ): Promise<{ topic: string }> {
        const joined = await peer.p2pInstance.discovery.joinLobby();
        await harness!
            .control(peer)
            .network.connectToLobbyPeers(joined.topic)
            .request();
        return joined;
    }

    // The `_close` spy behind `PunishmentService.banCallCount` is installed
    // once for the whole process (it's a call-through wrap on a shared
    // prototype method, never reinstalled/suppressed) - only the COUNTER
    // resets. Reset it before every test so a ban in one `it()` can never
    // leak into a later zero-counter assertion in this file.
    beforeEach(function () {
        PunishmentService.resetBanCallCount();
    });

    afterEach(async function () {
        await harness?.cleanup();
        harness = undefined;
    });

    /** Sum of every peer's own blacklist counter + the process-wide ban counter. */
    async function totalPunishmentCount(
        h: PeerTestHarness<DiscoveryRpc, MathStateMachine>
    ): Promise<number> {
        const perPeerBlacklist = await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).punishment.getBlacklistCallCount().request()
            )
        );
        const banCount = await h
            .control(h.peers[0])
            .punishment.getBanCallCount()
            .request();
        return perPeerBlacklist.reduce((a, b) => a + b, 0) + banCount;
    }

    function baseAd(
        appNamespace: string,
        overrides: Partial<ChannelAdStruct> = {}
    ): ChannelAdStruct {
        return {
            v: CHANNEL_AD_VERSION,
            kind: AdKind.JOIN,
            channelId: ethers.hexlify(ethers.randomBytes(32)),
            advertiser: ethers.ZeroAddress, // publishAd always overwrites this
            app: appNamespace,
            seq: 0n,
            expiresAtMs: BigInt(Date.now() + 60_000),
            capacity: 2,
            filled: 0,
            amount: 100n,
            data: "0x",
            signature: "0x",
            ...overrides
        };
    }

    it("a lobby-only peer never enters P2PManager.openConnections while A/B run a channel; zero blacklist/ban", async function () {
        const appNamespace = ethers.hexlify(ethers.randomBytes(32));
        harness = new PeerTestHarness<DiscoveryRpc, MathStateMachine>({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });
        await harness.setup(2, {
            autoConnect: false,
            customRpcManifest: discoveryRpcManifest,
            configOverrides: {
                LOBBY_APP_NAMESPACE: appNamespace
            },
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });

        // A/B run a real channel - this is the channel plane the lobby-only
        // peer C must never enter.
        await harness.lifecycle.openChannel();
        await harness.rpc.connectPeers([0, 1]);
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        // C: created directly (never network.connectToChannel, never
        // openChannel participant) - a pure lobby peer.
        const lobbyOnlyIndex = harness.peers.length;
        await harness.createPeer(
            lobbyOnlyIndex,
            harness.signerFor(slotAccountIndex(lobbyOnlyIndex))
        );
        const peerC = harness.peers[lobbyOnlyIndex];

        const peerA = harness.getPeer(0);
        const peerB = harness.getPeer(1);

        await joinLobbyAndDiscover(peerA);
        await joinLobbyAndDiscover(peerB);
        await joinLobbyAndDiscover(peerC);

        // Prove the lobby actually works for C (not just "never connected"
        // by accident) - C publishes, A observes it.
        await peerC.p2pInstance.discovery.publishAd(baseAd(appNamespace));
        await waitFor(async () => {
            const { encodedAds } = await peerA.p2pInstance.discovery.listAds();
            return encodedAds.length > 0;
        }, 5000);

        // C never appears in A's or B's openConnections, and vice
        // versa - the channel plane and the lobby plane never cross.
        expect(
            await harness
                .control(peerA)
                .query.isConnectedTo(peerC.address)
                .request()
        ).to.equal(false);
        expect(
            await harness
                .control(peerB)
                .query.isConnectedTo(peerC.address)
                .request()
        ).to.equal(false);
        expect(
            (
                await harness
                    .control(peerC)
                    .query.getConnectedPeerAddresses()
                    .request()
            ).length
        ).to.equal(0);
        // A/B's own channel-plane connection to EACH OTHER is unaffected.
        expect(
            await harness
                .control(peerA)
                .query.isConnectedTo(peerB.address)
                .request()
        ).to.equal(true);

        expect(await totalPunishmentCount(harness)).to.equal(0);
    });

    it("ad lifecycle (three peers): TTL eviction, drop-on-disconnect, advertiser cannot be spoofed, per-peer cap, oversized-on-receive is structurally unreachable via the public facade", async function () {
        const appNamespace = ethers.hexlify(ethers.randomBytes(32));
        harness = new PeerTestHarness<DiscoveryRpc, MathStateMachine>({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });
        await harness.setup(3, {
            autoConnect: false,
            customRpcManifest: discoveryRpcManifest,
            configOverrides: {
                LOBBY_APP_NAMESPACE: appNamespace,
                LOBBY_MAX_ADS_PER_PEER: 4
            },
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });

        const peerA = harness.getPeer(0);
        const peerB = harness.getPeer(1);
        const peerC = harness.getPeer(2);

        await Promise.all([
            joinLobbyAndDiscover(peerA),
            joinLobbyAndDiscover(peerB),
            joinLobbyAndDiscover(peerC)
        ]);
        await waitFor(async () => {
            const { encodedAds } = await peerA.p2pInstance.discovery.listAds();
            return encodedAds.length === 0; // sanity: nothing published yet
        }, 2000);

        // --- (1) TTL eviction: A publishes a short-lived ad, B/C observe it,
        // then it disappears from B's store on its own after the sweep. ---
        const shortLived = baseAd(appNamespace, {
            expiresAtMs: BigInt(Date.now() + 200)
        });
        await peerA.p2pInstance.discovery.publishAd(shortLived);
        await waitFor(async () => {
            const { encodedAds } = await peerB.p2pInstance.discovery.listAds();
            return encodedAds.length === 1;
        }, 5000);
        await waitFor(async () => {
            const { encodedAds } = await peerB.p2pInstance.discovery.listAds();
            return encodedAds.length === 0;
        }, 5000);

        // --- (2) drop-on-disconnect: C publishes, B observes it, C leaves
        // the lobby (its lobby connection drops), and B's store drops C's
        // ad without waiting for TTL. ---
        const longLived = baseAd(appNamespace, {
            channelId: ethers.hexlify(ethers.randomBytes(32))
        });
        await peerC.p2pInstance.discovery.publishAd(longLived);
        await waitFor(async () => {
            const { encodedAds } = await peerB.p2pInstance.discovery.listAds();
            return encodedAds.length === 1;
        }, 5000);
        await peerC.p2pInstance.discovery.leaveLobby();
        await waitFor(async () => {
            const { encodedAds } = await peerB.p2pInstance.discovery.listAds();
            return encodedAds.length === 0;
        }, 5000);

        // --- (3) advertiser cannot be spoofed: B publishes an ad claiming
        // to be A (the `advertiser` field of the INPUT struct) - publishAd
        // always overwrites it with B's own authenticated address, so A
        // never sees itself framed as the advertiser of B's ad. ---
        const spoofAttempt = baseAd(appNamespace, {
            channelId: ethers.hexlify(ethers.randomBytes(32)),
            advertiser: peerA.address
        });
        const { adId: spoofAdId } =
            await peerB.p2pInstance.discovery.publishAd(spoofAttempt);
        await waitFor(async () => {
            const { encodedAds } = await peerA.p2pInstance.discovery.listAds();
            return encodedAds.length === 1;
        }, 5000);
        const { encodedAds: afterSpoof } =
            await peerA.p2pInstance.discovery.listAds();
        const decoded = decodeChannelAd(afterSpoof[0]);
        expect(decoded.advertiser.toLowerCase()).to.equal(
            peerB.address.toLowerCase()
        );
        expect(decoded.advertiser.toLowerCase()).to.not.equal(
            peerA.address.toLowerCase()
        );
        await peerB.p2pInstance.discovery.withdrawAd(spoofAdId);

        // --- (4) per-peer cap: LOBBY_MAX_ADS_PER_PEER=4 for this harness -
        // a 5th ad from the SAME peer is rejected, never silently evicting
        // an older one of its own. ---
        for (let i = 0; i < 4; i++) {
            await peerA.p2pInstance.discovery.publishAd(
                baseAd(appNamespace, {
                    channelId: ethers.hexlify(ethers.randomBytes(32))
                })
            );
        }
        let capError: unknown;
        try {
            await peerA.p2pInstance.discovery.publishAd(
                baseAd(appNamespace, {
                    channelId: ethers.hexlify(ethers.randomBytes(32))
                })
            );
        } catch (e) {
            capError = e;
        }
        expect(capError).to.be.instanceOf(Error);
        expect((capError as Error).message).to.match(/peer-cap/);

        // --- (5) oversized `data` rejected on receive: NOT independently
        // reachable through the public facade by design - `publishAd`
        // enforces the same LOBBY_AD_MAX_DATA_BYTES cap on the SEND side
        // (the encode guard) before an ad is ever produced, so a caller can
        // never construct an oversized ad through this surface to prove the
        // receive-side guard fires on ITS OWN. That receive-side guard
        // (validateReceivedAd / LobbyAdStore.accept) is exercised directly
        // with a hand-crafted encoded ad in test/discovery/LobbyAdStore.test.ts
        // - this is the send-side half of the same defense-in-depth pair,
        // asserted here for symmetry.
        let sizeError: unknown;
        try {
            await peerA.p2pInstance.discovery.publishAd(
                baseAd(appNamespace, {
                    channelId: ethers.hexlify(ethers.randomBytes(32)),
                    data: ethers.hexlify(ethers.randomBytes(513))
                })
            );
        } catch (e) {
            sizeError = e;
        }
        expect(sizeError).to.be.instanceOf(Error);

        expect(await totalPunishmentCount(harness)).to.equal(0);
    });
});
