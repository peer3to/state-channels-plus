import { Status } from "@/types";
import { sleep } from "@/utils";
import {
    failNextWritersFlush,
    holdFlushes
} from "@test/fixtures/PersistenceRestartStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

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
        const submissions = await h.rpcStub.recordDisputeSubmissions(
            disputer.index
        );
        const gate = await holdFlushes(h, disputer);

        const disputing = h.execOnHost(
            disputer,
            (sm, args) => sm.disputeManager.dispute(args.forkId),
            { forkId },
            { timeoutMs: h.event.hostExecTimeoutMs() }
        );
        await gate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        expect(await submissions.submissions()).to.have.length(0);

        await gate.release();
        await disputing;
        expect(await submissions.submissions()).to.have.length(1);
        await submissions.restore();
    });

    it("a join signature leaves neither the joiner nor a countersigning member until its write is confirmed, and the join then lands", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            persistentPeers: [1, 2]
        });
        const joiner = await h.join.addSpectatorWait();
        const member = h.getPeer(1);
        const joinerGate = await holdFlushes(h, h.getPeer(joiner.index));
        const memberGate = await holdFlushes(h, member);
        expect([joinerGate.bound, memberGate.bound]).to.deep.equal([
            true,
            true
        ]);

        const joining = h.join.joinChannelWait({ joiner }).then(
            () => ({}),
            (error: unknown) => ({ error: String(error) })
        );
        await joinerGate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        // the request carrying the joiner's signature reached no member
        expect(await memberGate.held()).to.equal(0);

        await joinerGate.release();
        await memberGate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        // no countersignature reached the joiner: nothing was submitted
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );

        await memberGate.release();
        expect(await joining).to.deep.equal({});
        await waitFor(
            async () =>
                (await h.control(joiner).query.getStatus().request()) ===
                Status.PENDING_PARTICIPANT
        );
    });

    it("an open-channel signature leaves neither the lower nor the higher address until its write is confirmed, and the channel then opens", async () => {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            persistentPeers: [0, 1]
        });
        const [lowerIndex] = h.network.lobbyRoleIndices();
        const lower = h.getPeer(lowerIndex);
        const higher = h.getPeer(1 - lowerIndex);
        // no channel yet: each hold applies to the partition the negotiation binds
        const lowerGate = await holdFlushes(h, lower);
        const higherGate = await holdFlushes(h, higher);
        expect([lowerGate.bound, higherGate.bound]).to.deep.equal([
            false,
            false
        ]);

        await h.network.joinLobby(
            [0, 1],
            ethers.id("e2e-persistence-open-channel-flush")
        );
        await lowerGate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        // the proposal carrying the lower signature reached the higher peer not
        expect(await higherGate.held()).to.equal(0);

        await lowerGate.release();
        await higherGate.waitUntilHeld();
        await sleep(ABSENCE_WINDOW_MS);
        // the higher signature was neither submitted nor answered
        expect(
            (await h.control(higher).query.getNegotiationAttempt().request())
                ?.localOpeningSignatureIssued
        ).to.equal(false);

        await higherGate.release();
        await waitFor(async () =>
            (
                await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getStatus().request()
                    )
                )
            ).every((status) => status === Status.PARTICIPATING)
        );
    });

    it("a spectator signs nothing, so a disk that fails every flush never stops it from following the channel", async () => {
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
        expect(
            await h.control(spectator).stub.failPersistenceFlushes().request()
        ).to.equal(true);

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
        expect(spectator.eventSpies.onAbort?.callCount ?? 0).to.equal(0);
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
