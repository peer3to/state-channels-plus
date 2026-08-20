import { expect } from "chai";
import { ethers } from "ethers";
import path from "node:path";
import { MathStateMachine } from "@typechain-types";

import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { DiscoveryRpc } from "@test/fixtures/customRpc/DiscoveryRpcManifest";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type, SignatureUtils } from "@/utils";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import { compareAddresses } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    type ChannelAdStruct
} from "@/discovery/ChannelAd";
import { decodeMathState } from "@test/utils/mathHarnessAbi";
import { PunishmentService } from "@test/fixtures/customRpc/harnessControl/services/punishment/PunishmentService";

/**
 * End-to-end coverage of both `acquireChannel` commit
 * modes (JOIN and OPEN) under DEBUG_LOCAL_TRANSPORT, driven entirely through
 * the real public surface (`p2pInstance.discovery`) over real
 * `PeerTestHarness` peers - no mocks (test/AGENTS.md). The lobby itself
 * rides the SAME shared swarm/handshake stack as the channel plane; under
 * DEBUG_LOCAL_TRANSPORT that means `network.connectToLobbyPeers` (harness
 * control), mirroring `network.connectToChannel`. Every peer uses the
 * `DiscoveryRpc` custom RPC manifest
 * (test/fixtures/customRpc/DiscoveryRpcManifest.ts), which wires
 * `OpenChannelNegotiationService` (opt-in, F9) and `LobbyService` (opt-in)
 * so both the OPEN commit path and the lobby itself (neither in
 * `MainRpcService`) are actually reachable.
 */
describe("E2E: ChannelAcquire", function () {
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
    ): Promise<void> {
        const { topic } = await peer.p2pInstance.discovery.joinLobby();
        await harness!
            .control(peer)
            .network.connectToLobbyPeers(topic)
            .request();
    }

    // The `_close` spy behind `PunishmentService.banCallCount` is installed
    // once for the whole process (it's a call-through wrap on a shared
    // prototype method, never reinstalled/suppressed) - only the COUNTER
    // resets. Reset it before every test (this file's mismatch-validator
    // test deliberately triggers a REAL blacklist) so it can never leak into
    // a later zero-counter assertion in this file.
    beforeEach(function () {
        PunishmentService.resetBanCallCount();
    });

    afterEach(async function () {
        await harness?.cleanup();
        harness = undefined;
    });

    /** Typed handle to `DiscoveryRpc`'s own services (openChannelNegotiationService/negotiationTest), which `harness.control()` doesn't statically know about (it's typed to the base `HarnessControlRpc`). */
    function ctl(
        peer: TestPeer<DiscoveryRpc, MathStateMachine>
    ): RemoteRpcProxyType<DiscoveryRpc> {
        return harness!.control(
            peer
        ) as unknown as RemoteRpcProxyType<DiscoveryRpc>;
    }

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

    /**
     * This peer's own view of `address`'s genesis MathState balance (the
     * per-participant balance MathConsumerFacet.openChannelGenesis seeds
     * from each JoinChannel/OpenChannel's `balance.amount` - the durable
     * on-chain-derived signal for "the amount actually opened with").
     * `getTotalDeposits` (StateChannelCommon's aggregated deposit ledger)
     * is NOT this value: it only accrues from posted state-transition
     * messages, never from the genesis balances themselves.
     */
    async function genesisBalanceOf(
        peer: TestPeer<DiscoveryRpc, MathStateMachine>,
        forkId: ForkId,
        address: string
    ): Promise<bigint> {
        let genesisSnapshotHash: string | null = null;
        await waitFor(async () => {
            const hash = await ctl(peer)
                .query.getGenesisSnapshotHash(forkId)
                .request();
            genesisSnapshotHash = hash === null ? null : String(hash);
            return genesisSnapshotHash !== null;
        }, 5000);
        expect(genesisSnapshotHash, "no genesis snapshot yet").to.not.equal(
            null
        );
        const snapshotResult = await ctl(peer)
            .query.getStateSnapshotStructByHash(genesisSnapshotHash!)
            .request();
        expect(
            snapshotResult,
            "genesis snapshot struct not found"
        ).to.not.equal(null);
        const snapshot = Codec.decode(
            snapshotResult!.encodedSnapshot,
            Type.StateSnapshot
        );
        const encoded = await ctl(peer)
            .query.getStateMachineState(
                String(snapshot.snapshotData.stateMachineStateHash) as never
            )
            .request();
        expect(encoded, "no encoded state-machine state yet").to.not.equal(
            null
        );
        const decoded = decodeMathState(encoded as string);
        const idx = decoded.participants.findIndex(
            (p) => p.toLowerCase() === address.toLowerCase()
        );
        expect(
            idx,
            `participant ${address} not found in MathState`
        ).to.be.at.least(0);
        return decoded.balances[idx];
    }

    /** Assertion-message context carrying the coordinator's own per-stage attempts, so a failure explains itself without a separate debug pass. */
    function attemptsContext(result: { attempts?: unknown }): string {
        return `attempts: ${JSON.stringify(result.attempts)}`;
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
            amount: 500n,
            data: "0x",
            signature: "0x",
            ...overrides
        };
    }

    it("Mode B JOIN: one JOIN ad -> acquireChannel -> the acquirer reaches PARTICIPATING; zero blacklist/ban", async function () {
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
        await harness.lifecycle.openChannel();
        await harness.rpc.connectPeers([0, 1]);
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        const advertiser = harness.getPeer(0);

        // Advertiser publishes a JOIN ad for the already-open channel.
        await joinLobbyAndDiscover(advertiser);
        // `advertiser` must be the REAL publisher address up front: publishAd
        // overwrites its own STORED copy with the authenticated identity,
        // but the candidate array passed to acquireChannel below is this
        // same local object - requestIntent targets `candidate.ad.advertiser`
        // directly, so a placeholder address here would target nobody.
        const joinAd = baseAd(appNamespace, {
            kind: AdKind.JOIN,
            channelId: harness.channelId.toString(),
            amount: 500n,
            advertiser: advertiser.address
        });
        await advertiser.p2pInstance.discovery.publishAd(joinAd);

        // Acquirer: a fresh peer, pre-connected to the channel's discovery
        // mesh (LocalDiscoveryServer pairing under DEBUG_LOCAL_TRANSPORT -
        // tryOpenConnectionToChannel is a no-op there, so the coordinator's
        // own connect stage alone would never pair the transports; the
        // harness's network.connectToChannel is what actually announces/
        // discovers peers on this channelId, the same step JoinActions.
        // addSpectator performs before a manual join).
        const acquirerIndex = harness.peers.length;
        await harness.createPeer(
            acquirerIndex,
            harness.signerFor(slotAccountIndex(acquirerIndex))
        );
        const acquirer = harness.peers[acquirerIndex];
        await harness
            .control(acquirer)
            .network.connectToChannel(harness.channelId.toString())
            .request();

        await joinLobbyAndDiscover(acquirer);
        // Wait for mutual lobby auth with the advertiser (observable via the
        // ad actually arriving) before acquiring - requestIntent targets an
        // authenticated lobby peer, which auth is still asynchronous after
        // joinLobby() resolves.
        await waitFor(async () => {
            const { encodedAds } =
                await acquirer.p2pInstance.discovery.listAds();
            return encodedAds.length > 0;
        }, 5000);
        const result = await acquirer.p2pInstance.discovery.acquireChannel({
            candidates: [joinAd],
            amount: "500"
        });

        expect(result.status, attemptsContext(result)).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(harness.channelId.toString());
        }
        expect(
            await harness.control(acquirer).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);

        expect(await totalPunishmentCount(harness)).to.equal(0);
    });

    it("Mode B OPEN: intent -> adopt -> negotiate -> BOTH peers PARTICIPATING with on-chain deposits matching setStakeAmount(x) (not DEFAULT_JOIN_AMOUNT=500); zero blacklist/ban", async function () {
        const appNamespace = ethers.hexlify(ethers.randomBytes(32));
        const STAKE = 777;
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

        const host = harness.getPeer(0);
        const acquirer = harness.getPeer(1);

        // An OPEN ad does NOT bind a channelId at publish time
        // on the wire, but the advertiser still needs a candidate channelId
        // to advertise and, separately, its OWN channel-plane connection
        // ready for the eventual negotiateRequest (a real RPC call that
        // needs an established transport) - both peers register on the same
        // (not-yet-open) channelId's discovery mesh up front.
        const proposedChannelId = ethers.hexlify(ethers.randomBytes(32));
        await harness
            .control(host)
            .network.connectToChannel(proposedChannelId)
            .request();
        await harness
            .control(acquirer)
            .network.connectToChannel(proposedChannelId)
            .request();
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        // Host's OWN stake is set by production code (LobbyService's own
        // applyOwnOpenAdStake) the moment it accepts the acquirer's intent
        // on this OPEN ad - this is the value that must show up on-chain,
        // not DEFAULT_JOIN_AMOUNT=500.
        await joinLobbyAndDiscover(host);
        const openAd = baseAd(appNamespace, {
            kind: AdKind.OPEN,
            channelId: proposedChannelId,
            amount: BigInt(STAKE),
            advertiser: host.address
        });
        await host.p2pInstance.discovery.publishAd(openAd);

        await joinLobbyAndDiscover(acquirer);
        await waitFor(async () => {
            const { encodedAds } =
                await acquirer.p2pInstance.discovery.listAds();
            return encodedAds.length > 0;
        }, 5000);

        const result = await acquirer.p2pInstance.discovery.acquireChannel({
            candidates: [openAd],
            amount: String(STAKE)
        });
        expect(result.status, attemptsContext(result)).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(proposedChannelId);
        }

        // BOTH sides reach PARTICIPATING - the acquirer's own commit path
        // already waits for it; the host transitions on its own once the
        // `open` tx is observed on-chain.
        expect(
            await harness.control(acquirer).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
        await waitFor(async () => {
            const status = await harness!
                .control(host)
                .query.getStatus()
                .request();
            return status === Status.PARTICIPATING;
        }, 10_000);

        // On-chain balance == setStakeAmount(x) on BOTH sides (not
        // DEFAULT_JOIN_AMOUNT=500) - read from the genesis MathState each
        // peer independently derived from the SAME on-chain ChannelOpened
        // event, one query per side.
        const forkId = await ctl(acquirer).query.getForkId().request();
        const acquirerBalance = await genesisBalanceOf(
            acquirer,
            forkId,
            acquirer.address
        );
        const hostBalance = await genesisBalanceOf(host, forkId, host.address);
        expect(acquirerBalance).to.equal(BigInt(STAKE));
        expect(hostBalance).to.equal(BigInt(STAKE));

        expect(await totalPunishmentCount(harness)).to.equal(0);
    });

    it("non-punitive decline: a declined negotiateRequest is followed by a SUCCESSFUL renegotiation between the SAME two peers; zero blacklist/ban", async function () {
        const appNamespace = ethers.hexlify(ethers.randomBytes(32));
        const STAKE = 321;
        harness = new PeerTestHarness<DiscoveryRpc, MathStateMachine>({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });
        await harness.setup(2, {
            autoConnect: false,
            customRpcManifest: discoveryRpcManifest,
            configOverrides: {
                LOBBY_APP_NAMESPACE: appNamespace,
                // Short confirm/negotiate budget: the first attempt's decline
                // is only observable to the coordinator as "no PARTICIPATING
                // within budget" (beginNegotiation itself is fire-and-forget)
                // - keep the test fast without touching this.timeout().
                LOBBY_COMMIT_CONFIRM_TIMEOUT_MS: 3000
            },
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });

        const host = harness.getPeer(0);
        const acquirer = harness.getPeer(1);
        const proposedChannelId = ethers.hexlify(ethers.randomBytes(32));
        await harness
            .control(host)
            .network.connectToChannel(proposedChannelId)
            .request();
        await harness
            .control(acquirer)
            .network.connectToChannel(proposedChannelId)
            .request();
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        // D1 (negotiate-layer) policy denies every negotiate request up
        // front - distinct from the lobby intent admission check, which still accepts.
        await ctl(host)
            .negotiationTest.setNegotiationAdmissionPolicy({ mode: "denyAll" })
            .request();
        await joinLobbyAndDiscover(host);
        const openAd = baseAd(appNamespace, {
            kind: AdKind.OPEN,
            channelId: proposedChannelId,
            amount: BigInt(STAKE),
            advertiser: host.address
        });
        await host.p2pInstance.discovery.publishAd(openAd);

        await joinLobbyAndDiscover(acquirer);
        await waitFor(async () => {
            const { encodedAds } =
                await acquirer.p2pInstance.discovery.listAds();
            return encodedAds.length > 0;
        }, 5000);

        const declined = await acquirer.p2pInstance.discovery.acquireChannel({
            candidates: [openAd],
            amount: String(STAKE)
        });
        expect(declined.status, attemptsContext(declined)).to.not.equal(
            "acquired"
        );

        // Non-punitive: the connection between the SAME two peers still
        // works and nobody was blacklisted/banned. `openConnections` isn't a
        // signal for this any more: neither peer is a dispute participant of
        // `proposedChannelId` (it never opened on-chain in this branch), so
        // `P2PManager` never promotes either one - that's the channel-
        // broadcast gate, not "is this transport still usable". Assert the
        // real thing the comment wants: a targeted RPC round-trip over the
        // same transport still succeeds.
        let roundTripSucceeded = true;
        try {
            await harness
                .control(host)
                .query.getStatus()
                .request(acquirer.address);
        } catch {
            roundTripSucceeded = false;
        }
        expect(
            roundTripSucceeded,
            "a targeted RPC round-trip between the same two peers must still work"
        ).to.equal(true);
        expect(await totalPunishmentCount(harness)).to.equal(0);

        // Renegotiation between the SAME two peers, now allowed.
        await ctl(host)
            .negotiationTest.setNegotiationAdmissionPolicy({ mode: "allowAll" })
            .request();
        const accepted = await acquirer.p2pInstance.discovery.acquireChannel({
            candidates: [openAd],
            amount: String(STAKE)
        });
        expect(accepted.status, attemptsContext(accepted)).to.equal("acquired");
        if (accepted.status === "acquired") {
            expect(accepted.channelId).to.equal(proposedChannelId);
        }

        expect(await totalPunishmentCount(harness)).to.equal(0);
    });

    it("stale/lying ad fails at commit with a typed reason and moves no funds; a fresh candidate on the SAME acquirer instance then succeeds (resetForNewChannel re-arms)", async function () {
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
        // A real already-open channel, so its channelId is genuinely stale
        // for an OPEN ad (the mandatory isChannelOpen precheck).
        await harness.lifecycle.openChannel();
        await harness.rpc.connectPeers([0, 1]);
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        const host = harness.getPeer(0);
        const acquirer = harness.getPeer(1);
        const staleChannelId = harness.channelId.toString();

        await joinLobbyAndDiscover(host);
        const staleAd = baseAd(appNamespace, {
            kind: AdKind.OPEN,
            channelId: staleChannelId,
            amount: 900n,
            advertiser: host.address
        });
        await host.p2pInstance.discovery.publishAd(staleAd);

        await joinLobbyAndDiscover(acquirer);
        await waitFor(async () => {
            const { encodedAds } =
                await acquirer.p2pInstance.discovery.listAds();
            return encodedAds.length > 0;
        }, 5000);

        const staleResult = await acquirer.p2pInstance.discovery.acquireChannel(
            {
                candidates: [staleAd],
                amount: "900"
            }
        );
        // Fails with a typed reason, never "acquired".
        expect(staleResult.status, attemptsContext(staleResult)).to.equal(
            "exhausted"
        );
        expect(staleResult.attempts.length).to.be.greaterThan(0);
        expect(
            staleResult.attempts.some(
                (a) => a.reason === "channel-already-open"
            )
        ).to.equal(true);
        // No funds moved: the pre-existing channel's own genesis balance is
        // untouched by the rejected attempt.
        const forkId = await ctl(acquirer).query.getForkId().request();
        const acquirerBalanceAfterStale = await genesisBalanceOf(
            acquirer,
            forkId,
            acquirer.address
        );
        expect(acquirerBalanceAfterStale).to.equal(500n); // harness default initialBalance
        expect(await totalPunishmentCount(harness)).to.equal(0);

        // The SAME acquirer instance retries against a genuinely
        // fresh candidate and succeeds - resetForNewChannel cleared the
        // latch left by the failed attempt. Withdraw the stale ad first
        // (LOBBY_MAX_OPEN_ADS_PER_PEER=1 - the host can only
        // ever advertise ONE open ad at a time).
        await host.p2pInstance.discovery.withdrawAd(
            staleResult.attempts[0].adId
        );
        const freshChannelId = ethers.hexlify(ethers.randomBytes(32));
        await harness
            .control(host)
            .network.connectToChannel(freshChannelId)
            .request();
        await harness
            .control(acquirer)
            .network.connectToChannel(freshChannelId)
            .request();

        const STAKE = 654;
        const freshAd = baseAd(appNamespace, {
            kind: AdKind.OPEN,
            channelId: freshChannelId,
            amount: BigInt(STAKE),
            advertiser: host.address
        });
        await host.p2pInstance.discovery.publishAd(freshAd);
        await waitFor(async () => {
            const { encodedAds } =
                await acquirer.p2pInstance.discovery.listAds();
            return encodedAds.length > 0; // the stale ad was withdrawn above
        }, 5000);

        const freshResult = await acquirer.p2pInstance.discovery.acquireChannel(
            {
                candidates: [freshAd],
                amount: String(STAKE)
            }
        );
        expect(freshResult.status, attemptsContext(freshResult)).to.equal(
            "acquired"
        );
        if (freshResult.status === "acquired") {
            expect(freshResult.channelId).to.equal(freshChannelId);
        }

        expect(await totalPunishmentCount(harness)).to.equal(0);
    });

    it("mismatch-validator path: a deliberately mismatched openProposal is rejected (never co-signed) and the sender is blacklisted for fraud", async function () {
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

        const [peer0, peer1] = harness.peers;
        // The RECEIVER of the crafted proposal must compute itself as the
        // HIGHER address (openProposal blacklists the sender if the
        // receiver is the lower one - :259-263) - pick sender/receiver by
        // actual address ordering rather than assuming peer index order.
        const [lower, higher] =
            compareAddresses(peer0.address, peer1.address) <= 0
                ? [peer0, peer1]
                : [peer1, peer0];

        const channelId = ethers.hexlify(ethers.randomBytes(32));
        await harness
            .control(lower)
            .network.connectToChannel(channelId)
            .request();
        await harness
            .control(higher)
            .network.connectToChannel(channelId)
            .request();
        await harness.event.waitUntilEventOccurs(
            "onConnection",
            5000,
            harness.peers.map((p) => p.index)
        );

        const agreedAmount = 700;
        // Deterministically arm the RECEIVER's negotiation state (see
        // NegotiationTestService's doc comment for why this can't be driven
        // through the real wire flow without racing the lower peer's own
        // correct auto-proposal).
        await ctl(higher)
            .negotiationTest.armNegotiationState(lower.address, agreedAmount)
            .request();

        const participants: [string, string] = [lower.address, higher.address];
        const wrongOpenChannel: OpenChannelStruct = {
            channelId,
            participants,
            // Deliberately mismatched: the negotiated amount was 700/700,
            // this proposes 1/700 - the receiver must reconstruct the
            // expected balances itself and refuse to co-sign anything else.
            balances: [
                { amount: 1n, data: "0x" },
                { amount: BigInt(agreedAmount), data: "0x" }
            ],
            deadlineTimestamp: BigInt(Math.floor(Date.now() / 1000) + 60),
            isAtomic: true,
            data: "0x"
        };
        const encodedOpenChannel = Codec.encode(
            wrongOpenChannel,
            Type.OpenChannel
        ) as string;
        const { signature } = await SignatureUtils.signOpenChannel(
            wrongOpenChannel,
            lower.signer
        );

        await ctl(lower)
            .openChannelNegotiationService.openProposal(
                encodedOpenChannel,
                signature.toString()
            )
            .sendOne(higher.address);

        // The higher peer's real validator must reject this: no channel
        // ever opens with the wrong terms, and it must NEVER reach
        // PARTICIPATING off the back of a forged proposal.
        await waitFor(async () => {
            const count = await harness!
                .control(higher)
                .punishment.getBlacklistCallCount()
                .request();
            return count > 0;
        }, 5000);
        expect(
            await harness.control(higher).query.getStatus().request()
        ).to.not.equal(Status.PARTICIPATING);
        expect(
            await harness
                .control(higher)
                .query.isBlacklisted(lower.address)
                .request()
        ).to.equal(true);
    });
});
