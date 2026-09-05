import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { TransportType } from "@/transport/TransportType";
import { compareAddresses } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import { sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

describe("E2E: lobby matching", function () {
    it("matches two authenticated peers, derives one ID, and opens one channel", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-matching-topic");
        const before = await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).query.getChannelId().request()
            )
        );
        expect(before).to.deep.equal([ethers.ZeroHash, ethers.ZeroHash]);
        const transactionCountsBefore = await Promise.all(
            h.peers.map((peer) => h.provider.getTransactionCount(peer.address))
        );

        // Both attempts are read while the terms exchange is parked.
        let attempts: Array<{
            peerAddress: string;
            channelId: string;
            attemptNonce: string;
            localOpeningSignatureIssued: boolean;
        }> = [];
        await h.rpcStub.withHeldNegotiationReplies(
            [0, 1],
            "exchangeTerms",
            async () => {
                await h.rpc.joinLobby([0, 1], topic);
                await waitFor(
                    async () => {
                        const values = await Promise.all(
                            h.peers.map((peer) =>
                                h
                                    .control(peer)
                                    .query.getNegotiationAttempt()
                                    .request()
                            )
                        );
                        if (values.every(Boolean)) {
                            attempts = values.filter(
                                (value): value is NonNullable<typeof value> =>
                                    !!value
                            );
                            return true;
                        }
                        return false;
                    },
                    h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    }),
                    200
                );
            }
        );

        let channelIds: string[] = [];
        await waitFor(
            async () => {
                channelIds = await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getChannelId().request()
                    )
                );
                return (
                    channelIds[0] !== ethers.ZeroHash &&
                    channelIds[0] === channelIds[1]
                );
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            200
        );
        expect(channelIds[0]).to.equal(channelIds[1]);
        expect(channelIds[0]).not.to.equal(ethers.ZeroHash);

        await waitFor(
            () =>
                h
                    .control(h.peers[0])
                    .query.isChannelOpen(channelIds[0])
                    .request(),
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            50
        );
        const registry = await h
            .control(h.peers[0])
            .query.getOpenChannelIds()
            .request();
        expect(registry).to.include(channelIds[0]);
        expect(new Set(registry).size).to.equal(registry.length);
        expect(attempts).to.have.length(2);
        const lowerIndex =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? 0
                : 1;
        let transactionCountsAfter: number[] = [];
        const higherIndex = 1 - lowerIndex;
        await waitFor(
            async () => {
                transactionCountsAfter = await Promise.all(
                    h.peers.map((peer) =>
                        h.provider.getTransactionCount(peer.address)
                    )
                );
                return (
                    transactionCountsAfter[higherIndex] ===
                    transactionCountsBefore[higherIndex] + 1
                );
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            200
        );
        expect(transactionCountsAfter[higherIndex]).to.equal(
            transactionCountsBefore[higherIndex] + 1
        );
        expect(transactionCountsAfter[lowerIndex]).to.equal(
            transactionCountsBefore[lowerIndex]
        );

        await waitFor(
            async () => {
                const statuses = await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getStatus().request()
                    )
                );
                return statuses.every(
                    (status) => status === Status.PARTICIPATING
                );
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            200
        );
        await waitFor(
            async () => {
                const availability = await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getLobbyAvailability().request()
                    )
                );
                return availability.every(({ topic }) => topic === undefined);
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            200
        );

        await h.transition.advanceState({ count: 1 });
        await h.assert.sync.blockHeight({ expectedHeight: 0 });
    });

    it("keeps two caller-supplied lobby topics isolated", async function () {
        const h = TestSession.getHarness();
        await h.setup(4, { autoConnect: false });
        const firstTopic = ethers.id("e2e-lobby-isolation-first");
        const secondTopic = ethers.id("e2e-lobby-isolation-second");

        // The pairings are read while the terms exchanges are parked.
        let firstPeer: { peerAddress: string } | null = null;
        let thirdPeer: { peerAddress: string } | null = null;
        await h.rpcStub.withHeldNegotiationReplies(
            h.peers.map((peer) => peer.index),
            "exchangeTerms",
            async () => {
                await Promise.all([
                    h.rpc.joinLobby([0, 1], firstTopic),
                    h.rpc.joinLobby([2, 3], secondTopic)
                ]);
                await waitFor(
                    async () => {
                        firstPeer = await h
                            .control(h.peers[0])
                            .query.getNegotiationAttempt()
                            .request();
                        thirdPeer = await h
                            .control(h.peers[2])
                            .query.getNegotiationAttempt()
                            .request();
                        return firstPeer !== null && thirdPeer !== null;
                    },
                    h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    }),
                    200
                );
            }
        );
        expect(firstPeer!.peerAddress.toLowerCase()).to.equal(
            h.peers[1].address.toLowerCase()
        );
        expect(thirdPeer!.peerAddress.toLowerCase()).to.equal(
            h.peers[3].address.toLowerCase()
        );

        let ids: string[] = [];
        await waitFor(
            async () => {
                ids = await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getChannelId().request()
                    )
                );
                return ids.every((id) => id !== ethers.ZeroHash);
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            200
        );

        expect(ids[0]).to.equal(ids[1]);
        expect(ids[2]).to.equal(ids[3]);
        expect(ids[0]).not.to.equal(ids[2]);
    });

    it("converges four peers on one topic into two exclusive pairs", async function () {
        const h = TestSession.getHarness();
        await h.setup(4, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-four-peer-convergence");

        await h.rpc.joinLobby([0, 1, 2, 3], topic);

        let ids: string[] = [];
        await waitFor(
            async () => {
                ids = await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getChannelId().request()
                    )
                );
                return ids.every((id) => id !== ethers.ZeroHash);
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
            200
        );

        const uniqueIds = [...new Set(ids)];
        expect(uniqueIds).to.have.length(2);
        for (const id of uniqueIds) {
            expect(ids.filter((candidate) => candidate === id)).to.have.length(
                2
            );
        }

        await Promise.all(
            uniqueIds.map((id) =>
                waitFor(
                    () =>
                        h.control(h.peers[0]).query.isChannelOpen(id).request(),
                    h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    }),
                    50
                )
            )
        );
        const registry = await h
            .control(h.peers[0])
            .query.getOpenChannelIds()
            .request();
        expect(uniqueIds.every((id) => registry.includes(id))).to.equal(true);
        for (let observer = 0; observer < h.peers.length; observer += 1) {
            for (let target = 0; target < h.peers.length; target += 1) {
                if (observer === target) continue;
                expect(
                    await h
                        .control(h.peers[observer])
                        .query.isBlacklisted(h.peers[target].address)
                        .request(),
                    `peer ${observer} must not blacklist honest peer ${target}`
                ).to.equal(false);
            }
        }
    });

    it("blacklists a silent picker response and retries another peer on the same topic", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-silent-pick-recovery");
        const [lowerIndex, higherIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releaseReply = await h.rpcStub.holdLobbyReply(lowerIndex, "pick");
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([lowerIndex, higherIndex], topic);
            await waitFor(
                () =>
                    h
                        .control(h.peers[higherIndex])
                        .query.isBlacklisted(h.peers[lowerIndex].address)
                        .request(),
                h.event.protocolEventTimeoutMs(),
                200
            );

            await h.rpc.joinLobby([2], topic);
            const recoveredChannelId =
                await h.rpc.recoveredPairingChannelIdWait(higherIndex, 2);
            expect(recoveredChannelId).not.to.equal(ethers.ZeroHash);
            await waitFor(
                () =>
                    h
                        .control(h.peers[2])
                        .query.isChannelOpen(recoveredChannelId)
                        .request(),
                h.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                }),
                50
            );
        } finally {
            await releaseReply();
            await h.rpc.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("treats final profile loss during selection as neutral and retries immediately", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-final-profile-loss");
        const [lowerIndex, higherIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releaseReply = await h.rpcStub.holdLobbyReply(lowerIndex, "pick");
        let replyReleased = false;
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([lowerIndex, higherIndex], topic);
            await waitFor(
                async () =>
                    (
                        await h
                            .control(h.peers[higherIndex])
                            .query.getLobbyAvailability()
                            .request()
                    ).inFlight,
                h.event.protocolEventTimeoutMs(),
                200
            );
            await h.network.blacklistAndDisconnectPeer(lowerIndex);
            await waitFor(
                async () =>
                    !(
                        await h
                            .control(h.peers[higherIndex])
                            .query.getLobbyAvailability()
                            .request()
                    ).inFlight,
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(
                // Re-enable higher→lower before releasing the held reply so
                // late cleanup is tested without the harness isolation ban.
                await h
                    .control(h.peers[higherIndex])
                    .network.unblacklistPeerByAddress(
                        h.peers[lowerIndex].address
                    )
                    .request()
            ).to.equal(true);
            expect(
                await h
                    .control(h.peers[higherIndex])
                    .query.isBlacklisted(h.peers[lowerIndex].address)
                    .request()
            ).to.equal(false);
            await releaseReply();
            replyReleased = true;
            await h.rpc.leaveLobby([lowerIndex], topic);

            await h.rpc.joinLobby([2], topic);
            const recoveredChannelId =
                await h.rpc.recoveredPairingChannelIdWait(higherIndex, 2);
            expect(recoveredChannelId).not.to.equal(ethers.ZeroHash);
            await waitFor(
                () =>
                    h
                        .control(h.peers[2])
                        .query.isChannelOpen(recoveredChannelId)
                        .request(),
                h.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                }),
                50
            );
        } finally {
            if (!replyReleased) await releaseReply();
            await h.rpc.leaveLobby([higherIndex, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("punishes commitment silence symmetrically and ignores the late attempt", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-silent-commit-recovery");
        const [advertiserIndex, selectorIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releaseReply = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "commit"
        );
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([advertiserIndex, selectorIndex], topic);
            await waitFor(
                async () =>
                    (await h
                        .control(h.peers[advertiserIndex])
                        .query.isBlacklisted(h.peers[selectorIndex].address)
                        .request()) &&
                    (await h
                        .control(h.peers[selectorIndex])
                        .query.isBlacklisted(h.peers[advertiserIndex].address)
                        .request()),
                h.event.protocolEventTimeoutMs(),
                200
            );
            await releaseReply();
            expect(
                await h
                    .control(h.peers[selectorIndex])
                    .query.getNegotiationAttempt()
                    .request()
            ).to.equal(null);

            await waitFor(
                async () =>
                    (
                        await h
                            .control(h.peers[advertiserIndex])
                            .query.getLobbyAvailability()
                            .request()
                    ).matching &&
                    (
                        await h
                            .control(h.peers[selectorIndex])
                            .query.getLobbyAvailability()
                            .request()
                    ).matching,
                h.event.protocolEventTimeoutMs(),
                200
            );
        } finally {
            await releaseReply();
            await h.rpc.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("blacklists both sides when the advertiser bound fires before the selector bound", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-advertiser-bound-first");
        const [advertiserIndex, selectorIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releaseReply = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "commit"
        );
        // The selector's own commit timeout never fires: its blacklist can only
        // come from the commit rejecting when the advertiser closes the
        // transport at its reservation bound.
        const selectorTimeout = await h.rpcStub.holdScheduledTasks(
            selectorIndex,
            "rpcRequest:lobbyMatchingService.commit"
        );
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([advertiserIndex, selectorIndex], topic);
            await waitFor(
                async () =>
                    await h
                        .control(h.peers[advertiserIndex])
                        .query.isBlacklisted(h.peers[selectorIndex].address)
                        .request(),
                h.event.protocolEventTimeoutMs(),
                200
            );
            await waitFor(
                async () =>
                    await h
                        .control(h.peers[selectorIndex])
                        .query.isBlacklisted(h.peers[advertiserIndex].address)
                        .request(),
                h.event.protocolEventTimeoutMs(),
                50
            );
            expect(await selectorTimeout.heldCount()).to.equal(1);
            await releaseReply();
            expect(
                await h
                    .control(h.peers[selectorIndex])
                    .query.getNegotiationAttempt()
                    .request()
            ).to.equal(null);
        } finally {
            await selectorTimeout.release(false);
            await h.rpc.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("blacklists both sides when the selector bound fires before the advertiser bound", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-selector-bound-first");
        const [advertiserIndex, selectorIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releaseReply = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "commit"
        );
        // The advertiser's reservation bound is held, so the selector's commit
        // timeout fires first and closes the transport. The reservation must
        // survive that loss and blacklist when its bound is released.
        const advertiserExpiry = await h.rpcStub.holdScheduledTasks(
            advertiserIndex,
            "lobby advertiser reservation expiry"
        );
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([advertiserIndex, selectorIndex], topic);
            await waitFor(
                async () =>
                    await h
                        .control(h.peers[selectorIndex])
                        .query.isBlacklisted(h.peers[advertiserIndex].address)
                        .request(),
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(await advertiserExpiry.heldCount()).to.equal(1);
            expect(
                await h
                    .control(h.peers[advertiserIndex])
                    .query.isBlacklisted(h.peers[selectorIndex].address)
                    .request()
            ).to.equal(false);
            await advertiserExpiry.release(true);
            await waitFor(
                async () =>
                    await h
                        .control(h.peers[advertiserIndex])
                        .query.isBlacklisted(h.peers[selectorIndex].address)
                        .request(),
                h.event.protocolEventTimeoutMs(),
                50
            );
            await releaseReply();
            expect(
                await h
                    .control(h.peers[selectorIndex])
                    .query.getNegotiationAttempt()
                    .request()
            ).to.equal(null);
        } finally {
            await advertiserExpiry.release(false);
            await h.rpc.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("keeps a pending selection intact through a successful transport upgrade", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-transport-upgrade");
        const [advertiserIndex, selectorIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releasePick = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "pick"
        );
        const restoreDurations = await Promise.all(
            [0, 1].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([advertiserIndex, selectorIndex], topic);
            await waitFor(
                async () =>
                    (
                        await h
                            .control(h.peers[selectorIndex])
                            .query.getLobbyAvailability()
                            .request()
                    ).inFlight,
                h.event.protocolEventTimeoutMs(),
                200
            );

            await h.execOnHost(
                h.peers[selectorIndex],
                async (stateManager, args) => {
                    const profile =
                        stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                            args.peerAddress
                        );
                    if (!profile?.transport) {
                        throw new Error("Selected peer transport is missing");
                    }
                    await stateManager.p2pManager.localRpc.webRTCSetupService.initiateWebRTC(
                        profile.transport
                    );
                },
                { peerAddress: h.peers[advertiserIndex].address },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );
            await waitFor(
                async () =>
                    (await h
                        .control(h.peers[selectorIndex])
                        .query.getPreferredTransportType(
                            h.peers[advertiserIndex].address
                        )
                        .request()) === TransportType.WEBRTC,
                h.event.protocolEventTimeoutMs(),
                200
            );

            expect(
                (
                    await h
                        .control(h.peers[selectorIndex])
                        .query.getLobbyAvailability()
                        .request()
                ).inFlight
            ).to.equal(true);
            expect(
                await h
                    .control(h.peers[selectorIndex])
                    .query.isBlacklisted(h.peers[advertiserIndex].address)
                    .request()
            ).to.equal(false);

            await releasePick();
            let channelId = ethers.ZeroHash;
            await waitFor(
                async () => {
                    channelId = await h
                        .control(h.peers[selectorIndex])
                        .query.getChannelId()
                        .request();
                    return channelId !== ethers.ZeroHash;
                },
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                200
            );
            await waitFor(
                () =>
                    h
                        .control(h.peers[selectorIndex])
                        .query.isChannelOpen(channelId)
                        .request(),
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                50
            );
        } finally {
            await releasePick();
            await h.rpc.leaveLobby([0, 1], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("keeps the committed pair intact when transport upgrade completes during negotiation handoff", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-post-commit-transport-upgrade");
        const releaseMatched = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdMatchedNegotiation(index))
        );

        try {
            await h.rpc.joinLobby([0, 1], topic);
            await waitFor(
                async () => {
                    const [heldCounts, availability] = await Promise.all([
                        Promise.all(
                            h.peers.map((peer) =>
                                h
                                    .control(peer)
                                    .stub.getHeldMatchedNegotiationCount()
                                    .request()
                            )
                        ),
                        Promise.all(
                            h.peers.map((peer) =>
                                h
                                    .control(peer)
                                    .query.getLobbyAvailability()
                                    .request()
                            )
                        )
                    ]);
                    return (
                        heldCounts.every((count) => count === 1) &&
                        availability.every((value) => !value.matching)
                    );
                },
                h.event.protocolEventTimeoutMs(),
                200
            );

            await h.execOnHost(
                h.peers[0],
                async (stateManager, args) => {
                    const profile =
                        stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                            args.peerAddress
                        );
                    if (!profile?.transport) {
                        throw new Error("Committed peer transport is missing");
                    }
                    await stateManager.p2pManager.localRpc.webRTCSetupService.initiateWebRTC(
                        profile.transport
                    );
                },
                { peerAddress: h.peers[1].address },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            h.peers.map((peer, index) =>
                                h
                                    .control(peer)
                                    .query.getPreferredTransportType(
                                        h.peers[1 - index].address
                                    )
                                    .request()
                            )
                        )
                    ).every((type) => type === TransportType.WEBRTC),
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(
                await Promise.all([
                    h
                        .control(h.peers[0])
                        .query.isBlacklisted(h.peers[1].address)
                        .request(),
                    h
                        .control(h.peers[1])
                        .query.isBlacklisted(h.peers[0].address)
                        .request()
                ])
            ).to.deep.equal([false, false]);

            await Promise.all(releaseMatched.map((release) => release()));
            let channelIds = [ethers.ZeroHash, ethers.ZeroHash];
            await waitFor(
                async () => {
                    channelIds = await Promise.all(
                        h.peers.map((peer) =>
                            h.control(peer).query.getChannelId().request()
                        )
                    );
                    return (
                        channelIds[0] !== ethers.ZeroHash &&
                        channelIds[0] === channelIds[1]
                    );
                },
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                200
            );
            await waitFor(
                () =>
                    h
                        .control(h.peers[0])
                        .query.isChannelOpen(channelIds[0])
                        .request(),
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                50
            );
            const openChannelIds = await h
                .control(h.peers[0])
                .query.getOpenChannelIds()
                .request();
            expect(
                openChannelIds.filter(
                    (openChannelId: string) => openChannelId === channelIds[0]
                )
            ).to.have.length(1);
            expect(
                await Promise.all([
                    h
                        .control(h.peers[0])
                        .query.isBlacklisted(h.peers[1].address)
                        .request(),
                    h
                        .control(h.peers[1])
                        .query.isBlacklisted(h.peers[0].address)
                        .request()
                ])
            ).to.deep.equal([false, false]);
        } finally {
            await Promise.all(releaseMatched.map((release) => release()));
            await h.rpc.leaveLobby([0, 1], topic);
        }
    });

    it("keeps a reservation unchanged under stale, duplicate, malformed, and wrong-peer RPCs", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-raw-rpc-validation");
        const [advertiserIndex, selectorIndex] =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? [0, 1]
                : [1, 0];
        const releaseCommit = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "commit"
        );
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.rpc.joinLobby([advertiserIndex, selectorIndex], topic);
            let advertiserAvailability: {
                role: string;
                roleEpoch: number;
                reserved: boolean;
            } | null = null;
            await waitFor(
                async () => {
                    advertiserAvailability = await h
                        .control(h.peers[advertiserIndex])
                        .query.getLobbyAvailability()
                        .request();
                    return advertiserAvailability.reserved;
                },
                h.event.protocolEventTimeoutMs(),
                200
            );
            await h.rpc.joinLobby([2], topic);
            await waitFor(
                async () =>
                    (
                        await h
                            .control(h.peers[2])
                            .query.getLobbyAvailability()
                            .request()
                    ).role !== "none",
                h.event.protocolEventTimeoutMs(),
                200
            );

            await h.execOnHost(
                h.peers[advertiserIndex],
                async (stateManager, args) =>
                    stateManager.eventHandler.onStateSnapshotUpdated(
                        args.channelId,
                        args.snapshot,
                        { blockNumber: 1, logIndex: 1 }
                    ),
                {
                    channelId: ethers.id("stale-closed-channel"),
                    snapshot: {
                        snapshotData: {
                            originForkId: ethers.ZeroHash,
                            stateMachineStateHash: ethers.ZeroHash,
                            participants: [],
                            latestInboundMessageBlockHash: ethers.ZeroHash,
                            latestInboundMessageBlockHeight: 0,
                            latestOutboundMessageBlockHash: ethers.ZeroHash,
                            latestOutboundMessageBlockHeight: 0,
                            totalDeposits: { amount: 0, data: "0x" },
                            totalWithdrawals: { amount: 0, data: "0x" }
                        },
                        forkId: ethers.ZeroHash,
                        blockHeight: 0,
                        timestamp: 0
                    }
                }
            );
            expect(
                await h
                    .control(h.peers[advertiserIndex])
                    .query.getStatus()
                    .request()
            ).to.equal(Status.DISCOVERING);
            expect(
                await h
                    .control(h.peers[advertiserIndex])
                    .query.getOpenConnectionCount()
                    .request()
            ).to.equal(0);

            const validNonce = `0x${"91".repeat(32)}`;
            const validChallenge = `0x${"92".repeat(32)}`;
            await h.byzantine.sendRawLobbyRpc(
                selectorIndex,
                advertiserIndex,
                "advertise",
                [topic, "advertiser", 0, true]
            );
            await h.byzantine.sendRawLobbyRpc(
                selectorIndex,
                advertiserIndex,
                "pick",
                [
                    topic,
                    validNonce,
                    advertiserAvailability!.roleEpoch,
                    validChallenge
                ]
            );
            await h.byzantine.sendRawLobbyRpc(
                selectorIndex,
                advertiserIndex,
                "commit",
                [
                    topic,
                    validNonce,
                    advertiserAvailability!.roleEpoch,
                    "0x12",
                    "0x34"
                ]
            );
            await h.byzantine.sendRawLobbyRpc(2, advertiserIndex, "commit", [
                topic,
                validNonce,
                advertiserAvailability!.roleEpoch,
                validChallenge,
                `0x${"93".repeat(32)}`
            ]);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const after = await h
                .control(h.peers[advertiserIndex])
                .query.getLobbyAvailability()
                .request();
            expect(after.reserved).to.equal(true);
            expect(after.role).to.equal("advertiser");
            expect(
                await h
                    .control(h.peers[advertiserIndex])
                    .query.isBlacklisted(h.peers[selectorIndex].address)
                    .request()
            ).to.equal(false);
        } finally {
            await releaseCommit();
            await h.rpc.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("queues early negotiation while matched initialization and ID selection are held", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-deferred-negotiation");
        const higherIndex =
            compareAddresses(h.peers[0].address, h.peers[1].address) > 0
                ? 0
                : 1;
        const releaseMatched =
            await h.rpcStub.holdMatchedNegotiation(higherIndex);
        const releaseSetChannelId =
            await h.rpcStub.holdSetChannelId(higherIndex);

        try {
            await h.rpc.joinLobby([0, 1], topic);
            await waitFor(
                async () =>
                    (await h
                        .control(h.peers[higherIndex])
                        .stub.getHeldMatchedNegotiationCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(
                await h
                    .control(h.peers[higherIndex])
                    .query.getChannelId()
                    .request()
            ).to.equal(ethers.ZeroHash);

            await releaseMatched();
            await waitFor(
                async () =>
                    (await h
                        .control(h.peers[higherIndex])
                        .stub.getHeldSetChannelIdCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(
                await h
                    .control(h.peers[higherIndex])
                    .query.getChannelId()
                    .request()
            ).to.equal(ethers.ZeroHash);

            await releaseSetChannelId();
            let channelId = ethers.ZeroHash;
            await waitFor(
                async () => {
                    channelId = await h
                        .control(h.peers[higherIndex])
                        .query.getChannelId()
                        .request();
                    return channelId !== ethers.ZeroHash;
                },
                h.event.protocolEventTimeoutMs(),
                200
            );
            await waitFor(
                () =>
                    h
                        .control(h.peers[higherIndex])
                        .query.isChannelOpen(channelId)
                        .request(),
                h.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                }),
                50
            );
        } finally {
            await releaseMatched();
            await releaseSetChannelId();
            await h.rpc.leaveLobby([0, 1], topic);
        }
    });

    it("redials and rejects a non-selected local peer until completeLobby leaves the topic", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-redial-until-complete");
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).stub.countInitHandshakeCalls().request()
            )
        );
        const releases = await Promise.all(
            h.peers.map((peer) => h.rpcStub.holdMatchedNegotiation(peer.index))
        );
        const joins = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.joinLobby(topic)
        );

        try {
            let matchedIndices: number[] = [];
            await waitFor(
                async () => {
                    const held = await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.getHeldMatchedNegotiationCount()
                                .request()
                        )
                    );
                    matchedIndices = held
                        .map((count, index) => ({ count, index }))
                        .filter(({ count }) => count === 1)
                        .map(({ index }) => index);
                    return matchedIndices.length === 2;
                },
                h.event.protocolEventTimeoutMs(),
                200
            );
            const unmatchedIndex = [0, 1, 2].find(
                (index) => !matchedIndices.includes(index)
            )!;
            const handoffCounts = await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.getInitHandshakeCallCount().request()
                )
            );
            await waitFor(
                async () => {
                    const counts = await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.getInitHandshakeCallCount()
                                .request()
                        )
                    );
                    return (
                        counts[unmatchedIndex] >
                            handoffCounts[unmatchedIndex] &&
                        matchedIndices.some(
                            (index) => counts[index] > handoffCounts[index]
                        )
                    );
                },
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(
                await Promise.all(
                    matchedIndices.map((index) =>
                        h
                            .control(h.peers[index])
                            .query.isBlacklisted(
                                h.peers[unmatchedIndex].address
                            )
                            .request()
                    )
                )
            ).to.deep.equal([false, false]);
            const heldAfterReplacement = await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .stub.getHeldMatchedNegotiationCount()
                        .request()
                )
            );
            expect(
                matchedIndices.map((index) => heldAfterReplacement[index])
            ).to.deep.equal([1, 1]);
            expect(heldAfterReplacement[unmatchedIndex]).to.equal(0);

            await Promise.all(matchedIndices.map((index) => releases[index]()));
            await Promise.all(matchedIndices.map((index) => joins[index]));
            await h.peers[unmatchedIndex].p2pInstance.p2pSigner.leaveLobby(
                topic
            );
            await joins[unmatchedIndex];

            const settledCounts = await Promise.all(
                matchedIndices.map((index) =>
                    h
                        .control(h.peers[index])
                        .stub.getInitHandshakeCallCount()
                        .request()
                )
            );
            await sleep(600);
            expect(
                await Promise.all(
                    matchedIndices.map((index) =>
                        h
                            .control(h.peers[index])
                            .stub.getInitHandshakeCallCount()
                            .request()
                    )
                )
            ).to.deep.equal(settledCounts);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await Promise.all(
                h.peers.map((peer) =>
                    peer.p2pInstance.p2pSigner.leaveLobby(topic)
                )
            );
            await Promise.allSettled(joins);
        }
    });

    it("redials and rejects a non-selected local peer until releaseNegotiationHandoff leaves the topic", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const channelId = ethers.id("e2e-targeted-redial-until-release");
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).stub.countInitHandshakeCalls().request()
            )
        );
        const releases = await Promise.all(
            h.peers.map((peer) =>
                h.rpcStub.holdMatchedNegotiation(peer.index, true)
            )
        );
        const connects = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                autoOpen: true
            })
        );

        try {
            let matchedIndices: number[] = [];
            await waitFor(
                async () => {
                    const held = await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.getHeldMatchedNegotiationCount()
                                .request()
                        )
                    );
                    matchedIndices = held
                        .map((count, index) => ({ count, index }))
                        .filter(({ count }) => count === 1)
                        .map(({ index }) => index);
                    return matchedIndices.length === 2;
                },
                h.event.protocolEventTimeoutMs(),
                200
            );
            const unmatchedIndex = [0, 1, 2].find(
                (index) => !matchedIndices.includes(index)
            )!;
            const handoffCounts = await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.getInitHandshakeCallCount().request()
                )
            );
            await waitFor(
                async () => {
                    const counts = await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.getInitHandshakeCallCount()
                                .request()
                        )
                    );
                    return (
                        counts[unmatchedIndex] >
                            handoffCounts[unmatchedIndex] &&
                        matchedIndices.some(
                            (index) => counts[index] > handoffCounts[index]
                        )
                    );
                },
                h.event.protocolEventTimeoutMs(),
                200
            );
            expect(
                await Promise.all(
                    matchedIndices.map((index) =>
                        h
                            .control(h.peers[index])
                            .query.isBlacklisted(
                                h.peers[unmatchedIndex].address
                            )
                            .request()
                    )
                )
            ).to.deep.equal([false, false]);
            const heldAfterReplacement = await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .stub.getHeldMatchedNegotiationCount()
                        .request()
                )
            );
            expect(
                matchedIndices.map((index) => heldAfterReplacement[index])
            ).to.deep.equal([1, 1]);
            expect(heldAfterReplacement[unmatchedIndex]).to.equal(0);

            await Promise.all(matchedIndices.map((index) => releases[index]()));
            expect(
                await Promise.all(
                    matchedIndices.map((index) => connects[index])
                )
            ).to.deep.equal([false, false]);
            expect(
                await h.peers[
                    unmatchedIndex
                ].p2pInstance.p2pSigner.cancelConnectToChannel(channelId)
            ).to.equal(true);
            expect(await connects[unmatchedIndex]).to.equal(false);

            const settledCounts = await Promise.all(
                matchedIndices.map((index) =>
                    h
                        .control(h.peers[index])
                        .stub.getInitHandshakeCallCount()
                        .request()
                )
            );
            await sleep(600);
            expect(
                await Promise.all(
                    matchedIndices.map((index) =>
                        h
                            .control(h.peers[index])
                            .stub.getInitHandshakeCallCount()
                            .request()
                    )
                )
            ).to.deep.equal(settledCounts);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await Promise.all(
                h.peers.map((peer) =>
                    peer.p2pInstance.p2pSigner.cancelConnectToChannel(channelId)
                )
            );
            await Promise.allSettled(connects);
        }
    });
});
