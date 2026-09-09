import { sleep } from "@/utils";
import {
    MathTestSession as TestSession,
    MIN_TEST_TIME_CONFIG
} from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("LocalDiscoveryServer topic lifecycle", function () {
    it("redials an eligible disconnected peer while the topic remains observed and stops after leave", async function () {
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

    it("keeps dialing a reconnect-banned peer and reconnects it once the ban is lifted", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-ban-refuses-every-redial");
        const primaryIndex = h.network.lobbyRoleIndices()[0];
        const primary = h.peers[primaryIndex];
        const other = h.peers[1 - primaryIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        // Counted on the primary, the only side that dials this pair: every
        // handshake it starts after the ban is a dial the ban did not stop.
        await h.control(primary).stub.countInitHandshakeCalls().request();

        try {
            expect(
                await h
                    .control(primary)
                    .network.banReconnect(other.address)
                    .request()
            ).to.equal(true);
            expect(
                await h
                    .control(primary)
                    .network.closePeerTransportByAddress(other.address)
                    .request()
            ).to.equal(true);
            // The ban is admission-only: the dial loop keeps running and every
            // redial it makes is refused when the handshake completes.
            await waitFor(
                async () =>
                    (await h
                        .control(primary)
                        .stub.getInitHandshakeCallCount()
                        .request()) > 0,
                h.event.protocolEventTimeoutMs(),
                100
            );
            await sleep(MIN_TEST_TIME_CONFIG.agreementTime * 1000);
            expect(
                await h
                    .control(primary)
                    .network.getTransportToken(other.address)
                    .request(),
                "a standing ban must refuse every redial at admission"
            ).to.equal(null);
            expect(
                await h
                    .control(primary)
                    .query.isBlacklisted(other.address)
                    .request(),
                "refusing a redial must never escalate to an exclusion"
            ).to.equal(false);

            expect(
                await h
                    .control(primary)
                    .network.allowReconnect(other.address)
                    .request()
            ).to.equal(true);
            // Nothing dials the peer back: the next retry of the loop that
            // never stopped is admitted.
            await waitFor(
                async () =>
                    (await h
                        .control(primary)
                        .network.getTransportToken(other.address)
                        .request()) !== null,
                h.event.protocolEventTimeoutMs(),
                100
            );
        } finally {
            await h
                .control(primary)
                .network.allowReconnect(other.address)
                .request();
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).network.leaveSelectedKey(topic).request()
                )
            );
        }
    });

    it("does not exclude a peer whose refusal closes the transport before the handshake ack", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-refusal-is-not-an-exclusion");
        const primaryIndex = h.network.lobbyRoleIndices()[0];
        const primary = h.peers[primaryIndex];
        const other = h.peers[1 - primaryIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        await h.control(primary).stub.countInitHandshakeCalls().request();

        try {
            // Suspended by the peer that does not own the dial loop, so the
            // primary keeps redialing into a refusal it is never told about.
            expect(
                await h
                    .control(other)
                    .network.banReconnect(primary.address)
                    .request()
            ).to.equal(true);
            expect(
                await h
                    .control(other)
                    .network.closePeerTransportByAddress(primary.address)
                    .request()
            ).to.equal(true);

            await waitFor(
                async () =>
                    (await h
                        .control(primary)
                        .stub.getInitHandshakeCallCount()
                        .request()) > 0,
                h.event.protocolEventTimeoutMs(),
                100
            );
            // The refusal closes before acking, so the redialing peer's ack
            // timeout has nothing to attribute. Hold one full timeout window.
            await sleep(MIN_TEST_TIME_CONFIG.agreementTime * 1000);
            expect(
                await h
                    .control(primary)
                    .query.isBlacklisted(other.address)
                    .request(),
                "a refusal must not become an exclusion on the refused peer"
            ).to.equal(false);
            expect(
                await h
                    .control(other)
                    .query.isBlacklisted(primary.address)
                    .request(),
                "a suspension must not escalate to an exclusion"
            ).to.equal(false);
        } finally {
            await h
                .control(other)
                .network.allowReconnect(primary.address)
                .request();
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).network.leaveSelectedKey(topic).request()
                )
            );
        }
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
