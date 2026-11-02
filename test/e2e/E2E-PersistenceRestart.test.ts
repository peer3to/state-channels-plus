import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// A persistent peer keeps its channel in its own temporary partition; a
// restart disposes its runtime and starts it again with the same key. The
// participant timeout is long enough that no peer times out the restarting one.
const RESTART_TIME_CONFIG = { p2pTime: 30 };

describe("E2E: persistence restart", function () {
    it("a participant restarted mid-channel holds its persisted height at SYNCED before any sync, then participates and the channel continues", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 3, {
            persistentPeers: [2],
            timeConfig: RESTART_TIME_CONFIG
        });
        const heightBeforeRestart = await h
            .control(h.getPeer(2))
            .query.getLatestBlockHeight(forkId)
            .request();

        const restarted = await h.lifecycle.restartPeer(2);
        const query = h.control(restarted).query;

        // not connected yet: the head comes from disk alone, held at SYNCED
        expect(await query.getForkId().request()).to.equal(forkId);
        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            heightBeforeRestart
        );
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);
        expect(restarted.eventSpies.onTurn?.callCount).to.equal(0);

        await h.network.connectPeers([2]);
        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
        await h.transition.advanceState({ count: 3 });

        const hashes = await Promise.all(
            h.peers.map((peer) =>
                h
                    .control(peer)
                    .query.getBlockHashAt(forkId, heightBeforeRestart! + 3)
                    .request()
            )
        );
        expect(hashes[0]).to.not.equal(null);
        expect(new Set(hashes).size).to.equal(1);
    });

    it("a restarted participant with no participant reachable resumes from its persisted head at the sync deadline", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(2, 2, {
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
        });
        const heightBeforeRestart = await h
            .control(h.getPeer(1))
            .query.getLatestBlockHeight(forkId)
            .request();
        await h.getPeer(0).p2pInstance.dispose();

        const restarted = await h.lifecycle.restartPeer(1);
        const query = h.control(restarted).query;
        await h
            .control(restarted)
            .network.connectToChannel(String(h.channelId))
            .request();

        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            heightBeforeRestart
        );
        expect(restarted.eventSpies.onAbort?.callCount).to.equal(0);
    });

    it("a runtime without persistence restarts as a fresh node", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(2, 1);

        const restarted = await h.lifecycle.restartPeer(1);
        const query = h.control(restarted).query;

        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            null
        );
        expect(await query.getStatus().request()).to.not.equal(
            Status.PARTICIPATING
        );
    });
});
