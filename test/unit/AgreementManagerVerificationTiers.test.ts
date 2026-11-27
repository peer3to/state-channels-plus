import {
    buildProofView,
    walkAcrossAnchorAdvance,
    craftConflictingAnchorRun,
    localFinalizedView,
    stageFinalBlocks,
    stageFinalThenUnfinalizedTail,
    stageJoinHopWithLaterFinalPoint,
    stageMirrorMissingTopUp,
    verifyProofView,
    walkAllTiersView
} from "@test/fixtures/ProofOwnerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("Unit: AgreementManager verification tiers", function () {
    it("RR1: a chain anchor advance during verification returns the checked start and skips malformed old history in persistence", async function () {
        expect(
            await walkAcrossAnchorAdvance(TestSession.getHarness())
        ).to.deep.equal({ valid: true, start: 3, final: 3, persisted: true });
    });

    it("U26: the latest local finalized state verifies the proof → accepted there, the chain walk never runs", async function () {
        const h = TestSession.getHarness();
        await stageFinalBlocks(h, { postAnchor: true, finalBlocks: 2 });
        const localFinalized = await localFinalizedView(h, 0);
        const view = await buildProofView(h, 0);
        const observed = await h.mirror.observe(0, "verifyMilestones");

        const verified = await verifyProofView(h, 0, view.stateProof);
        const observation = await observed.observation();
        await observed.restore();

        expect(verified.thrown).to.equal(null);
        expect(verified.walk!.tier).to.equal("localFinalized");
        expect(verified.walk!.valid).to.equal(true);
        expect(verified.walk!.start!.hash).to.equal(localFinalized!.hash);
        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.reads).to.equal(0);
    });

    it("U27: no local finalized state above the anchor → the chain's walk alone accepts the proof, the mirror is never read", async function () {
        const h = TestSession.getHarness();
        const { anchor, observerIndex } = await stageFinalThenUnfinalizedTail(
            h,
            { postAnchor: true }
        );
        const view = await buildProofView(h, observerIndex);
        expect(
            await localFinalizedView(h, observerIndex),
            "nothing above the anchor is provably final"
        ).to.equal(null);
        const tiers = await walkAllTiersView(h, observerIndex, view.stateProof);
        const observed = await h.mirror.observe(
            observerIndex,
            "verifyMilestones"
        );

        const verified = await verifyProofView(
            h,
            observerIndex,
            view.stateProof
        );
        const observation = await observed.observation();
        await observed.restore();

        expect(tiers.map((walk) => walk.tier)).to.deep.equal(["chain"]);
        expect(verified.walk!.tier).to.equal("chain");
        expect(verified.walk!.valid).to.equal(true);
        expect(verified.walk!.start!.hash).to.equal(anchor!.hash);
        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.reads).to.equal(1);
    });

    it("U27: chain reads proven (light client) and no local finalized state above the anchor → the chain's walk accepts the proof", async function () {
        const h = TestSession.getHarness();
        const { anchor, observerIndex } = await stageFinalThenUnfinalizedTail(
            h,
            { postAnchor: true }
        );
        const view = await buildProofView(h, observerIndex);
        const peer = h.control(h.getPeer(observerIndex));
        await peer.stub.stubProvenChainReads().request();
        try {
            const tiers = await walkAllTiersView(
                h,
                observerIndex,
                view.stateProof
            );
            const observed = await h.mirror.observe(
                observerIndex,
                "verifyMilestones"
            );
            const verified = await verifyProofView(
                h,
                observerIndex,
                view.stateProof
            );
            const observation = await observed.observation();
            await observed.restore();

            expect(tiers.map((walk) => walk.tier)).to.deep.equal(["chain"]);
            expect(verified.walk!.tier).to.equal("chain");
            expect(verified.walk!.valid).to.equal(true);
            expect(verified.walk!.start!.hash).to.equal(anchor!.hash);
            expect(observation.local.reads).to.equal(0);
            expect(observation.chain.reads).to.equal(1);
        } finally {
            await peer.stub.restoreProvenChainReads().request();
        }
    });

    it("U27: the local finalized walk returns false (a conflicting block at its height) → the chain's walk accepts the proof", async function () {
        const h = TestSession.getHarness();
        const { anchor } = await stageFinalBlocks(h, {
            postAnchor: true,
            finalBlocks: 1
        });
        const localFinalized = await localFinalizedView(h, 0);
        expect(localFinalized!.height).to.equal(anchor!.height + 1);
        // the author of anchor + 1 also signed a different, linked block there
        const stateProof = await craftConflictingAnchorRun(h, {
            observerIndex: 0,
            anchorHeight: anchor!.height,
            linked: true
        });

        const tiers = await walkAllTiersView(h, 0, stateProof);
        const verified = await verifyProofView(h, 0, stateProof);

        expect(tiers.map((walk) => [walk.tier, walk.valid])).to.deep.equal([
            ["localFinalized", false],
            ["chain", true]
        ]);
        expect(verified.walk!.tier).to.equal("chain");
        expect(verified.walk!.valid).to.equal(true);
        expect(verified.walk!.start!.hash).to.equal(anchor!.hash);
    });

    it("U28: the mirror holds no same-fork anchor → the chain's anchor walk accepts the proof", async function () {
        const h = TestSession.getHarness();
        const lagging = 2;
        const { anchor } = await stageMirrorMissingTopUp(h, {
            laggingIndex: lagging,
            anchorAfterTopUp: true
        });
        // the anchor block alone, built by a peer whose mirror is current
        const view = await buildProofView(h, 0, { height: anchor!.height });
        expect(view.milestoneHeights).to.deep.equal([[anchor!.height]]);
        expect(
            await localFinalizedView(h, lagging),
            "the lagging peer cannot prove a final point"
        ).to.equal(null);

        const tiers = await walkAllTiersView(h, lagging, view.stateProof);
        const verified = await verifyProofView(h, lagging, view.stateProof);

        expect(tiers.map((walk) => walk.tier)).to.deep.equal(["chain"]);
        expect(verified.walk!.tier).to.equal("chain");
        expect(verified.walk!.valid).to.equal(true);
        expect(verified.walk!.start!.hash).to.equal(anchor!.hash);
    });

    it("U29: a proof every tier rejects (an unlinked block after the anchor) → verification returns the chain's invalid walk", async function () {
        const h = TestSession.getHarness();
        const { anchor } = await stageFinalBlocks(h, {
            postAnchor: true,
            finalBlocks: 1
        });
        const stateProof = await craftConflictingAnchorRun(h, {
            observerIndex: 0,
            anchorHeight: anchor!.height,
            linked: false
        });

        const tiers = await walkAllTiersView(h, 0, stateProof);
        const verified = await verifyProofView(h, 0, stateProof);

        expect(tiers.map((walk) => [walk.tier, walk.valid])).to.deep.equal([
            ["localFinalized", false],
            ["chain", false]
        ]);
        expect(verified.thrown).to.equal(null);
        expect(verified.walk!.tier).to.equal("chain");
        expect(verified.walk!.valid).to.equal(false);
    });

    it("U30: the local finalized tier throws (storage lacks a required participant-change block) → verification throws, no later tier runs", async function () {
        const h = TestSession.getHarness();
        const { forkId, joinHeight, observerIndex } =
            await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
        const view = await buildProofView(h, observerIndex);
        await h
            .control(h.getPeer(observerIndex))
            .stub.pruneStoredBlocksBelowAnchor(forkId, joinHeight + 1)
            .request();
        const observed = await h.mirror.observe(
            observerIndex,
            "verifyMilestones"
        );

        const verified = await verifyProofView(
            h,
            observerIndex,
            view.stateProof
        );
        const observation = await observed.observation();
        await observed.restore();

        expect(verified.walk).to.equal(null);
        expect(verified.thrown).to.match(
            /missing the participant-change block/
        );
        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.reads).to.equal(0);
    });

    it("U30: the chain walk fails on the node RPC connection → verification throws instead of returning an invalid verdict", async function () {
        const h = TestSession.getHarness();
        const { observerIndex } = await stageFinalThenUnfinalizedTail(h, {
            postAnchor: true
        });
        const view = await buildProofView(h, observerIndex);
        expect(
            await localFinalizedView(h, observerIndex),
            "nothing above the anchor is provably final"
        ).to.equal(null);
        const observed = await h.mirror.observe(
            observerIndex,
            "verifyMilestones"
        );
        await h.mirror.failNextChainRead(
            observerIndex,
            "verifyMilestones",
            "transport"
        );

        const verified = await verifyProofView(
            h,
            observerIndex,
            view.stateProof
        );
        const observation = await observed.observation();
        await observed.restore();

        expect(verified.walk).to.equal(null);
        expect(verified.thrown).to.match(/ECONNREFUSED/);
        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.failures).to.have.length(1);
    });
});
