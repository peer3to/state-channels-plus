import {
    chainSnapshot,
    committedSnapshotHash,
    latestHeight,
    reconstructedProof,
    stageOverlappingSupport,
    syncFromResponder
} from "@test/fixtures/MilestoneSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

/**
 * Plan 35 snapshot updates: only a proven-final state becomes the chain
 * snapshot. The target is the snapshot the last milestone's first block
 * commits to, never the unfinalized tail.
 */
describe("E2E: Snapshot update to the finalized target", function () {
    it("E20: a poster whose head block is unfinalized advances the chain only to its final point", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({ count: 3 });
        const forkId = h.activeForkId!;
        const poster = await h.query.getNextPeerToWrite();
        const others = [0, 1, 2].filter((index) => index !== poster.index);
        // The poster misses every confirmation of its next block: in its
        // view that block is an unfinalized tail on its final point.
        const restoreDrop = await h.rpcStub.dropNetworkConfirmations(
            poster.index
        );
        let tip: number;
        let posted;
        try {
            await h.transition.advanceState({
                count: 1,
                waitForPeers: others,
                waitForFinalization: true
            });
            tip = await latestHeight(h, h.getPeer(poster.index), forkId);
            const view = await reconstructedProof(h, poster.index, forkId);
            expect(view.latestProofHeight).to.equal(tip);
            expect(view.finalizedSnapshotHash).to.equal(
                await committedSnapshotHash(
                    h,
                    h.getPeer(poster.index),
                    forkId,
                    tip - 1
                )
            );
            posted = await h.transition.postSnapshotWait({
                peerIndex: poster.index,
                forkId: String(forkId)
            });
        } finally {
            await restoreDrop();
        }
        expect(posted).to.not.equal(undefined);
        expect(posted!.blockHeight).to.equal(tip - 1);
        const onChain = await chainSnapshot(h);
        expect(onChain.hash).to.equal(posted!.hash);
        expect(onChain.hash).to.equal(
            await committedSnapshotHash(
                h,
                h.getPeer(others[0]),
                forkId,
                tip - 1
            )
        );
        await h.transition.advanceState({ count: 1 });
        await h.assert.sync.peersInSyncWait();
    });

    it("E20 (no progress): with only an unfinalized block above the chain anchor no update transaction is sent; once a newer point is final the update advances to it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({ count: 3 });
        const forkId = h.activeForkId!;
        const anchor = await h.transition.postSnapshotWait({
            peerIndex: 0,
            forkId: String(forkId)
        });
        expect(anchor).to.not.equal(undefined);

        const poster = await h.query.getNextPeerToWrite();
        const others = [0, 1, 2].filter((index) => index !== poster.index);
        const restoreDrop = await h.rpcStub.dropNetworkConfirmations(
            poster.index
        );
        try {
            await h.transition.advanceState({
                count: 1,
                waitForPeers: others,
                waitForFinalization: true
            });
            const view = await reconstructedProof(h, poster.index, forkId);
            expect(view.finalizedSnapshotHash).to.equal(anchor!.hash);
            const transactionsBefore = await h.provider.getTransactionCount(
                poster.address
            );
            expect(
                await h.transition.postSnapshot({
                    peerIndex: poster.index,
                    forkId: String(forkId)
                })
            ).to.equal(undefined);
            expect(
                await h.provider.getTransactionCount(poster.address)
            ).to.equal(transactionsBefore);
            expect((await chainSnapshot(h)).hash).to.equal(anchor!.hash);
        } finally {
            await restoreDrop();
        }

        await h.transition.advanceState({ count: 2 });
        await h.assert.sync.peersInSyncWait();
        const tip = await latestHeight(h, h.getPeer(poster.index), forkId);
        const advanced = await h.transition.postSnapshotWait({
            peerIndex: poster.index,
            forkId: String(forkId)
        });
        expect(advanced).to.not.equal(undefined);
        expect(advanced!.blockHeight).to.equal(tip);
        expect(advanced!.blockHeight).to.be.greaterThan(anchor!.blockHeight);
        expect((await chainSnapshot(h)).hash).to.equal(advanced!.hash);
    });

    it("E20 (overlapping support): a later final point whose support run overlaps the change hop is the posted target, not the change block", async function () {
        const h = TestSession.getHarness();
        const { forkId, changeHeight, proof, responder } =
            await stageOverlappingSupport(h, { syncOnlyObserver: false });
        const finalPoint = proof.milestoneConfirmationHeights.at(-1)![0];
        expect(finalPoint).to.be.greaterThan(changeHeight);

        const posted = await h.transition.postSnapshotWait({
            peerIndex: responder.index,
            forkId: String(forkId)
        });
        expect(posted).to.not.equal(undefined);
        expect(posted!.blockHeight).to.equal(finalPoint);
        expect(posted!.hash).to.equal(
            await committedSnapshotHash(h, responder, forkId, finalPoint)
        );
        expect(posted!.hash).to.not.equal(
            await committedSnapshotHash(h, responder, forkId, changeHeight)
        );
        expect((await chainSnapshot(h)).hash).to.equal(posted!.hash);
    });

    it("E20 (overlapping proof): the chain verifies the overlapping proof; a sync-only observer persists the shared blocks once and reconstructs a chain-valid proof", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOverlappingSupport(h, {
            syncOnlyObserver: true
        });
        const { forkId, proof, responder, tip } = staged;
        const observer = staged.observer!;
        expect(proof.verified).to.equal(true);
        const runs = proof.milestoneConfirmationHeights;
        const shared = runs
            .at(-2)!
            .filter((height) => runs.at(-1)!.includes(height));
        expect(shared.length).to.be.greaterThan(0);

        expect(
            await syncFromResponder(h, observer, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        for (const height of shared)
            expect(
                await h
                    .control(observer)
                    .query.getBlockHashAt(forkId, height)
                    .request()
            ).to.equal(
                await h
                    .control(responder)
                    .query.getBlockHashAt(forkId, height)
                    .request()
            );
        const rebuilt = await reconstructedProof(h, observer.index, forkId);
        expect(rebuilt.milestoneConfirmationHeights).to.deep.equal(runs);
        expect(rebuilt.verified).to.equal(true);
    });
});
