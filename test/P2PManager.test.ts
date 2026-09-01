import { expect } from "chai";
import { ethers, Wallet } from "ethers";

import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { Status } from "@/types";
import { channelIdToTargetedJoinTopic } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";

describe("P2PManager", function () {
    let fixture: P2PManagerFixture | undefined;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture?.cleanup();
        fixture = undefined;
    });

    it("applies the frame-size, response, envelope, and service gates in order", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDispatchHead()
            .request();

        expect(result).to.deep.equal({
            oversizedDisconnected: true,
            oversizedBlacklisted: true,
            exactLimitAccepted: true,
            malformedDisconnected: true,
            malformedBlacklisted: true,
            unknownServiceDisconnected: true,
            unknownServiceBlacklisted: true,
            responseClassifiedBeforeDispatch: true
        });
    });

    it("accepts an exact-limit multibyte frame and rejects the first byte over", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeFrameByteBoundaries()
            .request();

        expect(result).to.deep.equal({
            multibyteExactAccepted: true,
            multibyteOverDisconnected: true,
            multibyteOverBlacklisted: true,
            validJsonInvalidEnvelopeDisconnected: true,
            validJsonInvalidEnvelopeBlacklisted: true
        });
    });

    it("keeps valid dispatches and disconnects false or throwing service dispatches", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDispatchOutcomes()
            .request();

        expect(result).to.deep.equal({
            validMethodStayedConnected: true,
            validMethodCalls: 1,
            unknownMethodDisconnected: true,
            unknownMethodBlacklisted: true,
            throwingServiceDisconnected: true,
            throwingServiceBlacklisted: false
        });
    });

    it("settles success, remote-error, default-error, and synchronous-send requests once", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeRequestSettlement()
            .request();

        expect(result).to.deep.equal({
            successValue: "accepted",
            remoteError: "remote failed",
            defaultRemoteError: "RPC request failed on the peer",
            sendError: "send failed",
            pendingCount: 0,
            timerCount: 0
        });
    });

    it("uses the agreement-time default or an explicit request timeout and releases both timers", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeTimeoutSelection()
            .request();

        expect(result.defaultOutcome).to.contain("timed out after 20ms");
        expect(result.explicitOutcome).to.contain("timed out after 7ms");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("settles the response-timeout race exactly once in both orders", async function () {
        const responseFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseTimeoutRace(true)
            .request();
        const timeoutFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseTimeoutRace(false)
            .request();

        expect(responseFirst.firstOutcome).to.equal("response");
        expect(timeoutFirst.firstOutcome).to.contain("timed out after 20ms");
        expect(responseFirst.connectionPresent).to.equal(true);
        expect(timeoutFirst.connectionPresent).to.equal(true);
        expect(responseFirst.pendingCount).to.equal(0);
        expect(timeoutFirst.pendingCount).to.equal(0);
        expect(responseFirst.timerCount).to.equal(0);
        expect(timeoutFirst.timerCount).to.equal(0);
    });

    it("settles the remote-error-timeout race exactly once in both orders", async function () {
        const errorFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorTimeoutRace(true)
            .request();
        const timeoutFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorTimeoutRace(false)
            .request();

        expect(errorFirst.firstOutcome).to.equal("remote error");
        expect(timeoutFirst.firstOutcome).to.contain("timed out after 20ms");
        expect(errorFirst.pendingCount).to.equal(0);
        expect(timeoutFirst.pendingCount).to.equal(0);
        expect(errorFirst.timerCount).to.equal(0);
        expect(timeoutFirst.timerCount).to.equal(0);
    });

    it("settles the response-remote-error race exactly once in both orders", async function () {
        const responseFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseRemoteErrorRace(true)
            .request();
        const errorFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseRemoteErrorRace(false)
            .request();

        expect(responseFirst.firstOutcome).to.equal("response");
        expect(errorFirst.firstOutcome).to.equal("remote error");
        expect(responseFirst.connectionPresent).to.equal(true);
        expect(errorFirst.connectionPresent).to.equal(true);
        expect(responseFirst.pendingCount).to.equal(0);
        expect(errorFirst.pendingCount).to.equal(0);
        expect(responseFirst.timerCount).to.equal(0);
        expect(errorFirst.timerCount).to.equal(0);
    });

    it("settles the response-disconnect race exactly once in both orders", async function () {
        const responseFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseDisconnectRace(true)
            .request();
        const disconnectFirst = await fixture!
            .control()
            .p2pManagerProbe.probeResponseDisconnectRace(false)
            .request();

        expect(responseFirst.firstOutcome).to.equal("response");
        expect(disconnectFirst.firstOutcome).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(responseFirst.connectionPresent).to.equal(false);
        expect(disconnectFirst.connectionPresent).to.equal(false);
        expect(responseFirst.pendingCount).to.equal(0);
        expect(disconnectFirst.pendingCount).to.equal(0);
        expect(responseFirst.timerCount).to.equal(0);
        expect(disconnectFirst.timerCount).to.equal(0);
    });

    it("settles the remote-error-disconnect race exactly once in both orders", async function () {
        const errorFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorDisconnectRace(true)
            .request();
        const disconnectFirst = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteErrorDisconnectRace(false)
            .request();

        expect(errorFirst.firstOutcome).to.equal("remote error");
        expect(disconnectFirst.firstOutcome).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(errorFirst.pendingCount).to.equal(0);
        expect(disconnectFirst.pendingCount).to.equal(0);
        expect(errorFirst.timerCount).to.equal(0);
        expect(disconnectFirst.timerCount).to.equal(0);
    });

    it("settles the timeout-disconnect race exactly once in both orders", async function () {
        const timeoutFirst = await fixture!
            .control()
            .p2pManagerProbe.probeTimeoutDisconnectRace(true)
            .request();
        const disconnectFirst = await fixture!
            .control()
            .p2pManagerProbe.probeTimeoutDisconnectRace(false)
            .request();

        expect(timeoutFirst.firstOutcome).to.contain("timed out after 15ms");
        expect(disconnectFirst.firstOutcome).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(timeoutFirst.pendingCount).to.equal(0);
        expect(disconnectFirst.pendingCount).to.equal(0);
        expect(timeoutFirst.timerCount).to.equal(0);
        expect(disconnectFirst.timerCount).to.equal(0);
    });

    it("uses distinct request IDs and settles concurrent responses once", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeConcurrentSettlement()
            .request();

        expect(result.firstRequestId).to.not.equal(result.secondRequestId);
        expect(result.firstValue).to.equal("first");
        expect(result.secondValue).to.equal("second");
        expect(result.racedValue).to.equal("winner");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("rejects and releases every pending request during disposal", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDisposal()
            .request();

        expect(result.outcomes).to.deep.equal([
            "Peer disconnected before RPC response arrived",
            "Peer disconnected before RPC response arrived"
        ]);
        expect(result.samePromise).to.equal(true);
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("cleans pending state and retains peer identity when transport close throws", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDisconnectCleanup(fixture!.address(1))
            .request();

        expect(result.closeCalls).to.equal(1);
        expect(result.connectionRemoved).to.equal(true);
        expect(result.profileTransportRetained).to.equal(true);
        expect(result.pendingError).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("original transport retirement rejects its pending request", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeTransportRetirement(fixture!.address(1))
            .request();

        expect(result.oldRequestError).to.equal(
            "Peer disconnected before RPC response arrived"
        );
        expect(result.oldConnectionRemoved).to.equal(true);
        expect(result.replacementConnected).to.equal(true);
        expect(result.replacementValue).to.equal("replacement-live");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("unrelated peer cannot settle pending request", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeForeignResponse(
                fixture!.address(0),
                fixture!.address(1)
            )
            .request();

        expect(result).to.deep.equal({
            foreignBlacklisted: true,
            foreignDisconnected: true,
            intendedValue: "intended"
        });
    });

    it("routes a response by peer address before retirement and ignores duplicates", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeRequestRegistry(fixture!.address(1))
            .request();

        expect(result.replacementValue).to.equal("replacement");
        expect(result.unknownResponseIgnored).to.equal(true);
        expect(result.duplicateResponseIgnored).to.equal(true);
        expect(result.pendingDisconnectErrors).to.deep.equal([
            "Peer disconnected before RPC response arrived",
            "Peer disconnected before RPC response arrived"
        ]);
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("deduplicates connections, broadcasts once, blacklists peers, and reports known addresses", async function () {
        const missingAddress = Wallet.createRandom().address;
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeLifecycle(
                fixture!.address(0),
                fixture!.address(1),
                missingAddress
            )
            .request();

        expect(result.broadcastCounts).to.deep.equal([1, 1, 1]);
        expect(result.duplicateAddCount).to.equal(1);
        expect(result.disconnectedCount).to.equal(2);
        expect(result.blacklistByTransport).to.equal(true);
        expect(result.blacklistByAddress).to.equal(true);
        expect(result.blacklistByStaleTransportAddress).to.equal(true);
        expect(result.staleAndCurrentDisconnected).to.equal(true);
        expect(result.missingAddressIgnored).to.equal(true);
        expect(result.connectedPeers).to.deep.equal([
            fixture!.address(0),
            fixture!.address(1)
        ]);
    });

    it("blacklists and disconnects every peer in a bulk penalty", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeBulkPenalty(
                fixture!.address(0),
                fixture!.address(1)
            )
            .request();

        expect(result.blacklisted).to.deep.equal([true, true]);
        expect(result.disconnected).to.deep.equal([true, true]);
    });

    it("uses profile fallback, deduplicates addresses, and omits unknown peers", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeConnectedPeerFallback(fixture!.address(1))
            .request();

        expect(result.connectedPeers).to.deep.equal([fixture!.address(1)]);
    });

    it("keeps an OPENED connection and reports once when the participant read fails", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeHandshakeParticipantReadFailure(
                fixture!.address(1)
            )
            .request();

        expect(result.connected).to.equal(true);
        expect(result.syncCallCount).to.equal(0);
        expect(result.hookCount).to.equal(1);
        expect(result.failureLogged).to.equal(true);
    });

    it("ignores a completed handshake with no registered transport", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeMissingHandshake(
                Wallet.createRandom().address
            )
            .request();

        expect(result.connected).to.equal(false);
        expect(result.hookCount).to.equal(0);
    });

    it("does not promote a transport that closed before handshake dispatch", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeClosedHandshake(fixture!.address(1))
            .request();

        expect(result.connected).to.equal(false);
        expect(result.hookCount).to.equal(0);
    });

    it("does not promote a late handshake after manager disposal", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDisposedHandshake(fixture!.address(1))
            .request();

        expect(result.connected).to.equal(false);
        expect(result.hookCount).to.equal(0);
    });

    it("retires a replaced handshake transport and keeps one live connection", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeReplacementHandshake(fixture!.address(1))
            .request();

        expect(result.connectedCount).to.equal(1);
        expect(result.replacementConnected).to.equal(true);
        expect(result.hookCount).to.equal(2);
    });

    it("emits profile loss only after the last live transport closes", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeProfileDisconnectLifecycle(
                fixture!.address(1)
            )
            .request();

        expect(result).to.deep.equal({
            unauthenticatedFinalCount: 1,
            authenticatedRebindCount: 1,
            upgradeCountBeforeFinal: 0,
            fallbackWasPromoted: true,
            upgradeFinalCount: 1,
            repeatedCloseCount: 1,
            unsubscribeCount: 0
        });
    });

    describe("targeted connect host composition", function () {
        const addObserver = async () => {
            const h = fixture!.getHarness();
            const observerIndex = h.peers.length;
            await h.createPeer(
                observerIndex,
                h.signerFor(slotAccountIndex(observerIndex))
            );
            return h.getPeer(observerIndex);
        };

        it("initial handshake selects the two-window channel-load sync entry", async function () {
            const h = fixture!.getHarness();
            await h.lifecycle.openChannelForParticipants([0, 1]);
            await h.network.joinSelectedKey([0, 1], String(h.channelId));
            const observer = await addObserver();
            const restore = await h.rpcStub.recordSpectateSync(observer.index, {
                forward: true
            });
            try {
                expect(
                    await observer.p2pInstance.p2pSigner.connectToChannel(
                        h.channelId
                    )
                ).to.equal(true);
                expect(
                    await h.rpcStub.spectateSyncCallCount(observer.index)
                ).to.equal(1);
                expect(
                    await h.control(observer).query.getStatus().request()
                ).to.equal(Status.SYNCED);
            } finally {
                await restore();
            }
        });

        it("normal post-open discovery reaches channel participants", async function () {
            const h = fixture!.getHarness();
            await h.lifecycle.openChannelForParticipants([0, 1]);
            await h.network.joinSelectedKey([0, 1], String(h.channelId));
            const observer = await addObserver();
            const restore = await h.rpcStub.recordSpectateSync(observer.index, {
                forward: true
            });
            try {
                expect(
                    await observer.p2pInstance.p2pSigner.connectToChannel(
                        h.channelId
                    )
                ).to.equal(true);
                const [source] = await h.rpcStub.spectateSyncTargetsWait(
                    observer.index,
                    1
                );
                expect(
                    h.peers
                        .slice(0, 2)
                        .map((peer) => peer.address.toLowerCase())
                ).to.include(source.toLowerCase());
                expect(
                    await h.query.getConnectionCount(observer.index)
                ).to.be.greaterThan(0);
            } finally {
                await restore();
            }
        });

        it("provider open event switches targeted matching to raw channel discovery", async function () {
            const h = fixture!.getHarness();
            const target = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["string"],
                    [h.options.channelId]
                )
            );
            const observers = [await addObserver(), await addObserver()];
            const releases = await Promise.all(
                observers.map((peer) =>
                    h.rpcStub.holdPostMatchTargetRefresh(peer.index)
                )
            );
            const connects = observers.map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(target, {
                    autoOpen: true
                })
            );
            try {
                await waitFor(
                    async () =>
                        (
                            await Promise.all(
                                observers.map((peer) =>
                                    h
                                        .control(peer)
                                        .stub.getHeldPostMatchTargetRefreshCount()
                                        .request()
                                )
                            )
                        ).every((count) => count === 1),
                    h.event.protocolEventTimeoutMs()
                );
                const preOpenAvailability = await Promise.all(
                    observers.map((peer) =>
                        h.control(peer).query.getLobbyAvailability().request()
                    )
                );
                expect(
                    preOpenAvailability.every(
                        ({ topic }) =>
                            topic === channelIdToTargetedJoinTopic(target)
                    )
                ).to.equal(true);
                const opening = h.lifecycle.openChannelForParticipants([0, 1]);
                await waitFor(
                    () =>
                        h
                            .control(h.getPeer(0))
                            .query.isChannelOpen(target)
                            .request(),
                    h.event.protocolEventTimeoutMs()
                );
                await h.network.joinSelectedKey([0, 1], target);
                await Promise.all(releases.map((release) => release()));
                await opening;
                expect(await Promise.all(connects)).to.deep.equal([true, true]);
                const postOpenAvailability = await Promise.all(
                    observers.map((peer) =>
                        h.control(peer).query.getLobbyAvailability().request()
                    )
                );
                expect(
                    postOpenAvailability.every(
                        ({ matching, topic }) =>
                            !matching && topic === undefined
                    )
                ).to.equal(true);
            } finally {
                await Promise.all(releases.map((release) => release()));
            }
        });

        it("unopened target without autoOpen leaves raw and matching discovery untouched", async function () {
            const h = fixture!.getHarness();
            const target = Wallet.createRandom().privateKey;
            expect(
                await h
                    .getPeer(0)
                    .p2pInstance.p2pSigner.connectToChannel(target)
            ).to.equal(false);
            expect(
                await h
                    .control(h.getPeer(0))
                    .query.getLobbyAvailability()
                    .request()
            ).to.include({ matching: false });
        });

        it("targeted matching keeps the selected channel without entering DISCOVERING", async function () {
            const h = fixture!.getHarness();
            const target = Wallet.createRandom().privateKey;
            const signer = h.getPeer(0).p2pInstance.p2pSigner;
            const pending = signer.connectToChannel(target, {
                autoOpen: true,
                timeoutMs: 2_000
            });
            await waitFor(async () => {
                const availability = await h
                    .control(h.getPeer(0))
                    .query.getLobbyAvailability()
                    .request();
                return availability.matching;
            });
            expect(
                await h.control(h.getPeer(0)).query.getChannelId().request()
            ).to.equal(target);
            expect(
                await h.control(h.getPeer(0)).query.getStatus().request()
            ).to.equal(Status.NOT_OPENED);
            expect(
                await h
                    .control(h.getPeer(0))
                    .query.getLobbyAvailability()
                    .request()
            ).to.include({
                matching: true,
                topic: channelIdToTargetedJoinTopic(target)
            });
            expect(await signer.cancelConnectToChannel(target)).to.equal(true);
            expect(await pending).to.equal(false);
        });

        it("targeted matching probe settles after the derived topic is joined", async function () {
            const h = fixture!.getHarness();
            const target = Wallet.createRandom().privateKey;
            const signer = h.getPeer(0).p2pInstance.p2pSigner;
            const pending = signer.connectToChannel(target, {
                autoOpen: true
            });
            await waitFor(async () => {
                const availability = await h
                    .control(h.getPeer(0))
                    .query.getLobbyAvailability()
                    .request();
                return (
                    availability.matching &&
                    availability.topic === channelIdToTargetedJoinTopic(target)
                );
            }, h.event.protocolEventTimeoutMs());
            expect(await signer.cancelConnectToChannel(target)).to.equal(true);
            expect(await pending).to.equal(false);
        });

        it("unsigned targeted failure retains the target and blacklists neither peer", async function () {
            const h = fixture!.getHarness();
            const target = Wallet.createRandom().privateKey;
            await Promise.all(
                [0, 1].map((index) =>
                    h.rpcStub.failNextMatchedNegotiation(index)
                )
            );
            expect(
                await Promise.all(
                    h.peers.map((peer) =>
                        peer.p2pInstance.p2pSigner.connectToChannel(target, {
                            autoOpen: true
                        })
                    )
                )
            ).to.deep.equal([false, false]);
            expect(
                await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getChannelId().request()
                    )
                )
            ).to.deep.equal([target, target]);
            expect(
                await h
                    .control(h.getPeer(0))
                    .query.isBlacklisted(h.getPeer(1).address)
                    .request()
            ).to.equal(false);
        });

        it("explicit same-ID retry creates a fresh matcher and negotiation attempt", async function () {
            const h = fixture!.getHarness();
            const target = Wallet.createRandom().privateKey;
            await Promise.all(
                [0, 1].map((index) =>
                    h.rpcStub.failNextMatchedNegotiation(index)
                )
            );
            expect(
                await Promise.all(
                    h.peers.map((peer) =>
                        peer.p2pInstance.p2pSigner.connectToChannel(target, {
                            autoOpen: true
                        })
                    )
                )
            ).to.deep.equal([false, false]);
            const freshIndex = h.peers.length;
            await h.createPeer(
                freshIndex,
                h.signerFor(slotAccountIndex(freshIndex))
            );
            const fresh = h.getPeer(freshIndex);
            expect(
                await Promise.all([
                    h
                        .getPeer(0)
                        .p2pInstance.p2pSigner.connectToChannel(target, {
                            autoOpen: true
                        }),
                    fresh.p2pInstance.p2pSigner.connectToChannel(target, {
                        autoOpen: true
                    })
                ])
            ).to.deep.equal([true, true]);
        });

        it("fatal initial sync disposal leaves later connect calls false", async function () {
            await fixture!.cleanup();
            fixture = new P2PManagerFixture();
            await fixture.setup({
                timeConfig: {
                    agreementTime: 2,
                    p2pTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 2
                }
            });
            const h = fixture.getHarness();
            await h.lifecycle.openChannelForParticipants([0, 1]);
            await h.network.joinSelectedKey([0, 1], String(h.channelId));
            const observerIndex = h.peers.length;
            await h.createPeer(
                observerIndex,
                h.signerFor(slotAccountIndex(observerIndex))
            );
            const observer = h.getPeer(observerIndex);
            const releases = await Promise.all(
                [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
            );
            try {
                expect(
                    await observer.p2pInstance.p2pSigner.connectToChannel(
                        h.channelId
                    )
                ).to.equal(false);
                expect(
                    await observer.p2pInstance.p2pSigner.connectToChannel(
                        Wallet.createRandom().privateKey
                    )
                ).to.equal(false);
            } finally {
                await Promise.all(releases.map((release) => release()));
            }
        });
    });
});
