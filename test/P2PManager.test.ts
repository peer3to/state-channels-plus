import { SyncResult } from "@/rpc/network/services/spectate/SpectateService";
import { TransportType } from "@/transport";
import { Status } from "@/types";
import { channelIdToTargetedJoinTopic } from "@/utils";

import {
    assertLateSyncResultAfterAbortChangesNothing,
    assertObserverConnectSettlesFalseOnAbort,
    INITIAL_SYNC_DEADLINE_TASK,
    withFreshInitialSyncObserver,
    withInitialDeadlineElapsedDuringHeldChecks
} from "@test/fixtures/AbortDuringInitialSyncStaging";
import {
    PARTICIPANT_CHECK_STUB_FAILURE,
    type SpectateSyncSettle
} from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { runHandshakeFailure } from "@test/fixtures/HandshakeFailureStaging";
import { withObserverOfSyncingParticipant } from "@test/fixtures/MilestoneSyncStaging";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import {
    clientRootFor,
    inlineHostFor
} from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers, Wallet } from "ethers";
import sinon from "sinon";

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

    it("prefers a transport address over its registered profile address", async function () {
        const profileAddress = Wallet.createRandom().address;
        const transportAddress = Wallet.createRandom().address;
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeConnectedPeerPrecedence(
                profileAddress,
                transportAddress
            )
            .request();
        expect(result).to.include(transportAddress);
        expect(result).not.to.include(profileAddress);
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

    it("closes later unpromoted transports and Holepunch after an earlier close fails", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeDisposalFailure()
            .request();
        expect(result).to.deep.equal({
            message: "first transport close failed",
            failedTransportReleased: true,
            firstCloseCalls: 1,
            secondCloseCalls: 1,
            secondClosed: true,
            holepunchDisposed: true,
            samePromise: true
        });
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

    it("original transport retirement keeps its pending request pending on the replacement, whose reply settles it", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeTransportRetirement(fixture!.address(1))
            .request();

        expect(result.isOldRequestPendingOnReplacement).to.equal(true);
        expect(result.oldRequestValue).to.equal("old-settled-by-replacement");
        expect(result.oldConnectionRemoved).to.equal(true);
        expect(result.replacementConnected).to.equal(true);
        expect(result.replacementValue).to.equal("replacement-live");
        expect(result.pendingCount).to.equal(0);
        expect(result.timerCount).to.equal(0);
    });

    it("reports no disconnection when the remote retires the original transport while the replacement stays live, and one when the last transport closes", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeRemoteRetirement(fixture!.address(1))
            .request();

        expect(result).to.deep.equal({
            hookCallsAfterRemoteRetirement: 0,
            hookCallsAfterLastClose: 1
        });
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
        expect(result.missingAddressRecorded).to.equal(true);
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

    it("reports each change of the connection set with its transport types, leaves out a peerless transport, and reports nothing for a repeated add or close", async function () {
        const result = await fixture!
            .control()
            .p2pManagerProbe.probeConnectionsChanged(
                fixture!.address(0),
                fixture!.address(1)
            )
            .request();

        const holepunch = {
            peerAddress: fixture!.address(0),
            transportType: TransportType.HOLEPUNCH
        };
        const webRtc = {
            peerAddress: fixture!.address(1),
            transportType: TransportType.WEBRTC
        };
        expect(result.snapshots).to.deep.equal([
            [holepunch],
            // the peerless transport joined the set but is left out
            [holepunch],
            [holepunch, webRtc],
            [webRtc],
            // the unexpected close of the WebRTC transport
            []
        ]);
        expect(result.openConnections).to.deep.equal([]);
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

        it("initial handshake starts one channel-load sync and reaches SYNCED", async function () {
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
                    h.rpcStub.holdOpenedStatusRefresh(peer.index, "second")
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
                                        .stub.getHeldOpenedStatusRefreshCount()
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

        it("a cancel during the target's opened-status read ends the connect before matching starts", async function () {
            const h = fixture!.getHarness();
            const target = Wallet.createRandom().privateKey;
            const peer = h.getPeer(0);
            const signer = peer.p2pInstance.p2pSigner;
            const release = await h.rpcStub.holdOpenedStatusRefresh(
                peer.index,
                "first"
            );
            try {
                // the timeout only bounds a connect whose cancel was lost
                const pending = signer.connectToChannel(target, {
                    autoOpen: true,
                    timeoutMs: h.event.protocolEventTimeoutMs()
                });
                await waitFor(
                    async () =>
                        (await h
                            .control(peer)
                            .stub.getHeldOpenedStatusRefreshCount()
                            .request()) === 1
                );
                expect(await signer.cancelConnectToChannel(target)).to.equal(
                    true
                );
                await release();
                expect(await pending).to.equal(false);
                const availability = await h
                    .control(peer)
                    .query.getLobbyAvailability()
                    .request();
                expect(availability).to.include({
                    matching: false,
                    topicJoined: false
                });
                expect(availability.topic).to.equal(undefined);
            } finally {
                await release();
            }
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
            // Neither peer blacklisted the other.
            expect(
                await Promise.all([
                    h
                        .control(h.getPeer(0))
                        .query.isBlacklisted(h.getPeer(1).address)
                        .request(),
                    h
                        .control(h.getPeer(1))
                        .query.isBlacklisted(h.getPeer(0).address)
                        .request()
                ])
            ).to.deep.equal([false, false]);
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

        it("fatal initial sync closes its root and rejects later same-channel client calls", async function () {
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
            const host = clientRootFor(
                observer.p2pInstance
            ).p2pRuntimeHostRemoteRoot!;
            const releases = await Promise.all(
                [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
            );
            try {
                expect(
                    await observer.p2pInstance.p2pSigner.connectToChannel(
                        h.channelId
                    )
                ).to.equal(false);
                await waitFor(
                    () => host.isClosed,
                    h.event.protocolEventTimeoutMs()
                );
                await expect(
                    observer.p2pInstance.p2pSigner.connectToChannel(h.channelId)
                ).to.be.rejected;
            } finally {
                await Promise.all(releases.map((release) => release()));
            }
        });

        it("observer initial sync request to a participant that never answers times out after two agreement windows", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const observerIndex = observer.index;
                const releases = await Promise.all(
                    [0, 1].map((index) =>
                        h.rpcStub.holdSpectateResponses(index)
                    )
                );
                // The false result is parked until it is read: it aborts the host.
                const restoreSyncRecorder = await h.rpcStub.recordSpectateSync(
                    observerIndex,
                    { forward: true, holdResults: true }
                );
                let isRecorderRestored = false;
                try {
                    const connect =
                        observer.p2pInstance.p2pSigner.connectToChannel(
                            h.channelId
                        );
                    // The first sync call is the initial one; later calls
                    // (queue-timeout probes) share its in-flight request.
                    let settle: SpectateSyncSettle | undefined;
                    await waitFor(async () => {
                        settle = (
                            await h.rpcStub.spectateSyncSettles(observerIndex)
                        ).find((entry) => entry.callNumber === 1);
                        return settle !== undefined;
                    }, h.event.protocolEventTimeoutMs());
                    expect(settle!.result).to.equal(SyncResult.Failed);
                    // The request got the two-window default (one window is 2s).
                    expect(settle!.requestTimeoutMs).to.equal(2 * 2 * 1000);
                    // It ran into that timeout: a one-window bound ends before 3s.
                    expect(
                        settle!.settledAt - settle!.startedAt
                    ).to.be.greaterThan(1.5 * 2 * 1000);
                    await restoreSyncRecorder();
                    isRecorderRestored = true;
                    expect(await connect).to.equal(false);
                } finally {
                    if (!isRecorderRestored) await restoreSyncRecorder();
                    await Promise.all(releases.map((release) => release()));
                }
            });
        });

        it("observer holds the initial deadline while a still-syncing answer is in flight, restarts it on that participant's first still-syncing answer only, and aborts at the restarted deadline", async function () {
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
            await withObserverOfSyncingParticipant(
                h,
                async ({ observer, responder }) => {
                    const observerIndex = observer.index;
                    // The first answer is parked after it is recorded: from
                    // the observer's side its request is still running.
                    const restoreSyncRecorder =
                        await h.rpcStub.recordSpectateSync(observerIndex, {
                            forward: true,
                            holdResults: true
                        });
                    // recorded under the hold: running the held deadline
                    // restores scheduling to the recorder
                    const schedules =
                        await h.rpcStub.recordScheduledTasks(observerIndex);
                    const deadline = await h.rpcStub.holdScheduledTasks(
                        observerIndex,
                        INITIAL_SYNC_DEADLINE_TASK
                    );
                    let isDeadlineHeld = true;
                    let isRecorderRestored = false;
                    try {
                        const connect =
                            observer.p2pInstance.p2pSigner.connectToChannel(
                                h.channelId
                            );
                        let settles: SpectateSyncSettle[] = [];
                        await waitFor(async () => {
                            settles =
                                await h.rpcStub.spectateSyncSettles(
                                    observerIndex
                                );
                            return (
                                settles.length === 1 &&
                                (await deadline.heldCount()) === 1
                            );
                        }, h.event.protocolEventTimeoutMs());
                        expect(settles[0].result).to.equal(
                            SyncResult.ResponderSyncing
                        );
                        // the request keeps its own two-window timeout
                        expect(settles[0].requestTimeoutMs).to.equal(
                            2 * 2 * 1000
                        );

                        // The deadline ends while that request runs: it is
                        // held, no abort.
                        expect(await deadline.runHeld()).to.deep.equal({
                            ran: 1,
                            errors: []
                        });
                        isDeadlineHeld = false;
                        expect(
                            await h.execOnHost(observer, async (sm) =>
                                Boolean(sm.isDisposed)
                            )
                        ).to.equal(false);
                        expect(
                            await h
                                .control(observer)
                                .query.getStatus()
                                .request()
                        ).to.equal(Status.OPENED);
                        expect(
                            observer.eventSpies.onAbort?.called ?? false
                        ).to.equal(false);

                        // The first still-syncing answer lands: it restarts
                        // the two-window deadline. Re-recording releases it
                        // and keeps recording the re-asks unparked.
                        await h.rpcStub.recordSpectateSync(observerIndex, {
                            forward: true
                        });
                        // two later answers: the second re-ask is scheduled
                        // only once the first later answer was handled
                        await waitFor(async () => {
                            settles =
                                await h.rpcStub.spectateSyncSettles(
                                    observerIndex
                                );
                            return settles.length >= 2;
                        }, h.event.protocolEventTimeoutMs());
                        expect(
                            settles.every(
                                (settle) =>
                                    settle.result ===
                                    SyncResult.ResponderSyncing
                            )
                        ).to.equal(true);
                        // later answers from the same participant do not
                        // restart it
                        expect(
                            (await schedules.tasks())
                                .filter(
                                    (task) =>
                                        task.taskName ===
                                        INITIAL_SYNC_DEADLINE_TASK
                                )
                                .map((task) => task.delayMs)
                        ).to.deep.equal([2 * 2 * 1000]);
                        const query = h.control(observer).query;
                        expect(
                            await query
                                .isConnectedTo(responder.address)
                                .request()
                        ).to.equal(true);
                        expect(
                            await query.getStrikes(responder.address).request()
                        ).to.equal(0);
                        // The restarted deadline aborts the observer; its
                        // disposal ends the control port, so restore first.
                        await schedules.restore();
                        await restoreSyncRecorder();
                        isRecorderRestored = true;
                        expect(await connect).to.equal(false);
                        expect(observer.eventSpies.onAbort?.called).to.equal(
                            true
                        );
                        expect(
                            h.event.getEventCallCount(
                                observerIndex,
                                "onSetState"
                            )
                        ).to.equal(0);
                    } finally {
                        if (isDeadlineHeld) await deadline.release(false);
                        if (!isRecorderRestored) {
                            await schedules.restore();
                            await restoreSyncRecorder();
                        }
                    }
                }
            );
        });

        it("observer connect resolves false when no participant handshake completes within the initial window", async function () {
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
            const host = clientRootFor(
                observer.p2pInstance
            ).p2pRuntimeHostRemoteRoot!;
            // Block handshake initiation on every runtime so the observer never
            // reaches a participant sync request; the pre-request bound must
            // settle the connect the way a timed-out sync request would.
            await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .stub.stubBlockHandshakeAndRecordSpectateGuard()
                        .request()
                )
            );
            try {
                const startedAt = Date.now();
                expect(
                    await observer.p2pInstance.p2pSigner.connectToChannel(
                        h.channelId
                    )
                ).to.equal(false);
                const elapsedMs = Date.now() - startedAt;
                expect(elapsedMs).to.be.greaterThan(2 * 2 * 1000 - 500);
                expect(elapsedMs).to.be.lessThan(2 * 2 * 1000 + 6000);
                await waitFor(
                    () => host.isClosed,
                    h.event.protocolEventTimeoutMs()
                );
            } finally {
                await Promise.all(
                    h.peers
                        .filter((peer) => peer.index !== observerIndex)
                        .map((peer) =>
                            h
                                .control(peer)
                                .stub.restoreBlockedHandshake()
                                .request()
                        )
                );
            }
        });

        it("observer holds the initial deadline while a completed handshake's participant check runs and syncs once the check answers participant", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const observerIndex = observer.index;
                const restoreSyncRecorder = await h.rpcStub.recordSpectateSync(
                    observerIndex,
                    { forward: true }
                );
                try {
                    await withInitialDeadlineElapsedDuringHeldChecks(
                        h,
                        observer,
                        {},
                        async ({ connect, releaseChecks }) => {
                            expect(
                                await h.execOnHost(observer, async (sm) =>
                                    Boolean(sm.isDisposed)
                                )
                            ).to.equal(false);
                            expect(
                                await h
                                    .control(observer)
                                    .query.getStatus()
                                    .request()
                            ).to.equal(Status.OPENED);
                            expect(
                                await h.rpcStub.spectateSyncCallCount(
                                    observerIndex
                                )
                            ).to.equal(0);
                            await releaseChecks("chain");
                            expect(await connect).to.equal(true);
                            expect(
                                await h.rpcStub.spectateSyncCallCount(
                                    observerIndex
                                )
                            ).to.equal(1);
                            expect(
                                await h
                                    .control(observer)
                                    .query.getStatus()
                                    .request()
                            ).to.equal(Status.SYNCED);
                        }
                    );
                } finally {
                    await restoreSyncRecorder();
                }
            });
        });

        it("observer aborts once a held participant check ends without a sync after the initial deadline elapsed", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const host = clientRootFor(
                    observer.p2pInstance
                ).p2pRuntimeHostRemoteRoot!;
                await withInitialDeadlineElapsedDuringHeldChecks(
                    h,
                    observer,
                    {},
                    async ({ connect, releaseChecks }) => {
                        expect(
                            await h
                                .control(observer)
                                .query.getStatus()
                                .request()
                        ).to.equal(Status.OPENED);
                        // The check answers "not a participant": no sync starts, so
                        // the held deadline fires when the check ends.
                        await releaseChecks("notParticipant");
                        await waitFor(
                            () => host.isClosed,
                            h.event.protocolEventTimeoutMs()
                        );
                        expect(await connect).to.equal(false);
                    }
                );
            });
        });

        it("observer aborts and keeps the error log once a held participant check rejects after the initial deadline elapsed", async function () {
            await fixture!.cleanup();
            fixture = new P2PManagerFixture();
            await fixture.setup({
                inlineHosts: true,
                timeConfig: {
                    agreementTime: 2,
                    p2pTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 2
                }
            });
            const h = fixture.getHarness();
            await withFreshInitialSyncObserver(h, async (observer) => {
                // The inline host's P2PManager: its error lines are read after the abort.
                const errorLog = sinon.spy(
                    inlineHostFor(observer.p2pInstance).hostRpc.requireManager()
                        .logger,
                    "error"
                );
                const host = clientRootFor(
                    observer.p2pInstance
                ).p2pRuntimeHostRemoteRoot!;
                try {
                    await withInitialDeadlineElapsedDuringHeldChecks(
                        h,
                        observer,
                        {},
                        async ({ connect, releaseChecks }) => {
                            expect(
                                await h
                                    .control(observer)
                                    .query.getStatus()
                                    .request()
                            ).to.equal(Status.OPENED);
                            const rejected = await releaseChecks("throw");
                            await waitFor(
                                () => host.isClosed,
                                h.event.protocolEventTimeoutMs()
                            );
                            expect(await connect).to.equal(false);
                            // Each rejected check is rethrown as a fatal handshake failure.
                            await TestSession.expectFirstDetachedError({
                                includes: PARTICIPANT_CHECK_STUB_FAILURE,
                                timeoutMs: h.event.protocolEventTimeoutMs()
                            });
                            expect(
                                errorLog
                                    .getCalls()
                                    .filter(
                                        (call) =>
                                            call.args[0] ===
                                            "Participant read or sync after handshake failed"
                                    )
                                    .map(
                                        (call) =>
                                            (call.args[1] as { error: string })
                                                .error
                                    )
                            ).to.deep.equal(
                                Array.from(
                                    { length: rejected },
                                    () => PARTICIPANT_CHECK_STUB_FAILURE
                                )
                            );
                        }
                    );
                } finally {
                    errorLog.restore();
                }
            });
        });

        it("observer holds the initial deadline until the last of two participant checks ends without a sync", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const host = clientRootFor(
                    observer.p2pInstance
                ).p2pRuntimeHostRemoteRoot!;
                const stub = h.control(observer).stub;
                h.event.resetEventSpies(observer.index);
                // Both participants completed a handshake; both checks are held.
                await withInitialDeadlineElapsedDuringHeldChecks(
                    h,
                    observer,
                    { heldChecks: 2 },
                    async ({ connect, releaseChecks }) => {
                        expect(
                            await stub
                                .releaseOneParticipantCheck("notParticipant")
                                .request()
                        ).to.equal(true);
                        // The connection hook runs after the first check's own end.
                        await h.event.waitForEventCounts("onConnection", [
                            { peerId: observer.index, expectedCount: 1 }
                        ]);
                        // The other check still runs: the deadline stays held.
                        expect(
                            await h.execOnHost(observer, async (sm) =>
                                Boolean(sm.isDisposed)
                            )
                        ).to.equal(false);
                        expect(
                            await h
                                .control(observer)
                                .query.getStatus()
                                .request()
                        ).to.equal(Status.OPENED);
                        // The other check was released alone above: one is still parked.
                        expect(await releaseChecks("notParticipant")).to.equal(
                            1
                        );
                        await waitFor(
                            () => host.isClosed,
                            h.event.protocolEventTimeoutMs()
                        );
                        expect(await connect).to.equal(false);
                    }
                );
            });
        });

        it("observer aborts once its held participant checks end on closed transports after the initial deadline elapsed", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const host = clientRootFor(
                    observer.p2pInstance
                ).p2pRuntimeHostRemoteRoot!;
                await withInitialDeadlineElapsedDuringHeldChecks(
                    h,
                    observer,
                    {},
                    async ({ connect, releaseChecks }) => {
                        // Every checked transport closes while its check is held.
                        for (const peer of h.peers.slice(0, 2)) {
                            expect(
                                await h
                                    .control(observer)
                                    .network.blacklistAndDisconnectPeerByAddress(
                                        peer.address
                                    )
                                    .request()
                            ).to.equal(true);
                        }
                        await waitFor(
                            async () =>
                                (
                                    await h
                                        .control(observer)
                                        .query.getConnectedPeerAddresses()
                                        .request()
                                ).length === 0,
                            h.event.protocolEventTimeoutMs()
                        );
                        expect(
                            await h
                                .control(observer)
                                .query.getStatus()
                                .request()
                        ).to.equal(Status.OPENED);
                        // The checks answer "participant", but their transports are
                        // closed: no sync starts, and the last check's end aborts.
                        await releaseChecks("chain");
                        await waitFor(
                            () => host.isClosed,
                            h.event.protocolEventTimeoutMs()
                        );
                        expect(await connect).to.equal(false);
                    }
                );
            });
        });

        it("observer connect resolves true when chain genesis lands before any participant handshake", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const observerIndex = observer.index;
                // No participant handshake can start, so the only way the wait can
                // settle is the chain genesis applied through the real event path.
                await Promise.all(
                    h.peers.map((peer) =>
                        h
                            .control(peer)
                            .stub.stubBlockHandshakeAndRecordSpectateGuard()
                            .request()
                    )
                );
                const restoreSyncRecorder = await h.rpcStub.recordSpectateSync(
                    observerIndex,
                    { forward: true }
                );
                try {
                    const connect =
                        observer.p2pInstance.p2pSigner.connectToChannel(
                            h.channelId
                        );
                    await h.event.waitUntilPeerStatus(
                        observerIndex,
                        Status.OPENED
                    );
                    expect(
                        await h.lifecycle.applyChannelOpenedEvent(observerIndex)
                    ).to.equal(true);
                    expect(await connect).to.equal(true);
                    expect(
                        await h.control(observer).query.getStatus().request()
                    ).to.equal(Status.SYNCED);
                    expect(
                        await h.rpcStub.spectateSyncCallCount(observerIndex)
                    ).to.equal(0);
                    expect(
                        await h.execOnHost(observer, async (sm) =>
                            Boolean(sm.isDisposed)
                        )
                    ).to.equal(false);
                } finally {
                    await restoreSyncRecorder();
                    await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.restoreBlockedHandshake()
                                .request()
                        )
                    );
                }
            });
        });

        it("observer cancels the initial deadline when chain genesis settles the wait and stays synced if it still runs", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const observerIndex = observer.index;
                await Promise.all(
                    h.peers.map((peer) =>
                        h
                            .control(peer)
                            .stub.stubBlockHandshakeAndRecordSpectateGuard()
                            .request()
                    )
                );
                const deadline = await h.rpcStub.holdScheduledTasks(
                    observerIndex,
                    INITIAL_SYNC_DEADLINE_TASK
                );
                let isDeadlineRun = false;
                try {
                    const connect =
                        observer.p2pInstance.p2pSigner.connectToChannel(
                            h.channelId
                        );
                    await waitFor(
                        async () => (await deadline.heldCount()) === 1,
                        h.event.protocolEventTimeoutMs()
                    );
                    await h.lifecycle.applyChannelOpenedEvent(observerIndex);
                    expect(await connect).to.equal(true);
                    // The settle cancelled the pre-request deadline.
                    expect(await deadline.cancelledCount()).to.equal(1);
                    // A deadline that still runs after the settle must not abort.
                    isDeadlineRun = true;
                    expect(await deadline.runHeld()).to.deep.equal({
                        ran: 1,
                        errors: []
                    });
                    expect(
                        await h.control(observer).query.getStatus().request()
                    ).to.equal(Status.SYNCED);
                    expect(
                        await h.execOnHost(observer, async (sm) =>
                            Boolean(sm.isDisposed)
                        )
                    ).to.equal(false);
                } finally {
                    if (!isDeadlineRun) await deadline.release(false);
                    await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.restoreBlockedHandshake()
                                .request()
                        )
                    );
                }
            });
        });

        it("observer ignores a stale false sync result once chain genesis already synced it", async function () {
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
            await withFreshInitialSyncObserver(h, async (observer) => {
                const observerIndex = observer.index;
                // Participants accept the handshake but never answer the sync
                // request, so the observer's request times out as false after two
                // agreement windows. Genesis from the chain lands first.
                const releases = await Promise.all(
                    [0, 1].map((index) =>
                        h.rpcStub.holdSpectateResponses(index)
                    )
                );
                const restoreSyncRecorder = await h.rpcStub.recordSpectateSync(
                    observerIndex,
                    { forward: true }
                );
                try {
                    const connect =
                        observer.p2pInstance.p2pSigner.connectToChannel(
                            h.channelId
                        );
                    await waitFor(
                        async () =>
                            (await h.rpcStub.spectateSyncCallCount(
                                observerIndex
                            )) === 1,
                        h.event.protocolEventTimeoutMs()
                    );
                    await h.lifecycle.applyChannelOpenedEvent(observerIndex);
                    expect(await connect).to.equal(true);
                    // The held request runs into its two-window timeout; the
                    // false result is handled in the same turn it settles.
                    let settle: SpectateSyncSettle | undefined;
                    await waitFor(async () => {
                        settle = (
                            await h.rpcStub.spectateSyncSettles(observerIndex)
                        ).find((entry) => entry.callNumber === 1);
                        return settle !== undefined;
                    }, h.event.protocolEventTimeoutMs());
                    expect(settle!.result).to.equal(SyncResult.Failed);
                    expect(
                        await h.control(observer).query.getStatus().request()
                    ).to.equal(Status.SYNCED);
                    expect(
                        await h.execOnHost(observer, async (sm) =>
                            Boolean(sm.isDisposed)
                        )
                    ).to.equal(false);
                } finally {
                    await restoreSyncRecorder();
                    await Promise.all(releases.map((release) => release()));
                }
            });
        });

        it("observer connect resolves false when the runtime aborts while the initial wait is armed", async function () {
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
            try {
                await assertObserverConnectSettlesFalseOnAbort(h, {
                    // Settled by the abort, well inside the two-window deadline.
                    settledWithinMs: 2 * 2 * 1000,
                    // participants never answer the handshake, so the connect
                    // parks on the armed initial wait
                    stage: async () => {
                        await Promise.all(
                            h.peers.map((peer) =>
                                h
                                    .control(peer)
                                    .stub.stubBlockHandshakeAndRecordSpectateGuard()
                                    .request()
                            )
                        );
                    }
                });
            } finally {
                await Promise.all(
                    h.peers
                        .filter((peer) => peer.index !== h.peers.length - 1)
                        .map((peer) =>
                            h
                                .control(peer)
                                .stub.restoreBlockedHandshake()
                                .request()
                        )
                );
            }
        });

        it("observer connect resolves false when the runtime aborts during the discovery join", async function () {
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
            // the join is held longer than the whole abort sequence, so the
            // abort lands while the connect handler is still inside it and
            // the answer must come from the abort, not from the held join
            const holdMs = 3000;
            await assertObserverConnectSettlesFalseOnAbort(
                fixture.getHarness(),
                {
                    settledWithinMs: holdMs,
                    stage: (observer) =>
                        fixture!
                            .getHarness()
                            .control(observer)
                            .stub.stubHoldDiscoveryJoin(holdMs)
                            .request()
                            .then(() => undefined)
                }
            );
        });

        it("observer connect resolves false when the runtime aborts during the pre-join chain read", async function () {
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
            // connect reads the opened status twice before it joins discovery;
            // parking the second read lets the abort land between OPENED and
            // the join, and the timer frees the read after the abort
            const holdMs = 1000;
            await assertObserverConnectSettlesFalseOnAbort(
                fixture.getHarness(),
                {
                    settledWithinMs: 2 * 2 * 1000,
                    stage: (observer) =>
                        fixture!
                            .getHarness()
                            .control(observer)
                            .stub.holdOpenedStatusRefresh("second", holdMs)
                            .request()
                            .then(() => undefined)
                }
            );
        });

        it("a late sync success after the abort changes nothing", async function () {
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
            await assertLateSyncResultAfterAbortChangesNothing(
                fixture.getHarness(),
                "success"
            );
        });

        it("a late sync failure after the abort changes nothing", async function () {
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
            await assertLateSyncResultAfterAbortChangesNothing(
                fixture.getHarness(),
                "failure"
            );
        });
    });
});

// ethers' refusal of an eth_call on the runtime's closed chain provider
const CLOSED_PROVIDER_CHAIN_READ =
    /^provider destroyed; cancelled request \(operation="eth_call", code=UNSUPPORTED_OPERATION,/;
// the same refusal of the head read that applying a sync response starts with
const CLOSED_PROVIDER_HEAD_READ =
    /^provider destroyed; cancelled request \(operation="eth_blockNumber", code=UNSUPPORTED_OPERATION,/;

describe("P2PManager handshake chain failures", function () {
    it("reports a failed participant read after an OPENED handshake to the runtime's top-level error handling, with no connection hook", async function () {
        const result = await runHandshakeFailure("read");

        expect(result.hostErrors).to.have.length(1);
        expect(result.hostErrors[0].message).to.match(
            CLOSED_PROVIDER_CHAIN_READ
        );
        expect(result.hookCount).to.equal(0);
        expect(result.aborted).to.equal(false);
    });

    it("reports a throwing sync after an OPENED handshake to the runtime's top-level error handling, with no connection hook", async function () {
        const result = await runHandshakeFailure("sync");

        expect(result.hostErrors).to.have.length(1);
        expect(result.hostErrors[0].message).to.match(
            CLOSED_PROVIDER_HEAD_READ
        );
        expect(result.hookCount).to.equal(0);
        expect(result.aborted).to.equal(false);
    });

    it("drops a participant read that fails during runtime teardown: no error, no connection hook", async function () {
        const result = await runHandshakeFailure("teardown");

        expect(result.hostErrors).to.deep.equal([]);
        expect(result.hookCount).to.equal(0);
        expect(result.aborted).to.equal(true);
    });
});
