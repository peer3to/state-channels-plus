import { isRootDisposedError } from "@/rpc/internal/RemoteRoot";
import { Status } from "@/types";
import { sleep } from "@/utils";
import { stripDisputeReasons } from "@test/fixtures/DisputeAuditStaging";
import {
    authorWhileDown,
    startAndReduce
} from "@test/fixtures/PersistenceRestartStaging";
import {
    resolveTestTimeConfig,
    MathTestSession as TestSession
} from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import { readdir } from "node:fs/promises";

describe("E2E: persistence restart", function () {
    it("a participant restarted mid-channel holds its persisted height at SYNCED and authors nothing before any sync, syncs the blocks made while it was down, then participates and the channel continues", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 3, {
            persistentPeers: [2]
        });
        const heightBeforeRestart = await h
            .control(h.getPeer(2))
            .query.getLatestBlockHeight(forkId)
            .request();

        // the others author two blocks while peer 2 is down
        await h.getPeer(2).p2pInstance.dispose();
        await authorWhileDown(h, forkId, 2, 2);
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
        // the local mirror holds the chain's snapshot before any sync
        expect(
            await query.getLocalStateSnapshotStruct().request()
        ).to.deep.equal(
            await h
                .control(h.getPeer(0))
                .query.getLocalStateSnapshotStruct()
                .request()
        );
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

    it("a restarted participant with no participant reachable aborts at the restart sync deadline as an observer does and never participates", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            persistentPeers: [1]
        });
        await h.getPeer(0).p2pInstance.dispose();

        const restarted = await h.lifecycle.restartPeer(1);
        expect(await h.control(restarted).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        // the abort disposes the runtime while the connect may still run
        const connected = await restarted.p2pInstance.p2pSigner
            .connectToChannel(h.channelId)
            .catch((error: unknown) => {
                if (!isRootDisposedError(error)) throw error;
                return false;
            });
        expect(connected).to.equal(false);

        await waitFor(
            async () => (restarted.eventSpies.onAbort?.callCount ?? 0) > 0
        );
        expect(restarted.eventSpies.onTurn?.callCount).to.equal(0);
        expect(
            restarted.eventSpies.onStatusChanged
                ?.getCalls()
                .some((call) => call.args[1] === Status.PARTICIPATING)
        ).to.equal(false);
    });

    it("a restarted participant whose restart sync answer fails aborts as an observer does and never participates", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            persistentPeers: [1]
        });
        // the only participant answers the restart sync with an undecodable payload
        await h
            .control(h.getPeer(0))
            .stub.stubSpectatePayload("0x1234")
            .request();

        const restarted = await h.lifecycle.restartPeer(1);
        expect(await h.control(restarted).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        // the abort disposes the runtime while the connect may still run
        const connected = await restarted.p2pInstance.p2pSigner
            .connectToChannel(h.channelId)
            .catch((error: unknown) => {
                if (!isRootDisposedError(error)) throw error;
                return false;
            });
        expect(connected).to.equal(false);

        await waitFor(
            async () => (restarted.eventSpies.onAbort?.callCount ?? 0) > 0
        );
        expect(restarted.eventSpies.onTurn?.callCount).to.equal(0);
        expect(
            restarted.eventSpies.onStatusChanged
                ?.getCalls()
                .some((call) => call.args[1] === Status.PARTICIPATING)
        ).to.equal(false);
    });

    it("a spectator's join collection is refused by a threshold member held at its restored head while its restart sync is in flight, and the join lands once that sync settles", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2, {
            persistentPeers: [1]
        });
        const joiner = await h.join.addSpectatorWait();

        const restarted = await h.lifecycle.restartPeer(1);
        const query = h.control(restarted).query;
        // the restart sync reaches its responder and stays in flight
        const sync = await h.rpcStub.holdSpectateSyncApplication(1);
        const connecting = restarted.p2pInstance.p2pSigner
            .connectToChannel(h.channelId)
            .then(
                (connected) => ({ connected }),
                (error: unknown) => ({ error })
            );
        await waitFor(async () => (await sync.entered()) > 0);
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);

        let collectionError: unknown;
        try {
            await h.join.joinChannelWait({ joiner });
        } catch (error) {
            collectionError = error;
        }
        expect(String(collectionError)).to.contain(restarted.address);
        expect(String(collectionError)).to.contain(
            "restored head waits for the restart sync"
        );
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );

        await sync.release();
        expect(await connecting).to.deep.equal({ connected: true });
        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
        await h.join.joinChannelWait({ joiner });
        await waitFor(
            async () =>
                (await h.control(joiner).query.getStatus().request()) ===
                Status.PENDING_PARTICIPANT
        );
    });

    it("a participant restarted with a dispute marker whose dispute never reached the chain signs the next blocks on that fork", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 3, {
            persistentPeers: [2]
        });
        // the marker reached disk, then the process died before the upload
        await h.execOnHost(h.getPeer(2), async (sm) => {
            sm.storage.disputes.storeDisputedFork(sm.forkId, true);
            await sm.storage.flush();
        });

        const restarted = await h.lifecycle.restartPeer(2);
        const query = h.control(restarted).query;
        await h.network.connectPeers([2]);
        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
        const height = (await query.getLatestBlockHeight(forkId).request())!;
        await h.transition.advanceState({ count: 3 });

        // it signs every next block and authors its own turn, which a node
        // disputing the fork never does
        const source = h.control(h.getPeer(0)).query;
        const authors: string[] = [];
        for (let next = height + 1; next <= height + 3; next++) {
            const own = await query.getBlockByHeight(forkId, next).request();
            expect(own?.confirmationSignerAddresses).to.include(
                restarted.address
            );
            authors.push(
                (await source.getBlockByHeight(forkId, next).request())!.author
            );
        }
        expect(authors).to.include(restarted.address);
    });

    it("a participant held at its restored head audits no dispute and uploads none when a kill empties its fork's dispute window", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 2, {
            persistentPeers: [2]
        });
        for (const index of [0, 1]) await h.rpcStub.suppressTimeoutCheck(index);
        const restarted = await h.lifecycle.restartPeer(2);
        const query = h.control(restarted).query;
        const uploads = await h.rpcStub.recordDisputeSubmissions(2, {
            forward: true
        });
        const audits = await h.rpcStub.recordDisputeAudits(2);
        // peer 0 kills the invalid dispute alone, which empties the window;
        // every peer that sees that kill then tries to dispute the fork
        await h.dispute.suppressDisputeInitiation([0]);

        await h.tamper.postTamperedDispute(1, stripDisputeReasons);
        await waitFor(
            () => (restarted.eventSpies.onDisputeKilled?.callCount ?? 0) > 0,
            h.event.protocolEventTimeoutMs()
        );
        // the absence window: a dispute the kill handler started would be
        // recorded well within it
        await sleep(500);

        // the held peer took the dispute as relevant, past the fork check
        // that comes before the audit gate
        expect(
            restarted.eventSpies.disputeStarted?.callCount
        ).to.be.greaterThan(0);
        expect(await uploads.submissions()).to.have.length(0);
        expect(await audits.auditCount()).to.equal(0);
        expect(await query.didIDispute(forkId).request()).to.equal(false);
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);
    });

    it("a persistent runtime that set and cleared another channel id binds the channel that opens and resumes it after a restart", async () => {
        const h = TestSession.getHarness();
        await h.setup(2, {
            persistentPeers: [1]
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

        // the attempt's partition stays next to the channel's: never deleted
        expect(await readdir(h.getPersistenceLocation(1)!)).to.have.length(2);

        const restarted = await h.lifecycle.restartPeer(1);
        const query = h.control(restarted).query;

        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            heightBeforeRestart
        );
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);
    });

    it("a participant restarted after its own dispute landed keeps its dispute marker and its local mirror holds that dispute window", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3, 2, {
            persistentPeers: [2]
        });
        await h.dispute.openOrdinaryDisputeWindow({
            maliciousPeerIndex: 0,
            excludedPeerIndex: 1,
            forkId
        });
        const chainCommitments = await h
            .control(h.getPeer(0))
            .query.getDisputeWindowCommitments(forkId)
            .request();
        expect(chainCommitments).to.not.be.empty;

        const restarted = await h.lifecycle.restartPeer(2);
        const query = h.control(restarted).query;

        expect(await query.didIDispute(forkId).request()).to.equal(true);
        expect(
            await query.getDisputeWindowCommitments(forkId).request()
        ).to.include.members(chainCommitments);
    });

    it("an author restarted before any peer signed its latest block posts that block's calldata on chain", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, {
            persistentPeers: [0, 1, 2]
        });
        // gossip and the calldata post are cut, so only the author holds
        // the block, with its own signature alone
        const { leader, observer, authored, forkId } =
            await h.transition.authorNextBlockOffWireWait();
        const observerQuery = h.control(observer).query;
        expect(
            await observerQuery
                .getBlockCalldataTimestamp(
                    forkId,
                    authored.height,
                    leader.address
                )
                .request()
        ).to.equal(null);

        await h.lifecycle.restartPeer(leader.index);

        await waitFor(
            async () =>
                (await observerQuery
                    .getBlockCalldataTimestamp(
                        forkId,
                        authored.height,
                        leader.address
                    )
                    .request()) !== null
        );
    });

    it("an author restarted after its latest block outlived the agreement time posts that block's calldata at once", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, {
            persistentPeers: [0, 1, 2]
        });
        const { leader, observer, authored, forkId } =
            await h.transition.authorNextBlockOffWireWait();
        const observerQuery = h.control(observer).query;

        // the author stays down until its block is older than the agreement time
        await leader.p2pInstance.dispose();
        await sleep((resolveTestTimeConfig().agreementTime + 1) * 1000);
        await h.lifecycle.restartPeer(leader.index);

        await waitFor(
            async () =>
                (await observerQuery
                    .getBlockCalldataTimestamp(
                        forkId,
                        authored.height,
                        leader.address
                    )
                    .request()) !== null
        );
    });

    it("a participant that joined the channel by synchronization restarts, holds its persisted height and the channel continues", async () => {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(2, 2, {
            persistentPeers: [2]
        });
        const joiner = await h.join.addSpectatorWait();
        await h.join.joinChannelWait({ joiner });
        await h.transition.advanceState({ count: 3 });
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);
        await h.transition.advanceState({ count: 2 });
        const heightBeforeRestart = await h
            .control(joiner)
            .query.getLatestBlockHeight(forkId)
            .request();

        const restarted = await h.lifecycle.restartPeer(joiner.index);
        const query = h.control(restarted).query;
        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            heightBeforeRestart
        );
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);

        await h.network.connectPeers([joiner.index]);
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

    it("a participant restarted at the genesis of a reduced fork holds that genesis at SYNCED and participates after its restart sync", async () => {
        const h = TestSession.getHarness();
        const { newForkId } = await startAndReduce(h);

        const restarted = await h.lifecycle.restartPeer(2);
        const query = h.control(restarted).query;
        expect(await query.getForkId().request()).to.equal(newForkId);
        expect(await query.getLatestBlockHeight(newForkId).request()).to.equal(
            null
        );
        expect(await query.getStatus().request()).to.equal(Status.SYNCED);

        await h.network.connectPeers([2]);
        await waitFor(
            async () =>
                (await query.getStatus().request()) === Status.PARTICIPATING
        );
        await h.transition.advanceState({ count: 3 });
        const block = await query.getBlockByHeight(newForkId, 2).request();
        expect(block?.confirmationSignerAddresses).to.include(
            restarted.address
        );
    });

    it("a participant restarted a few blocks into a reduced fork, whose replaced fork holds more blocks, signs on the reduced fork and no peer finds a double signature", async () => {
        const h = TestSession.getHarness();
        const { replacedForkId, newForkId } = await startAndReduce(h);
        await h.transition.advanceState({ count: 2 });
        const query = h.control(h.getPeer(2)).query;
        const replacedHeight = (await query
            .getLatestBlockHeight(replacedForkId)
            .request())!;
        const height = (await query.getLatestBlockHeight(newForkId).request())!;
        expect(replacedHeight).to.be.greaterThan(height);

        const restarted = await h.lifecycle.restartPeer(2);
        const restartedQuery = h.control(restarted).query;
        expect(await restartedQuery.getForkId().request()).to.equal(newForkId);
        expect(
            await restartedQuery.getLatestBlockHeight(newForkId).request()
        ).to.equal(height);

        await h.network.connectPeers([2]);
        await waitFor(
            async () =>
                (await restartedQuery.getStatus().request()) ===
                Status.PARTICIPATING
        );
        await h.transition.advanceState({ count: 3 });

        const honest = h.peers.filter((peer) => peer.index !== 0);
        for (let next = height + 1; next <= height + 3; next++) {
            const hashes = await Promise.all(
                honest.map((peer) =>
                    h
                        .control(peer)
                        .query.getBlockHashAt(newForkId, next)
                        .request()
                )
            );
            expect(hashes[0]).to.not.equal(null);
            expect(new Set(hashes).size).to.equal(1);
            const block = await restartedQuery
                .getBlockByHeight(newForkId, next)
                .request();
            expect(block?.confirmationSignerAddresses).to.include(
                restarted.address
            );
        }
        for (const peer of honest) {
            expect(
                await h
                    .control(peer)
                    .query.isBlacklisted(restarted.address)
                    .request(),
                `peer ${peer.index} blacklisted the restarted peer`
            ).to.equal(false);
        }
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
