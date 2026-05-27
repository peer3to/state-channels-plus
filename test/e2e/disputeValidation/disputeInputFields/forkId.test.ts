import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / disputeInputFields / forkId", function () {
    it("current fork == genesis; dispute.input.forkId = random; honest peers stay on genesis", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(3, 0, {
            timeConfig: { evidenceTime: 6 }
        });
        await h.assert.sync.peersInSyncWait();
        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();
        const originalForkId = h.context.originalForkId!;

        await h.tamper.postTamperedDispute(1, (dispute) => {
            dispute.input.forkId = randomHash();
            dispute.input.timeout.participant = ethers.ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = true;
        });

        // 1) Honest peers observe the disputeCommitted event (the junk dispute lands on-chain).
        await h.assert.dispute.committedWait({
            peersIndices: h.getHonestPeers().map((p) => p.index),
            expectedCount: 1,
            timeoutMs: 10000
        });

        // 2) No onDisputeKilled — honest peers are on genesis; the dispute targets a
        //    random forkId they do not track, so they never run kill/fraud-proof on it.
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            [0, 1, 2],
            { durationMs: 6000, maxCount: 0 }
        );

        // 3) After waiting, honest peers still hold the original (genesis) forkId -
        //    they did not switch onto the random junk fork.
        for (const p of h.getHonestPeers()) {
            expect(
                h.getPeerHandle(p.index).forkId,
                `peer ${p.index} forkId changed`
            ).to.equal(originalForkId);
        }
    });
});
