import { TransportType } from "@/transport/TransportType";
import { Status } from "@/types";
import { sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

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
                await h.network.joinLobby([0, 1], topic);
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
        const lowerIndex = h.network.lobbyRoleIndices()[0];
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
                    h.network.joinLobby([0, 1], firstTopic),
                    h.network.joinLobby([2, 3], secondTopic)
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

        await h.network.joinLobby([0, 1, 2, 3], topic);

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

    it("suspends a repeatedly silent picker at the retry bound and pairs with another peer on the same topic", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-silent-pick-recovery");
        const [lowerIndex, higherIndex] = h.network.lobbyRoleIndices();
        const releaseReply = await h.rpcStub.holdLobbyReply(lowerIndex, "pick");
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.network.joinLobby([lowerIndex, higherIndex], topic);
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[higherIndex],
                target: h.peers[lowerIndex]
            });

            // One strike keeps the silent peer selectable, so the selector
            // keeps picking it until the third silence suspends it for the
            // session. The third peer joins only after that, so the pairing
            // below is the suspension's consequence and not a race with it.
            await waitFor(
                () =>
                    h
                        .control(h.peers[higherIndex])
                        .query.isSuspended(h.peers[lowerIndex].address)
                        .request(),
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }) *
                    2,
                200
            );
            expect(
                await h
                    .control(h.peers[higherIndex])
                    .query.isBlacklisted(h.peers[lowerIndex].address)
                    .request()
            ).to.equal(false);
            await h.network.joinLobby([2], topic);
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
            await h.network.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("treats final profile loss during selection as neutral and retries immediately", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-final-profile-loss");
        const [lowerIndex, higherIndex] = h.network.lobbyRoleIndices();
        const releaseReply = await h.rpcStub.holdLobbyReply(lowerIndex, "pick");
        let replyReleased = false;
        const restoreDurations = await Promise.all(
            [0, 1, 2].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.network.joinLobby([lowerIndex, higherIndex], topic);
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
            await h.network.leaveLobby([lowerIndex], topic);

            await h.network.joinLobby([2], topic);
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
            await h.network.leaveLobby([higherIndex, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("strikes both sides after commitment silence and lets the same pair rematch", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-silent-commit-recovery");
        const [advertiserIndex, selectorIndex] = h.network.lobbyRoleIndices();
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
            await h.network.joinLobby([advertiserIndex, selectorIndex], topic);
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[advertiserIndex],
                target: h.peers[selectorIndex]
            });
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[selectorIndex],
                target: h.peers[advertiserIndex]
            });
            // The held reply parks every commit, including the rematch's;
            // releasing it lets the pair's next commitment through.
            await releaseReply();
            // One strike is below the bound, so both peers keep the topic,
            // reconnect, and are free to pair again: the next attempt opens.
            await waitFor(
                async () => {
                    const channelIds = await Promise.all(
                        [advertiserIndex, selectorIndex].map((index) =>
                            h
                                .control(h.peers[index])
                                .query.getChannelId()
                                .request()
                        )
                    );
                    return (
                        channelIds[0] !== ethers.ZeroHash &&
                        channelIds[0] === channelIds[1] &&
                        (await h
                            .control(h.peers[advertiserIndex])
                            .query.isChannelOpen(channelIds[0])
                            .request())
                    );
                },
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                200
            );
            expect(
                await Promise.all(
                    [advertiserIndex, selectorIndex].map((index) =>
                        h
                            .control(h.peers[index])
                            .query.isBlacklisted(
                                h.peers[
                                    index === advertiserIndex
                                        ? selectorIndex
                                        : advertiserIndex
                                ].address
                            )
                            .request()
                    )
                )
            ).to.deep.equal([false, false]);
        } finally {
            await releaseReply();
            await h.network.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("excludes both sides when the advertiser bound fires before the selector bound", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-advertiser-bound-first");
        const [advertiserIndex, selectorIndex] = h.network.lobbyRoleIndices();
        const releaseReply = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "commit"
        );
        // The selector's own commit timeout never fires: its exclusion can only
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
            await h.network.joinLobby([advertiserIndex, selectorIndex], topic);
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[advertiserIndex],
                target: h.peers[selectorIndex]
            });
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[selectorIndex],
                target: h.peers[advertiserIndex],
                pollMs: 50
            });
            // One strike leaves the pair free to match again, so a second
            // commit timeout may already be held by the time the first is read.
            expect(await selectorTimeout.heldCount()).to.be.at.least(1);
            await releaseReply();
            expect(
                await h
                    .control(h.peers[selectorIndex])
                    .query.getNegotiationAttempt()
                    .request()
            ).to.equal(null);
        } finally {
            await selectorTimeout.release(false);
            await h.network.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("excludes both sides when the selector bound fires before the advertiser bound", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-selector-bound-first");
        const [advertiserIndex, selectorIndex] = h.network.lobbyRoleIndices();
        const releaseReply = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "commit"
        );
        // The advertiser's reservation bound is held, so the selector's commit
        // timeout fires first and closes the transport. The reservation must
        // survive that loss and exclude when its bound is released.
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
            await h.network.joinLobby([advertiserIndex, selectorIndex], topic);
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[selectorIndex],
                target: h.peers[advertiserIndex]
            });
            expect(await advertiserExpiry.heldCount()).to.equal(1);
            expect(
                await h
                    .control(h.peers[advertiserIndex])
                    .query.getStrikes(h.peers[selectorIndex].address)
                    .request()
            ).to.equal(0);
            await advertiserExpiry.release(true);
            await h.assert.rpc.peerStruckWithoutBlacklist({
                observer: h.peers[advertiserIndex],
                target: h.peers[selectorIndex],
                pollMs: 50
            });
            await releaseReply();
            expect(
                await h
                    .control(h.peers[selectorIndex])
                    .query.getNegotiationAttempt()
                    .request()
            ).to.equal(null);
        } finally {
            await advertiserExpiry.release(false);
            await h.network.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("keeps a pending selection intact through a successful transport upgrade", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-transport-upgrade");
        const [advertiserIndex, selectorIndex] = h.network.lobbyRoleIndices();
        const releasePick = await h.rpcStub.holdLobbyReply(
            advertiserIndex,
            "pick"
        );
        // Keep the deliberately held pick pending while the real transport
        // upgrades. RPC-expiry liability is covered by the bound-order cases.
        const pickTimeout = await h.rpcStub.holdScheduledTasks(
            selectorIndex,
            "rpcRequest:lobbyMatchingService.pick"
        );
        const restoreDurations = await Promise.all(
            [0, 1].map((index) =>
                h.rpcStub.overrideLobbyRoleDuration(index, 20_000)
            )
        );

        try {
            await h.network.joinLobby([advertiserIndex, selectorIndex], topic);
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

            expect(await pickTimeout.heldCount()).to.equal(1);
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
            await pickTimeout.release(false);
            await h.network.leaveLobby([0, 1], topic);
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
            await h.network.joinLobby([0, 1], topic);
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
            await h.network.leaveLobby([0, 1], topic);
        }
    });

    it("keeps a reservation unchanged under stale, duplicate, malformed, and wrong-peer RPCs", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-raw-rpc-validation");
        const [advertiserIndex, selectorIndex] = h.network.lobbyRoleIndices();
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
            await h.network.joinLobby([advertiserIndex, selectorIndex], topic);
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
            await h.network.joinLobby([2], topic);
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
            await h.network.leaveLobby([0, 1, 2], topic);
            await Promise.all(restoreDurations.map((restore) => restore()));
        }
    });

    it("queues early negotiation while matched initialization and ID selection are held", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-deferred-negotiation");
        const higherIndex = h.network.lobbyRoleIndices()[1];
        const releaseMatched =
            await h.rpcStub.holdMatchedNegotiation(higherIndex);
        const releaseSetChannelId =
            await h.rpcStub.holdSetChannelId(higherIndex);

        try {
            await h.network.joinLobby([0, 1], topic);
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
            await h.network.leaveLobby([0, 1], topic);
        }
    });

    it("leaves the lobby topic at handoff so the matched pair stops redialing non-selected peers during negotiation", async function () {
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
            // The matched pair left the lobby topic before cutting the
            // non-selected peer, so neither of them redials it during the
            // negotiation. A peer still in the lobby may reconnect once more
            // and is closed again without penalty.
            const handoffCounts = await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.getInitHandshakeCallCount().request()
                )
            );
            await sleep(600);
            expect(
                await Promise.all(
                    h.peers.map((peer) =>
                        h
                            .control(peer)
                            .stub.getInitHandshakeCallCount()
                            .request()
                    )
                )
            ).to.deep.equal(handoffCounts);
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
            const heldDuringNegotiation = await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .stub.getHeldMatchedNegotiationCount()
                        .request()
                )
            );
            expect(
                matchedIndices.map((index) => heldDuringNegotiation[index])
            ).to.deep.equal([1, 1]);
            expect(heldDuringNegotiation[unmatchedIndex]).to.equal(0);

            await Promise.all(matchedIndices.map((index) => releases[index]()));
            await Promise.all(matchedIndices.map((index) => joins[index]));
            await h.peers[unmatchedIndex].p2pInstance.p2pSigner.leaveLobby(
                topic
            );
            await joins[unmatchedIndex];
            const openedChannelIds = await Promise.all(
                matchedIndices.map((index) =>
                    h.control(h.peers[index]).query.getChannelId().request()
                )
            );
            expect(openedChannelIds[0]).to.equal(openedChannelIds[1]);
            expect(openedChannelIds[0]).not.to.equal(ethers.ZeroHash);
            expect(
                await h
                    .control(h.peers[matchedIndices[0]])
                    .query.isChannelOpen(openedChannelIds[0])
                    .request()
            ).to.equal(true);
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

    it("leaves the targeted lobby topic at handoff so the matched pair stops redialing non-selected peers during negotiation", async function () {
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
            // The matched pair left the targeted lobby topic before cutting
            // the non-selected peer, so neither of them redials it during the
            // negotiation. A peer still in the lobby may reconnect once more
            // and is closed again without penalty.
            const handoffCounts = await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.getInitHandshakeCallCount().request()
                )
            );
            await sleep(600);
            expect(
                await Promise.all(
                    h.peers.map((peer) =>
                        h
                            .control(peer)
                            .stub.getInitHandshakeCallCount()
                            .request()
                    )
                )
            ).to.deep.equal(handoffCounts);
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
            const heldDuringNegotiation = await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .stub.getHeldMatchedNegotiationCount()
                        .request()
                )
            );
            expect(
                matchedIndices.map((index) => heldDuringNegotiation[index])
            ).to.deep.equal([1, 1]);
            expect(heldDuringNegotiation[unmatchedIndex]).to.equal(0);

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

    it("treats a remote negotiation abort as a lobby exit, not a fault", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-negotiation-abort");
        const [lowerIndex, higherIndex] = h.network.lobbyRoleIndices();

        try {
            // Both attempts exist while the terms exchange is parked, so the
            // abort lands on a live commitment.
            await h.rpcStub.withHeldNegotiationReplies(
                [lowerIndex, higherIndex],
                "exchangeTerms",
                async () => {
                    await h.network.joinLobby([lowerIndex, higherIndex], topic);
                    await waitFor(
                        async () =>
                            !!(await h
                                .control(h.peers[higherIndex])
                                .query.getNegotiationAttempt()
                                .request()),
                        h.event.protocolEventTimeoutMs({
                            withFirstBlockGrace: true
                        }),
                        200
                    );
                    const commitment = await h
                        .control(h.peers[higherIndex])
                        .query.getNegotiationAttempt()
                        .request();
                    if (!commitment) {
                        throw new Error("Negotiation attempt is gone");
                    }
                    await h.byzantine.sendRawNegotiationRpc(
                        lowerIndex,
                        higherIndex,
                        "abort",
                        [
                            commitment.attemptNonce,
                            commitment.selectorChallenge,
                            commitment.advertiserChallenge,
                            "peer left the negotiation"
                        ]
                    );
                    await waitFor(
                        async () =>
                            (await h
                                .control(h.peers[higherIndex])
                                .query.getNegotiationAttempt()
                                .request()) === null,
                        h.event.protocolEventTimeoutMs(),
                        100
                    );
                    expect(
                        await h
                            .control(h.peers[higherIndex])
                            .query.isBlacklisted(h.peers[lowerIndex].address)
                            .request()
                    ).to.equal(false);
                    // A polite abort is neither a verdict nor a strike.
                    expect(
                        await h
                            .control(h.peers[higherIndex])
                            .query.getStrikes(h.peers[lowerIndex].address)
                            .request()
                    ).to.equal(0);
                }
            );
        } finally {
            await h.network.leaveLobby([lowerIndex, higherIndex], topic);
        }
    });

    it("keeps a signed attempt observing the chain after a remote abort and opens on the observed submission", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("e2e-lobby-signed-abort-observation");
        const [lowerIndex, higherIndex] = h.network.lobbyRoleIndices();
        const lower = h.peers[lowerIndex];
        const higher = h.peers[higherIndex];
        const higherAttempt = () =>
            h.control(higher).query.getNegotiationAttempt().request();

        // The higher peer signs the opening and parks its submission, so the
        // abort lands on an attempt that already carries a local signature.
        await h.control(higher).stub.stubHoldOpeningSubmission().request();
        try {
            await h.network.joinLobby([lowerIndex, higherIndex], topic);
            await waitFor(
                async () =>
                    (await h
                        .control(higher)
                        .stub.getHeldOpeningSubmissionCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                100
            );
            const signed = await higherAttempt();
            if (!signed) throw new Error("Negotiation attempt is gone");
            expect(signed.localOpeningSignatureIssued).to.equal(true);

            await h.byzantine.sendRawNegotiationRpc(
                lowerIndex,
                higherIndex,
                "abort",
                [
                    signed.attemptNonce,
                    signed.selectorChallenge,
                    signed.advertiserChallenge,
                    "peer left the negotiation"
                ]
            );
            await waitFor(
                () =>
                    h
                        .control(higher)
                        .query.isTransportClosed(lower.address)
                        .request(),
                h.event.protocolEventTimeoutMs(),
                100
            );
            // A polite abort closes the pipe with no strike and no verdict,
            // and the signed attempt stays to observe the chain.
            expect(await higherAttempt()).not.to.equal(null);
            expect(
                await h
                    .control(higher)
                    .query.getStrikes(lower.address)
                    .request()
            ).to.equal(0);
            expect(
                await h
                    .control(higher)
                    .query.isBlacklisted(lower.address)
                    .request()
            ).to.equal(false);
            // The lower peer lost its committed partner mid-negotiation: one
            // strike, and its own signed attempt keeps observing too.
            expect(
                await h
                    .control(lower)
                    .query.getStrikes(higher.address)
                    .request()
            ).to.equal(1);

            await h.control(higher).stub.releaseOpeningSubmission().request();
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            [lower, higher].map((peer) =>
                                h
                                    .control(peer)
                                    .query.isChannelOpen(signed.channelId)
                                    .request()
                            )
                        )
                    ).every(Boolean),
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }) *
                    2,
                100
            );
        } finally {
            await h.control(higher).stub.releaseOpeningSubmission().request();
            await h.network.leaveLobby([lowerIndex, higherIndex], topic);
        }
    });

    it("retries a targeted connect on the same runtime after a remote abort", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const channelId = ethers.id("e2e-targeted-retry-after-abort");
        const [lowerIndex, higherIndex] = h.network.lobbyRoleIndices();
        const lower = h.peers[lowerIndex];
        const higher = h.peers[higherIndex];
        const pair = [lower, higher];
        const releases = await Promise.all(
            [lowerIndex, higherIndex].map((index) =>
                h.rpcStub.holdNegotiationReply(index, "exchangeTerms")
            )
        );
        const connects = pair.map((peer) =>
            peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                autoOpen: true
            })
        );
        let retries: Promise<boolean>[] = [];

        try {
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            pair.map((peer) =>
                                h
                                    .control(peer)
                                    .query.getNegotiationAttempt()
                                    .request()
                            )
                        )
                    ).every((attempt) => attempt !== null),
                h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true }),
                200
            );
            const commitment = await h
                .control(higher)
                .query.getNegotiationAttempt()
                .request();
            if (!commitment) throw new Error("Negotiation attempt is gone");
            await h.byzantine.sendRawNegotiationRpc(
                lowerIndex,
                higherIndex,
                "abort",
                [
                    commitment.attemptNonce,
                    commitment.selectorChallenge,
                    commitment.advertiserChallenge,
                    "peer left the negotiation"
                ]
            );
            // Both targeted calls end without a verdict or a strike on either
            // side: the aborted peer treats the abort as a lobby exit, the
            // aborting peer lost its committed partner in a targeted attempt.
            expect(await Promise.all(connects)).to.deep.equal([false, false]);
            expect(
                await Promise.all([
                    h.control(higher).query.getStrikes(lower.address).request(),
                    h.control(lower).query.getStrikes(higher.address).request()
                ])
            ).to.deep.equal([0, 0]);
            expect(
                await Promise.all([
                    h
                        .control(higher)
                        .query.isBlacklisted(lower.address)
                        .request(),
                    h
                        .control(lower)
                        .query.isBlacklisted(higher.address)
                        .request()
                ])
            ).to.deep.equal([false, false]);

            await Promise.all(releases.map((release) => release()));
            // The same runtime asks for the same channel again and opens it.
            retries = pair.map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true
                })
            );
            expect(await Promise.all(retries)).to.deep.equal([true, true]);
            expect(
                await Promise.all(
                    pair.map((peer) =>
                        h.control(peer).query.isChannelOpen(channelId).request()
                    )
                )
            ).to.deep.equal([true, true]);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await Promise.all(
                pair.map((peer) =>
                    peer.p2pInstance.p2pSigner.cancelConnectToChannel(channelId)
                )
            );
            await Promise.allSettled([...connects, ...retries]);
        }
    });
});
