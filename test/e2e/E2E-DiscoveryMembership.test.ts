import { Status } from "@/types";
import { sleep } from "@/utils";
import { channelIdToDiscoveryKey } from "@/utils/discoveryKey";
import {
    MathTestSession as TestSession,
    MIN_TEST_TIME_CONFIG
} from "@test/harness";
import { expect } from "chai";

/**
 * E2E tests for the discovery keys a runtime observes.
 *
 * Maps to: src/P2PManager.ts (joined discovery keys)
 *          src/evm/signer/LocalP2pSigner.ts (disconnectFromPeers)
 *          src/eventHandlers/EventHandler.ts (handleChannelClose)
 *
 * A close alone only pauses a peer: discovery re-dials every peer that still
 * shares an observed key, so a disconnect must leave the keys first.
 */
describe("E2E: discovery membership", function () {
    it("disconnectFromPeers leaves every discovery key and no peer redials", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: true });
        await h.network.waitForP2PConnections();

        await h.getPeer(0).p2pInstance.p2pSigner.disconnectFromPeers();

        expect(
            await h
                .control(h.peers[0])
                .query.getJoinedDiscoveryKeys()
                .request(),
            "disconnectFromPeers must stop observing every key"
        ).to.deep.equal([]);
        expect(
            await h.control(h.peers[0]).query.getOpenConnectionCount().request()
        ).to.equal(0);

        // Absence oracle: peer 1 still observes the channel key, so it is the
        // side that could dial peer 0 back. Hold one agreement window and
        // require both sides to stay without an open connection.
        await sleep(MIN_TEST_TIME_CONFIG.agreementTime * 1000);
        expect(
            await h
                .control(h.peers[0])
                .query.getOpenConnectionCount()
                .request(),
            "peer 0 must not be redialed after leaving its keys"
        ).to.equal(0);
        expect(
            await h
                .control(h.peers[1])
                .query.getConnectedPeerAddresses()
                .request()
        ).to.not.include(h.peers[0].address);
    });

    it("connectToChannel after disconnectFromPeers re-observes the key and reconnects", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: true });
        await h.network.waitForP2PConnections();
        await h.getPeer(0).p2pInstance.p2pSigner.disconnectFromPeers();

        await h
            .control(h.peers[0])
            .network.connectToChannel(String(h.channelId))
            .request();
        await h.network.waitForP2PConnections();

        expect(
            await h.control(h.peers[0]).query.getJoinedDiscoveryKeys().request()
        ).to.deep.equal([channelIdToDiscoveryKey(String(h.channelId))]);
        expect(
            await h
                .control(h.peers[0])
                .query.getConnectedPeerAddresses()
                .request()
        ).to.include(h.peers[1].address);
    });

    it("disconnectFromPeers on a runtime that observes nothing is a no-op", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });

        expect(
            await h.getPeer(0).p2pInstance.p2pSigner.disconnectFromPeers()
        ).to.equal(undefined);

        expect(
            await h.control(h.peers[0]).query.getJoinedDiscoveryKeys().request()
        ).to.deep.equal([]);
        expect(
            await h.control(h.peers[0]).query.getOpenConnectionCount().request()
        ).to.equal(0);
    });

    it("channel close leaves every discovery key and no peer redials", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: true });
        await h.network.waitForP2PConnections();

        // Ordering oracle: record how many keys are still observed when the
        // close closes the transports. Every participant closes at once here,
        // so no peer is left to redial and the end state alone cannot tell
        // the two orders apart.
        for (const peer of h.peers) {
            await h
                .control(peer)
                .stub.stubRecordDisconnectAllKeyState()
                .request();
        }

        // Drain the channel on chain: the first leave demotes its author to
        // SYNCED, the second empties the snapshot, and the 0-participant
        // snapshot is what drives the close on every peer that observes it.
        await h.transition.participantLeaveStateTransition();
        await h.transition.participantLeaveStateTransition();

        for (const peer of h.peers) {
            const other = h.peers.find(
                (candidate) => candidate.index !== peer.index
            )!;
            await h.event.waitUntilPeerStatus(peer.index, Status.NOT_OPENED, {
                timeoutMessage: `Peer ${peer.index} did not close the channel after the 0-participant snapshot`
            });
            expect(
                await h.control(peer).query.getJoinedDiscoveryKeys().request(),
                `peer ${peer.index} must stop observing every key on close`
            ).to.deep.equal([]);
            expect(
                await h.control(peer).query.getOpenConnectionCount().request(),
                `peer ${peer.index} must close its transports on close`
            ).to.equal(0);
            expect(
                await h
                    .control(peer)
                    .query.isBlacklisted(other.address)
                    .request(),
                `closing the channel must not exclude peer ${other.index}`
            ).to.equal(false);
            expect(
                await h
                    .control(peer)
                    .query.isReconnectBanned(other.address)
                    .request(),
                `closing the channel must not suspend peer ${other.index}`
            ).to.equal(false);
            expect(
                await h
                    .control(peer)
                    .stub.disconnectAllKeyObservations()
                    .request(),
                `peer ${peer.index} must have left every key before closing its transports`
            ).to.deep.equal([0]);
        }

        // Absence oracle: closing without leaving the keys first lets a peer
        // that still observes the channel key dial the other one back. Hold
        // one agreement window and require both sides to stay disconnected.
        await sleep(MIN_TEST_TIME_CONFIG.agreementTime * 1000);
        for (const peer of h.peers) {
            expect(
                await h.control(peer).query.getOpenConnectionCount().request(),
                `peer ${peer.index} must not be redialed after the channel closed`
            ).to.equal(0);
        }
    });
});
