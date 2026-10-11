import { sleep } from "@/utils";
import {
    assertDiscoveryEndpointReplacement,
    holdAcceptedSocketReads,
    stageLocalDiscoveryReady,
    observeDiscoveryLogger,
    observeLocalDialRetries,
    waitForPendingLocalDial
} from "@test/fixtures/node/LocalDiscoveryReadyStaging";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("LocalDiscoveryServer topic lifecycle", function () {
    it("retries the replacement endpoint announced while the old endpoint handshake is pending", async function () {
        await assertDiscoveryEndpointReplacement(
            TestSession.getHarness(),
            true
        );
    });

    it("retries the replacement endpoint announced while the old authenticated transport is still connected", async function () {
        await assertDiscoveryEndpointReplacement(
            TestSession.getHarness(),
            false
        );
    });

    it("closes an accepted socket whose ready frame arrives after manager disposal", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const peer = h.getPeer(0);
        await h
            .control(peer)
            .network.joinSelectedKey(ethers.id("late-ready-after-disposal"))
            .request();
        const { sm } = runtimeEndpointFor(peer.p2pInstance);
        const socket = await stageLocalDiscoveryReady();
        const discoveryLogger = observeDiscoveryLogger();
        try {
            await sm.dispose();
            discoveryLogger.assertActive();
            expect(await socket.sendReady()).to.equal(0);
            expect(sm.p2pManager.openConnections).to.have.length(0);
            await discoveryLogger.cleanup();
            discoveryLogger.assertDisposed();
        } finally {
            socket.dispose();
            await discoveryLogger.cleanup();
        }
    });

    it("schedules no retry for a local dial whose handshake is pending when its runtime shuts down", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        // neither peer answers a handshake challenge -> a dial stays pending
        for (const peer of h.peers)
            await h.rpcStub.stubHandshakeResponse(peer.index, {
                delayMs: 600_000
            });
        const topic = ethers.id("local-dial-pending-at-shutdown");
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        const dialer = await waitForPendingLocalDial(
            h.peers.map(
                (peer) => runtimeEndpointFor(peer.p2pInstance).sm.p2pManager
            )
        );
        const retries = observeLocalDialRetries();

        // the first half of shutdown settles the dial's handshake wait with
        // false while its P2P manager and discovery session are still alive
        await dialer.stateManager.stop();

        expect(dialer.isDisposed).to.equal(false);
        expect(retries.scheduledSince()).to.deep.equal([]);
    });

    it("redials an eligible disconnected peer no sooner than a second later while the topic remains observed and stops after leave", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-redial-until-leave");
        const primaryIndex = h.network.lobbyRoleIndices()[0];
        const otherIndex = 1 - primaryIndex;
        const primary = h.peers[primaryIndex];
        const other = h.peers[otherIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        const firstToken = await h
            .control(primary)
            .network.getTransportToken(other.address)
            .request();
        expect(firstToken).to.be.a("number");

        const closedAt = Date.now();
        expect(
            await h
                .control(primary)
                .network.closePeerTransportByAddress(other.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(primary)
                .query.isBlacklisted(other.address)
                .request()
        ).to.equal(false);
        let replacementToken: number | null = null;
        await waitFor(
            async () => {
                replacementToken = await h
                    .control(primary)
                    .network.getTransportToken(other.address)
                    .request();
                return (
                    replacementToken !== null && replacementToken !== firstToken
                );
            },
            h.event.protocolEventTimeoutMs(),
            200
        );
        expect(replacementToken).to.not.equal(firstToken);
        // the redial waits at least a second after the close, so the
        // replacement cannot exist earlier than that
        expect(Date.now() - closedAt).to.be.at.least(1000);

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.leaveSelectedKey(topic).request()
            )
        );
        expect(
            await h
                .control(primary)
                .network.closePeerTransportByAddress(other.address)
                .request()
        ).to.equal(true);
        await sleep(600);
        expect(
            await h
                .control(primary)
                .network.getTransportToken(other.address)
                .request()
        ).to.equal(null);
        expect(
            await h.control(primary).query.getOpenConnectionCount().request()
        ).to.equal(0);
    });

    it("holds an inbound reconnect inside the cooldown after the previous transport closed and admits it once the cooldown has passed, without blacklisting", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-reconnect-cooldown");
        const dialerIndex = h.network.lobbyRoleIndices()[0];
        const dialer = h.peers[dialerIndex];
        const acceptor = h.peers[1 - dialerIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        const acceptorToken = () =>
            h
                .control(acceptor)
                .network.getTransportToken(dialer.address)
                .request();
        const firstToken = await acceptorToken();
        expect(firstToken).to.be.a("number");

        // the acceptor closes, so its peer server starts the dialer's cooldown now
        const closedAt = Date.now();
        expect(
            await h
                .control(acceptor)
                .network.closePeerTransportByAddress(dialer.address)
                .request()
        ).to.equal(true);
        // a fresh topic observation dials at once, ahead of the redial floor
        await h.control(dialer).network.leaveSelectedKey(topic).request();
        await h.control(dialer).network.joinSelectedKey(topic).request();

        // inside the cooldown the acceptor holds the socket and admits nothing
        while (Date.now() < closedAt + 850) {
            expect(await acceptorToken()).to.equal(null);
            await sleep(100);
        }
        let replacementToken: number | null = null;
        await waitFor(
            async () => {
                replacementToken = await acceptorToken();
                return (
                    replacementToken !== null && replacementToken !== firstToken
                );
            },
            h.event.protocolEventTimeoutMs(),
            100
        );
        expect(Date.now() - closedAt).to.be.at.least(1000);
        for (const [from, to] of [
            [acceptor, dialer],
            [dialer, acceptor]
        ]) {
            expect(
                await h.control(from).query.isBlacklisted(to.address).request(),
                "the held reconnect must not blacklist either side"
            ).to.equal(false);
        }
    });

    it("dials the peer again after a leave and rejoin while the left topic's closed socket has not finished closing", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const topic = ethers.id("local-discovery-rejoin-pending-close");
        const dialer = h.getPeer(h.network.lobbyRoleIndices()[0]);
        const acceptor = h.getPeer(1 - dialer.index);
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        const dialerToken = () =>
            h
                .control(dialer)
                .network.getTransportToken(acceptor.address)
                .request();
        const firstToken = await dialerToken();
        expect(firstToken).to.be.a("number");

        // the acceptor stops reading, so the dialer's old socket stays closing
        const hold = holdAcceptedSocketReads();
        try {
            await h.control(dialer).network.leaveSelectedKey(topic).request();
            expect(
                await h
                    .control(dialer)
                    .network.closePeerTransportByAddress(acceptor.address)
                    .request()
            ).to.equal(true);
            await h.control(dialer).network.joinSelectedKey(topic).request();
            // the rejoined topic dials the announced acceptor on a new socket
            await waitFor(async () => {
                const token = await dialerToken();
                return token !== null && token !== firstToken;
            }, h.event.protocolEventTimeoutMs());
            expect(hold.closingDials()).to.equal(1);
        } finally {
            hold.release();
        }
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.leaveSelectedKey(topic).request()
            )
        );
    });

    it("keeps a rejoined topic's pending dial deduplicated across topics after the left topic's old socket finishes closing", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const topics = [
            ethers.id("local-discovery-rejoin-dedupe-first"),
            ethers.id("local-discovery-rejoin-dedupe-second")
        ];
        const dialer = h.getPeer(h.network.lobbyRoleIndices()[0]);
        const acceptor = h.getPeer(1 - dialer.index);
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topics[0]).request()
            )
        );
        await h.network.waitForP2PConnections();
        const heldCounts = () =>
            Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.getHeldHandshakeCount().request()
                )
            );

        const hold = holdAcceptedSocketReads();
        try {
            for (const peer of h.peers)
                await h.control(peer).stub.holdInitHandshakes().request();
            await h
                .control(dialer)
                .network.leaveSelectedKey(topics[0])
                .request();
            expect(
                await h
                    .control(dialer)
                    .network.closePeerTransportByAddress(acceptor.address)
                    .request()
            ).to.equal(true);
            await h
                .control(dialer)
                .network.joinSelectedKey(topics[0])
                .request();
            // the rejoined dial waits on its held handshake
            await waitFor(async () =>
                (await heldCounts()).every((count) => count === 1)
            );
            // the left topic's old socket now finishes closing
            hold.release();
            await waitFor(() => hold.closingDials() === 0);
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).network.joinSelectedKey(topics[1]).request()
                )
            );
            // Observe repeated discovery announcements while authentication is held.
            await sleep(600);
            expect(await heldCounts()).to.deep.equal([1, 1]);
            expect(
                await h.control(dialer).query.getOpenConnectionCount().request()
            ).to.equal(0);
        } finally {
            hold.release();
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.releaseInitHandshakes().request()
                )
            );
        }
        await h.network.waitForP2PConnections();
        for (const peer of h.peers)
            expect(
                await h.control(peer).query.getOpenConnectionCount().request()
            ).to.equal(1);
        await Promise.all(
            h.peers.flatMap((peer) =>
                topics.map((topic) =>
                    h.control(peer).network.leaveSelectedKey(topic).request()
                )
            )
        );
    });

    it("dials the peer again after a rejoin while the pending dial the leave closed has not finished closing", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const topic = ethers.id("local-discovery-rejoin-pending-dial-close");
        const dialer = h.getPeer(h.network.lobbyRoleIndices()[0]);
        const acceptor = h.getPeer(1 - dialer.index);
        for (const peer of h.peers)
            await h.control(peer).stub.holdInitHandshakes().request();
        let hold: ReturnType<typeof holdAcceptedSocketReads> | undefined;
        try {
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).network.joinSelectedKey(topic).request()
                )
            );
            // the dial is accepted but its handshake is held
            await waitFor(async () =>
                (
                    await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.getHeldHandshakeCount()
                                .request()
                        )
                    )
                ).every((count) => count === 1)
            );
            hold = holdAcceptedSocketReads();
            // the leave closes the pending dial, which stays closing
            await h.control(dialer).network.leaveSelectedKey(topic).request();
            expect(hold.closingDials()).to.equal(1);
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.releaseInitHandshakes().request()
                )
            );
            await h.control(dialer).network.joinSelectedKey(topic).request();
            await waitFor(
                async () =>
                    (await h
                        .control(dialer)
                        .network.getTransportToken(acceptor.address)
                        .request()) !== null,
                h.event.protocolEventTimeoutMs()
            );
            expect(hold.closingDials()).to.equal(1);
        } finally {
            hold?.release();
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.releaseInitHandshakes().request()
                )
            );
        }
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.leaveSelectedKey(topic).request()
            )
        );
    });

    it("does not redial a peer blacklisted before its transport closes", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-blacklist-stops-redial");
        const primaryIndex = h.network.lobbyRoleIndices()[0];
        const otherIndex = 1 - primaryIndex;
        const primary = h.peers[primaryIndex];
        const other = h.peers[otherIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        expect(
            await h
                .control(primary)
                .network.blacklistAndDisconnectPeerByAddress(other.address)
                .request()
        ).to.equal(true);
        await sleep(600);

        expect(
            await h
                .control(primary)
                .query.isBlacklisted(other.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(primary)
                .network.getTransportToken(other.address)
                .request()
        ).to.equal(null);
        expect(
            await h.control(primary).query.getOpenConnectionCount().request()
        ).to.equal(0);
    });

    it("deduplicates an in-flight dial across topics before authentication", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topics = [
            ethers.id("pending-dial-first"),
            ethers.id("pending-dial-second")
        ];
        for (const peer of h.peers)
            await h.control(peer).stub.holdInitHandshakes().request();
        try {
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).network.joinSelectedKey(topics[0]).request()
                )
            );
            await waitFor(async () =>
                (
                    await Promise.all(
                        h.peers.map((peer) =>
                            h
                                .control(peer)
                                .stub.getHeldHandshakeCount()
                                .request()
                        )
                    )
                ).every((count) => count === 1)
            );
            // Neither transport knows the remote signer yet, so only the
            // pending-dial set can suppress a second outbound connection.
            for (const peer of h.peers) {
                expect(
                    await h.execOnHost(
                        peer,
                        (sm) =>
                            sm.p2pManager.openConnections.filter(
                                (transport) =>
                                    transport.peerAddress !== undefined
                            ).length
                    )
                ).to.equal(0);
            }
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).network.joinSelectedKey(topics[1]).request()
                )
            );
            // Observe repeated discovery announcements while authentication is held.
            await sleep(600);
            for (const peer of h.peers) {
                expect(
                    await h.control(peer).stub.getHeldHandshakeCount().request()
                ).to.equal(1);
                expect(
                    await h
                        .control(peer)
                        .query.getOpenConnectionCount()
                        .request()
                ).to.equal(0);
            }
        } finally {
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.releaseInitHandshakes().request()
                )
            );
        }
        await h.network.waitForP2PConnections();
        for (const peer of h.peers)
            expect(
                await h.control(peer).query.getOpenConnectionCount().request()
            ).to.equal(1);
        await Promise.all(
            h.peers.flatMap((peer) =>
                topics.map((topic) =>
                    h.control(peer).network.leaveSelectedKey(topic).request()
                )
            )
        );
    });

    it("does not dial a peer that already has a live authenticated transport on another topic", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const firstTopic = ethers.id("local-discovery-dedupe-first-topic");
        const secondTopic = ethers.id("local-discovery-dedupe-second-topic");
        const primaryIndex = h.network.lobbyRoleIndices()[0];
        const primary = h.peers[primaryIndex];
        const other = h.peers[1 - primaryIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(firstTopic).request()
            )
        );
        await h.network.waitForP2PConnections();
        const firstToken = await h
            .control(primary)
            .network.getTransportToken(other.address)
            .request();
        expect(firstToken).to.be.a("number");

        // A second observed topic announces the same peer again. One live
        // authenticated transport must be reused instead of dialed twice.
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(secondTopic).request()
            )
        );
        await sleep(600);
        expect(
            await h
                .control(primary)
                .network.getTransportToken(other.address)
                .request()
        ).to.equal(firstToken);
        expect(
            await h.control(primary).query.getOpenConnectionCount().request()
        ).to.equal(1);
        expect(
            await h.control(other).query.getOpenConnectionCount().request()
        ).to.equal(1);

        await Promise.all(
            h.peers.flatMap((peer) => [
                h.control(peer).network.leaveSelectedKey(firstTopic).request(),
                h.control(peer).network.leaveSelectedKey(secondTopic).request()
            ])
        );
    });
    it("repeated and concurrent joins share one listener and a pending join can be left", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-shared-join");
        const peer = h.getPeer(0);
        await h.execOnHost(
            peer,
            async (sm, args) => {
                await sm.setChannelId(args.topic);
                await Promise.all([
                    sm.p2pManager.joinDiscoveryKey(args.topic),
                    sm.p2pManager.joinDiscoveryKey(args.topic)
                ]);
                await sm.p2pManager.joinDiscoveryKey(args.topic);
                return true;
            },
            { topic }
        );
        expect(
            await h
                .control(peer)
                .stub.getLocalDiscoveryListenerCount()
                .request()
        ).to.equal(1);
        await h.control(peer).network.leaveSelectedKey(topic).request();
        expect(
            await h
                .control(peer)
                .stub.getLocalDiscoveryListenerCount()
                .request()
        ).to.equal(0);
        await h
            .control(peer)
            .stub.joinAndLeavePendingLocalDiscovery(topic)
            .request();
        expect(
            await h
                .control(peer)
                .stub.getLocalDiscoveryListenerCount()
                .request()
        ).to.equal(0);
        await Promise.all(
            h.peers.map((p) =>
                h.control(p).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        expect(
            await h
                .control(peer)
                .stub.getLocalDiscoveryListenerCount()
                .request()
        ).to.equal(h.getConfig().RUN_SDK_IN_THREAD ? 1 : 2);
    });
});
