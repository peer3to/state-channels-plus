import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

// A persistent peer keeps its channel in its own temporary partition; a
// restart disposes its runtime and starts it again with the same key. The
// participant timeout is long enough that no peer times out the restarting one.
const RESTART_TIME_CONFIG = { p2pTime: 30 };

type Harness = ReturnType<typeof TestSession.getHarness>;

/** the live peers author `count` blocks, each by the peer whose turn it is */
async function authorWhileDown(h: Harness, forkId: ForkId, count: number) {
    const live = h.peers.filter((peer) => peer.index !== 2);
    const query = h.control(live[0]).query;
    for (let index = 0; index < count; index++) {
        const height = await query.getLatestBlockHeight(forkId).request();
        let author: (typeof live)[number] | undefined;
        await waitFor(async () => {
            for (const peer of live) {
                const nextToWrite = await h
                    .control(peer)
                    .query.getNextToWrite()
                    .request();
                if (nextToWrite === peer.address) author = peer;
            }
            return author !== undefined;
        });
        await author!.p2pInstance.p2pContractInstance.add(1);
        await waitFor(async () =>
            (
                await Promise.all(
                    live.map((peer) =>
                        h
                            .control(peer)
                            .query.getLatestBlockHeight(forkId)
                            .request()
                    )
                )
            ).every((latest) => latest === height! + 1)
        );
    }
}

describe("E2E: persistence restart", function () {
    it("a participant restarted mid-channel holds its persisted height at SYNCED and authors nothing before any sync, syncs the blocks made while it was down, then participates and the channel continues", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 3, {
            persistentPeers: [2],
            timeConfig: RESTART_TIME_CONFIG
        });
        const heightBeforeRestart = await h
            .control(h.getPeer(2))
            .query.getLatestBlockHeight(forkId)
            .request();

        // the others author two blocks while peer 2 is down
        await h.getPeer(2).p2pInstance.dispose();
        await authorWhileDown(h, forkId, 2);
        const othersHeight = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request();
        expect(othersHeight).to.equal(heightBeforeRestart! + 2);

        const restarted = await h.lifecycle.restartPeer(2);
        const query = h.control(restarted).query;

        // not connected yet: the head comes from disk alone, held at SYNCED
        expect(await query.getForkId().request()).to.equal(forkId);
        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            heightBeforeRestart
        );
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);
        expect(restarted.eventSpies.onTurn?.callCount).to.equal(0);
        let authoringError: unknown;
        try {
            await h.getPeer(2).p2pInstance.p2pContractInstance.add(1);
        } catch (error) {
            authoringError = error;
        }
        expect(String(authoringError)).to.contain(
            "Restored head waits for the restart sync"
        );

        await h.network.connectPeers([2]);
        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
        await waitFor(
            async () =>
                ((await query.getLatestBlockHeight(forkId).request()) ?? -1) >=
                othersHeight!
        );
        await h.transition.advanceState({ count: 3 });

        const hashes = await Promise.all(
            h.peers.map((peer) =>
                h
                    .control(peer)
                    .query.getBlockHashAt(forkId, othersHeight! + 3)
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

    it("a persistent runtime that set and cleared another channel id binds the channel that opens and resumes it after a restart", async () => {
        const h = TestSession.getHarness();
        await h.setup(2, {
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
        });
        // a failed negotiation attempt's channel id comes and goes first
        expect(
            await h
                .control(h.getPeer(1))
                .stub.setAndClearChannelId(
                    ethers.hexlify(ethers.randomBytes(32))
                )
                .request()
        ).to.equal(true);
        const forkId = await h.lifecycle.openChannel();
        await h.transition.advanceState({ count: 2 });
        const heightBeforeRestart = await h
            .control(h.getPeer(1))
            .query.getLatestBlockHeight(forkId)
            .request();
        expect(heightBeforeRestart).to.not.equal(null);

        const restarted = await h.lifecycle.restartPeer(1);
        const query = h.control(restarted).query;

        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            heightBeforeRestart
        );
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);
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
