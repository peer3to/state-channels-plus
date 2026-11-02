import { isRootDisposedError } from "@/rpc/internal/RemoteRoot";
import { Status } from "@/types";
import {
    authorWhileDown,
    RESTART_TIME_CONFIG
} from "@test/fixtures/PersistenceRestartStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import { readdir } from "node:fs/promises";

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
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
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
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
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
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
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
            persistentPeers: [2],
            timeConfig: RESTART_TIME_CONFIG
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
            persistentPeers: [2],
            timeConfig: RESTART_TIME_CONFIG
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
            persistentPeers: [0, 1, 2],
            timeConfig: RESTART_TIME_CONFIG
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
