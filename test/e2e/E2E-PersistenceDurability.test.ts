import { Status } from "@/types";
import { sleep } from "@/utils";
import {
    failNextWritersFlush,
    holdFlushes,
    leavePendingWrite
} from "@test/fixtures/PersistenceRestartStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// the absence window: a signature sent without waiting for its held flush
// reaches the peer well within it
const ABSENCE_WINDOW_MS = 500;

describe("E2E: persistence durability", function () {
    it("a failed flush keeps the signed block from every peer, aborts the runtime and blacklists no peer", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, {
            persistentPeers: [0, 1, 2]
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

    it("an authored block reaches no peer until the author's disk confirms it, and a confirmation of it reaches no peer until the confirmer's disk confirms it", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 1, {
            persistentPeers: [0, 1, 2]
        });
        const author = h.getPeer((await h.query.getNextPeerToWrite()).index);
        const [confirmer, observer] = h.peers.filter(
            (peer) => peer.index !== author.index
        );
        const height = (await h
            .control(observer)
            .query.getNextBlockHeight(forkId)
            .request())!;
        const authorGate = await holdFlushes(h, author);
        const confirmerGate = await holdFlushes(h, confirmer);
        expect([authorGate.bound, confirmerGate.bound]).to.deep.equal([
            true,
            true
        ]);

        const adding = author.p2pInstance.p2pContractInstance.add(1);
        await authorGate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        for (const peer of [confirmer, observer]) {
            expect(
                await h
                    .control(peer)
                    .query.getBlockHashAt(forkId, height)
                    .request(),
                `peer ${peer.index} holds the unconfirmed block`
            ).to.equal(null);
        }

        await authorGate.release();
        await confirmerGate.waitUntilHeld();
        const signersAt = async (peer: typeof author) =>
            (
                await h
                    .control(peer)
                    .query.getBlockByHeight(forkId, height)
                    .request()
            )?.confirmationSignerAddresses ?? [];
        await waitFor(async () =>
            (await signersAt(observer)).includes(observer.address)
        );
        await sleep(ABSENCE_WINDOW_MS);
        for (const peer of [author, observer]) {
            expect(
                await signersAt(peer),
                `peer ${peer.index} holds the unconfirmed confirmation`
            ).to.not.include(confirmer.address);
        }

        await confirmerGate.release();
        await adding;
        await waitFor(async () =>
            (await Promise.all([author, observer].map(signersAt))).every(
                (signers) => signers.includes(confirmer.address)
            )
        );
    });

    it("a signed dispute is not sent to the chain until its write is confirmed", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 1, {
            persistentPeers: [1]
        });
        const disputer = h.getPeer(1);
        const observer = h.control(h.getPeer(0)).query;
        // the upload is called for real: only the chain gate holds it back
        const submissions = await h.rpcStub.recordDisputeSubmissions(
            disputer.index,
            { forward: true }
        );
        const gate = await holdFlushes(h, disputer);

        const disputing = h.execOnHost(
            disputer,
            (sm, args) => sm.disputeManager.dispute(args.forkId),
            { forkId },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        await gate.waitUntilHeld();
        await waitFor(async () => (await submissions.submissions()).length > 0);
        await sleep(ABSENCE_WINDOW_MS);
        expect(
            await observer.getDisputeWindowCommitments(forkId).request()
        ).to.deep.equal([]);

        await gate.release();
        await disputing;
        await waitFor(
            async () =>
                (await observer.getDisputeWindowCommitments(forkId).request())
                    .length > 0
        );
        await submissions.restore();
    });

    it("a seated joiner turns PARTICIPATING only once the flush after it signs its promoting block is confirmed", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, { persistentPeers: [2] });
        const joiner = h.getPeer((await h.join.addSpectatorWait()).index);
        await h.join.joinChannelWait({ joiner });
        await h.event.waitUntilPeerStatus(
            joiner.index,
            Status.PENDING_PARTICIPANT
        );
        const gate = await holdFlushes(h, joiner);
        expect(gate.bound).to.equal(true);

        // a pending joiner signs nothing until the block that seats it
        for (let block = 0; block < 4 && (await gate.held()) === 0; block++)
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
        await gate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );

        await gate.release();
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);
    });

    it("a spectator signs nothing, so a disk that confirms no write never stops it from following the channel", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1, {
            persistentPeers: [2]
        });
        const { peer: spectator } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 1,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        const gate = await holdFlushes(h, h.getPeer(spectator.index));
        expect(gate.bound).to.equal(true);

        await h.transition.increment(1, {
            waitForPeers: [0, 1, spectator.index]
        });
        await h.transition.increment(1, {
            waitForPeers: [0, 1, spectator.index]
        });

        const forkId = h.activeForkId!;
        const height = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request();
        expect(
            await h
                .control(spectator)
                .query.getLatestBlockHeight(forkId)
                .request()
        ).to.equal(height);
        expect(await gate.held()).to.be.greaterThan(0);
        expect(spectator.eventSpies.onAbort?.callCount ?? 0).to.equal(0);
        await gate.release();
    });

    it("a spectator gets no sync answer from participants whose disks have not confirmed their writes, and syncs once they have", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1, {
            persistentPeers: [0, 1]
        });
        const participants = [h.getPeer(0), h.getPeer(1)];
        const gates = [];
        for (const participant of participants) {
            const gate = await holdFlushes(h, participant);
            expect(gate.bound).to.equal(true);
            await leavePendingWrite(h, participant);
            await gate.waitUntilHeld();
            gates.push(gate);
        }

        const spectator = h.getPeer((await h.join.addSpectator()).index);
        await sleep(ABSENCE_WINDOW_MS);
        expect(
            await h.control(spectator).query.getStatus().request()
        ).to.not.equal(Status.SYNCED);

        for (const gate of gates) await gate.release();
        await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
        await h.transition.increment(1, {
            waitForPeers: [0, 1, spectator.index]
        });
    });

    it("a snapshot post leaves for the chain only once the poster's disk confirms the writes made before it", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, {
            persistentPeers: [0]
        });
        const poster = h.getPeer(0);
        const before = await h.query.getOnChainSnapshotHash();
        const gate = await holdFlushes(h, poster);
        expect(gate.bound).to.equal(true);
        await leavePendingWrite(h, poster);
        await gate.waitUntilHeld();

        const posting = h.transition.postSnapshot({ peerIndex: 0 });
        await sleep(ABSENCE_WINDOW_MS);
        expect(await h.query.getOnChainSnapshotHash()).to.equal(before);

        await gate.release();
        const posted = await posting;
        expect(posted).to.not.equal(undefined);
        expect(await h.query.getOnChainSnapshotHash()).to.equal(posted!.hash);
    });

    it("a node restarted after a failed flush of its signed block authors that height again and the channel advances", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, {
            persistentPeers: [0, 1, 2]
        });
        const { forkId, author, height } = await failNextWritersFlush(h);

        const restarted = await h.lifecycle.restartPeer(author.index);
        await h.network.connectPeers([author.index]);
        await h.network.waitForP2PConnections();
        // the restored head authors only once its restart sync settled
        const query = h.control(restarted).query;
        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
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
