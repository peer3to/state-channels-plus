import {
    stageMirrorMissingTopUp,
    tryBuildProofView
} from "@test/fixtures/ProofOwnerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// buildStateProof walks the built proof on the local diamond first. A lagging
// mirror can leave a hop unproven locally; the chain's walk then decides, and
// only a proof both walks reject is refused.

describe("Unit: AgreementManager buildStateProof walk fallback", function () {
    it("the mirror's walk of the built proof is invalid (it lacks a consumed inbound block) → the chain's walk accepts, the proof is returned", async function () {
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
        expect(local.local.answers).to.deep.equal([false]);
        // the build's own fallback, then the view's chain walk of the result
        expect(chain.chain.answers.slice(0, 1)).to.deep.equal([true]);
        expect(built.view!.chainWalk.valid).to.equal(true);
    });

    it("the mirror and the chain both reject the built proof (both lack the consumed inbound block) → buildStateProof throws, no proof", async function () {
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
        // lacks the same block the mirror lacks
        await h.mirror.serveChainReadsBefore(
            lagging,
            "verifyMilestones",
            "InboundMessagesProcessed"
        );

        const built = await tryBuildProofView(h, lagging);
        const local = await localWalk.observation();
        const chain = await chainWalk.observation();
        await localWalk.restore();
        await chainWalk.restore();

        expect(built.view).to.equal(null);
        expect(built.thrown).to.match(/does not verify from its anchor/);
        expect(local.local.answers).to.deep.equal([false]);
        expect(chain.chain.answers).to.deep.equal([false]);
    });
});
