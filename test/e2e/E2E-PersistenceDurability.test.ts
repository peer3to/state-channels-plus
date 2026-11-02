import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// Every peer persists, each in its own partition. The next writer's disk
// fails every batch a flush waits for, so the flush after it signs its block
// fails; the participant timeout is long enough that nobody times it out.
const DURABILITY_TIME_CONFIG = { p2pTime: 30 };

type Harness = ReturnType<typeof TestSession.getHarness>;

/** the next writer signs a block its disk cannot confirm and aborts */
async function failNextWritersFlush(h: Harness) {
    const forkId = h.activeForkId!;
    const author = h.getPeer((await h.query.getNextPeerToWrite()).index);
    const observers = h.peers.filter((peer) => peer.index !== author.index);
    const height = await h
        .control(observers[0])
        .query.getNextBlockHeight(forkId)
        .request();
    expect(
        await h.control(author).stub.failPersistenceFlushes().request()
    ).to.equal(true);

    let transactionError: unknown;
    try {
        await author.p2pInstance.p2pContractInstance.add(1);
    } catch (error) {
        transactionError = error;
    }
    await waitFor(() => author.eventSpies.onAbort!.callCount > 0);
    return { forkId, author, observers, height, transactionError };
}

describe("E2E: persistence durability", function () {
    it("a failed flush keeps the signed block from every peer, aborts the runtime and blacklists no peer", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, {
            persistentPeers: [0, 1, 2],
            timeConfig: DURABILITY_TIME_CONFIG
        });

        const { forkId, author, observers, height, transactionError } =
            await failNextWritersFlush(h);

        expect(transactionError).to.not.equal(undefined);
        for (const observer of observers) {
            const query = h.control(observer).query;
            expect(
                await query.getBlockHashAt(forkId, height).request(),
                `peer ${observer.index} holds the unflushed block`
            ).to.equal(null);
            expect(
                await query.isBlacklisted(author.address).request(),
                `peer ${observer.index} blacklisted the author`
            ).to.equal(false);
        }
    });

    it("a node restarted after a failed flush of its signed block authors that height again and the channel advances", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, {
            persistentPeers: [0, 1, 2],
            timeConfig: DURABILITY_TIME_CONFIG
        });
        const { forkId, author, height } = await failNextWritersFlush(h);

        await h.lifecycle.restartPeer(author.index);
        await h.network.connectPeers([author.index]);
        await h.network.waitForP2PConnections();
        await h.transition.advanceState({ count: 2 });

        const hashes = await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).query.getBlockHashAt(forkId, height).request()
            )
        );
        expect(hashes[0]).to.not.equal(null);
        expect(new Set(hashes).size).to.equal(1);
        for (const peer of h.peers) {
            expect(
                await h
                    .control(peer)
                    .query.isBlacklisted(author.address)
                    .request()
            ).to.equal(false);
        }
    });
});
