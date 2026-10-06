import { chainSnapshot } from "@test/fixtures/MilestoneSyncStaging";
import {
    blockSnapshotHashAt,
    buildProofView,
    heightRange,
    postSnapshotFrom,
    prepareSameForkView,
    stageFinalThenUnfinalizedTail,
    stageJoinHopWithLaterFinalPoint,
    suppressTimeouts
} from "@test/fixtures/ProofOwnerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("SnapshotUpdateService target selection", function () {
    it("U65: the last milestone's first block is final with an unfinalized tail after it → the update targets that first block's snapshot", async function () {
        const h = TestSession.getHarness();
        const { observerIndex } = await stageFinalThenUnfinalizedTail(h, {
            postAnchor: false
        });
        const finalPoint = await blockSnapshotHashAt(h, observerIndex, 1);

        const prepared = await prepareSameForkView(h, observerIndex);
        // records every multicall the peer sends; fails none
        const sends = await h.rpcStub.failFirstAdoptionPost(observerIndex, 0);
        const posted = await postSnapshotFrom(h, observerIndex);
        const sent = await sends.restore();

        expect(prepared.callDataCount).to.equal(1);
        expect(prepared.expectedSnapshotHash).to.equal(finalPoint);
        // the finalized-only proof carries no tail
        expect(prepared.milestoneHeights).to.deep.equal([[1]]);
        expect(posted).to.equal(true);
        // the recorder sees the update transaction
        expect(sent).to.deep.equal([["updateStateSnapshotSameFork"]]);
        expect((await chainSnapshot(h)).hash).to.equal(finalPoint);
    });

    it("U66: the last milestone's first block has sufficient finality → the update proves it and targets its snapshot", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const latest = await blockSnapshotHashAt(h, 0, 2);

        const prepared = await prepareSameForkView(h, 0);
        const posted = await postSnapshotFrom(h, 0);

        expect(prepared.callDataCount).to.equal(1);
        expect(prepared.expectedSnapshotHash).to.equal(latest);
        expect(prepared.milestoneHeights.at(-1)![0]).to.equal(2);
        expect(posted).to.equal(true);
        expect((await chainSnapshot(h)).hash).to.equal(latest);
    });

    it("U66: no block has sufficient finality → no update calldata, no transaction, the chain snapshot stays", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await suppressTimeouts(h, [0, 1, 2]);
        await h.network.blacklistAndDisconnectPeer(2);
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1],
            waitForFinalization: false
        });
        const before = await chainSnapshot(h);
        const finalizedOnly = await buildProofView(h, 0, {
            finalizedOnly: true
        });

        const prepared = await prepareSameForkView(h, 0);
        // records every multicall the peer sends; fails none
        const sends = await h.rpcStub.failFirstAdoptionPost(0, 0);
        const posted = await postSnapshotFrom(h, 0);
        const sent = await sends.restore();

        // nothing is final: the finalized-only proof is the empty genesis proof
        expect(finalizedOnly.milestoneHeights).to.deep.equal([]);
        expect(finalizedOnly.finalized.hash).to.equal(
            finalizedOnly.genesisHash
        );
        expect(prepared.callDataCount).to.equal(0);
        expect(prepared.expectedSnapshotHash).to.equal(null);
        expect(posted).to.equal(true);
        expect(sent).to.deep.equal([]);
        expect((await chainSnapshot(h)).hash).to.equal(before.hash);
    });

    it("U67: a threshold-final block zero → its resulting snapshot is the update target", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const blockZero = await blockSnapshotHashAt(h, 0, 0);
        const before = await chainSnapshot(h);

        const prepared = await prepareSameForkView(h, 0);
        const posted = await postSnapshotFrom(h, 0);

        expect(prepared.callDataCount).to.equal(1);
        expect(prepared.expectedSnapshotHash).to.equal(blockZero);
        expect(prepared.milestoneHeights).to.deep.equal([[0]]);
        expect(posted).to.equal(true);
        const after = await chainSnapshot(h);
        // block zero's snapshot, not the genesis, though both have height 0
        expect(after.hash).to.equal(blockZero);
        expect(after.hash).to.not.equal(before.hash);
        expect(after.blockHeight).to.equal(0);
    });

    it("U67: an unfinalized block zero → no update calldata, no transaction, the chain keeps the genesis", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await suppressTimeouts(h, [0, 1, 2]);
        await h.network.blacklistAndDisconnectPeer(2);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1],
            waitForFinalization: false
        });
        const before = await chainSnapshot(h);

        const prepared = await prepareSameForkView(h, 0);
        // records every multicall the peer sends; fails none
        const sends = await h.rpcStub.failFirstAdoptionPost(0, 0);
        const posted = await postSnapshotFrom(h, 0);
        const sent = await sends.restore();

        expect(prepared.callDataCount).to.equal(0);
        expect(prepared.expectedSnapshotHash).to.equal(null);
        expect(posted).to.equal(true);
        expect(sent).to.deep.equal([]);
        expect((await chainSnapshot(h)).hash).to.equal(before.hash);
    });

    it("U109: the last milestone starts at the chain anchor and every later block is unfinalized → no update calldata, no transaction", async function () {
        const h = TestSession.getHarness();
        const { anchor, observerIndex } = await stageFinalThenUnfinalizedTail(
            h,
            { postAnchor: true }
        );
        const finalizedOnly = await buildProofView(h, observerIndex, {
            finalizedOnly: true
        });

        const prepared = await prepareSameForkView(h, observerIndex);
        // records every multicall the peer sends; fails none
        const sends = await h.rpcStub.failFirstAdoptionPost(observerIndex, 0);
        const posted = await postSnapshotFrom(h, observerIndex);
        const sent = await sends.restore();

        // nothing above the anchor is final: the finalized-only proof has no
        // milestone, so no tail block can become the target
        expect(finalizedOnly.milestoneHeights).to.deep.equal([]);
        expect(prepared.callDataCount).to.equal(0);
        expect(prepared.expectedSnapshotHash).to.equal(null);
        // nothing was sent: the wait resolves without a transaction
        expect(posted).to.equal(true);
        expect(sent).to.deep.equal([]);
        expect((await chainSnapshot(h)).hash).to.equal(anchor!.hash);
    });

    it("U118: a join milestone runs past a later final point → the last milestone stays separate and the update targets its first block, not the join block", async function () {
        const h = TestSession.getHarness();
        const {
            joinHeight: j,
            observerIndex,
            latestHeight: t
        } = await stageJoinHopWithLaterFinalPoint(h, { postAnchor: false });
        const joinSnapshot = await blockSnapshotHashAt(h, observerIndex, j);
        const finalPoint = await blockSnapshotHashAt(h, observerIndex, t - 1);

        const finalizedOnly = await buildProofView(h, observerIndex, {
            finalizedOnly: true
        });
        const prepared = await prepareSameForkView(h, observerIndex);
        const posted = await postSnapshotFrom(h, observerIndex);

        expect(t - 1).to.be.greaterThan(j);
        expect(finalizedOnly.milestoneHeights).to.deep.equal([
            heightRange(j, t),
            [t - 1, t]
        ]);
        expect(prepared.milestoneHeights).to.deep.equal(
            finalizedOnly.milestoneHeights
        );
        expect(prepared.expectedSnapshotHash).to.equal(finalPoint);
        expect(prepared.expectedSnapshotHash).to.not.equal(joinSnapshot);
        expect(posted).to.equal(true);
        expect((await chainSnapshot(h)).hash).to.equal(finalPoint);
    });
});
