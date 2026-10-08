import {
    stageEvidenceAuditAfterKill,
    waitForCommittedDisputeOf
} from "@test/fixtures/EvidenceComparisonStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: evidence comparison after a dispute kill", function () {
    it("a killed dispute drops the cached comparison: the next audit compares again and the non-disputer uploads its added evidence", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, afterFailedAudit, beforeKill, recorder } =
            await stageEvidenceAuditAfterKill(h);
        const auditor = h.getPeer(auditorIndex);

        // a failed audit never compares; the first valid one does
        expect(afterFailedAudit).to.deep.equal([]);
        expect(
            beforeKill.map((comparison) => comparison.outcome)
        ).to.deep.equal(["resolved"]);

        // the audit after the kill compares again, finds the self-removal
        // missing from the window and uploads its own dispute
        await h.assert.dispute.initiatedWait({ peersIndices: [auditorIndex] });
        await h.event.waitForPeers("onDisputeCommitted", [0, 2], 4);
        expect(
            (await recorder.comparisons()).map(
                (comparison) => comparison.outcome
            )
        ).to.deep.equal(["resolved", "resolved"]);

        const own = await waitForCommittedDisputeOf(h, 0, auditor.address);
        expect(own.input.selfRemoval).to.equal(true);
    });
});
