import {
    stageMirrorMissingTopUp,
    tryBuildProofView
} from "@test/fixtures/ProofOwnerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// buildStateProof walks the built proof once, from the chain's anchor, on the
// chain. A mirror that lags a consumed inbound block no longer matters, and
// no second walk from the stored anchor follows a rejection.

describe("Unit: AgreementManager buildStateProof chain walk", function () {
    it("the mirror lacks a consumed inbound block → the chain's one trusted-start walk accepts, the proof is returned, no second walk runs", async function () {
        const h = TestSession.getHarness();
        const lagging = 2;
        await stageMirrorMissingTopUp(h, {
            laggingIndex: lagging,
            anchorBeforeTopUp: true
        });
        const localWalk = await h.mirror.observe(
            lagging,
            "verifyMilestonesFromTrustedStart"
        );
        const chainWalk = await h.mirror.observe(lagging, "verifyMilestones");

        const built = await tryBuildProofView(h, lagging);
        const local = await localWalk.observation();
        const chain = await chainWalk.observation();
        await localWalk.restore();
        await chainWalk.restore();

        expect(built.thrown).to.equal(null);
        expect(local.local.reads).to.equal(0);
        expect(local.chain.answers).to.deep.equal([true]);
        // only the view's own chain walk of the result reads verifyMilestones
        expect(chain.chain.answers).to.deep.equal([true]);
        expect(built.view!.chainWalk.valid).to.equal(true);
    });

    it("the chain rejects the built proof (it answers from before the consumed inbound block) → buildStateProof throws, no proof, no second walk", async function () {
        const h = TestSession.getHarness();
        const lagging = 2;
        await stageMirrorMissingTopUp(h, {
            laggingIndex: lagging,
            anchorBeforeTopUp: true
        });
        const localWalk = await h.mirror.observe(
            lagging,
            "verifyMilestonesFromTrustedStart"
        );
        const chainWalk = await h.mirror.observe(lagging, "verifyMilestones");
        // the chain answers from just before the top-up's inbound log, so it
        // lacks the block the proof consumes
        await h.mirror.serveChainReadsBefore(
            lagging,
            "verifyMilestonesFromTrustedStart",
            "InboundMessagesProcessed"
        );

        const built = await tryBuildProofView(h, lagging);
        const local = await localWalk.observation();
        const chain = await chainWalk.observation();
        await localWalk.restore();
        await chainWalk.restore();

        expect(built.view).to.equal(null);
        expect(built.thrown).to.match(/does not verify from its anchor/);
        expect(local.chain.answers).to.deep.equal([false]);
        expect(chain.chain.reads).to.equal(0);
    });
});
