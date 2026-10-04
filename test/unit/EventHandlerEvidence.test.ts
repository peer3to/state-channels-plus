import { EVIDENCE_COMPARISON_FAULT_MESSAGE } from "@test/fixtures/customRpc/harnessControl/services/stub/node/EvidenceComparisonRecorder";
import {
    stageEvidenceAuditsOfDisputeRace,
    stageEvidenceComparisonReplacedAfterKill,
    stageEvidenceUploadRetry,
    stageHeldEvidenceComparisonRace,
    stageSequentialEvidenceAudits,
    waitForCommittedDisputeOf
} from "@test/fixtures/EvidenceComparisonStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// After a dispute passes its audit, a node that has not disputed the fork
// asks DisputeManager.shouldAddOwnEvidence, which compares its own evidence
// with the audited dispute (constructDispute plus two local reduce reads)
// once per disputed fork. Each case audits real committed disputes and
// counts the audits and comparisons with the record-only probe.

describe("Unit: EventHandler evidence comparison", function () {
    it("disputers never compare; a non-disputer compares once across two audits of the fork", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, disputerIndices, recorders } =
            await stageEvidenceAuditsOfDisputeRace(h);

        for (const index of disputerIndices)
            expect(
                await recorders.get(index)!.comparisons(),
                `disputer ${index} compared its evidence`
            ).to.deep.equal([]);
        const comparisons = await recorders.get(auditorIndex)!.comparisons();
        expect(
            comparisons.map((comparison) => comparison.outcome)
        ).to.deep.equal(["resolved"]);
        expect(
            h.event.getEventCallCount(auditorIndex, "onDisputeCommitted")
        ).to.equal(2);
    });

    it("a failed comparison is not kept: the next audit compares again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, first, recorder } =
            await stageSequentialEvidenceAudits(h, "comparisonError");

        expect(first).to.have.length(1);
        expect(first[0]).to.include({
            outcome: "rejected",
            errorName: "EvidenceComparisonFaultError"
        });
        const comparisons = await recorder.comparisons();
        expect(
            comparisons.map((comparison) => comparison.outcome)
        ).to.deep.equal(["rejected", "resolved"]);
        // the failed comparison failed its audit; the retried one completed
        await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 1);
        await TestSession.expectFirstDetachedError({
            includes: EVIDENCE_COMPARISON_FAULT_MESSAGE,
            timeoutMs: h.event.protocolEventTimeoutMs()
        });
        await TestSession.settleDetached({
            expectedErrorIncludes: EVIDENCE_COMPARISON_FAULT_MESSAGE
        });
    });

    it("a comparison ended by partial own auditing data is not kept: the next audit compares again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, first, recorder } =
            await stageSequentialEvidenceAudits(h, "unrecoverableInboundRun");

        expect(first).to.have.length(1);
        expect(first[0]).to.include({
            outcome: "rejected",
            errorName: "PartialAuditingDataError"
        });
        const comparisons = await recorder.comparisons();
        expect(
            comparisons.map((comparison) => comparison.outcome)
        ).to.deep.equal(["rejected", "resolved"]);
        // partial data is no answer, not a failure: both audits completed
        await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 2);
    });

    it("concurrent audits share one in-flight comparison: while the first is held the second audit starts no construction, and both get its answer", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, recorder } =
            await stageHeldEvidenceComparisonRace(h);

        // both audits wait on the one held comparison
        expect(
            (await recorder.comparisons()).map(
                (comparison) => comparison.outcome
            )
        ).to.deep.equal(["pending"]);
        expect(
            (await recorder.audits()).map((audit) => audit.outcome)
        ).to.deep.equal(["pending", "pending"]);
        expect(
            h.event.getEventCallCount(auditorIndex, "onDisputeCommitted")
        ).to.equal(0);

        await recorder.releaseHeld("forward");
        await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 2);

        expect(
            (await recorder.comparisons()).map(
                (comparison) => comparison.outcome
            )
        ).to.deep.equal(["resolved"]);
        const audits = await recorder.audits();
        expect(audits.map((audit) => audit.outcome)).to.deep.equal([
            "resolved",
            "resolved"
        ]);
        expect(audits[0].answer).to.be.a("boolean");
        expect(audits[1].answer).to.equal(audits[0].answer);
    });

    it("a positive comparison whose upload fails is kept: the next audit retries the upload without comparing again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, firstUploads, auditorUploads, recorder } =
            await stageEvidenceUploadRetry(h);
        const auditor = h.getPeer(auditorIndex);

        // the first audit found more evidence; its upload was lost
        expect(firstUploads).to.have.length(1);
        expect(firstUploads[0]).to.include({ waited: false, revert: null });

        // the second audit reuses the answer and uploads again, for real
        await waitFor(async () => {
            const uploads = await auditorUploads.submissions();
            return uploads.length === 2 && uploads[1].waited;
        }, h.event.protocolEventTimeoutMs());
        const own = await waitForCommittedDisputeOf(h, 0, auditor.address);
        expect(own.input.selfRemoval).to.equal(true);

        expect(
            (await recorder.comparisons()).map(
                (comparison) => comparison.outcome
            )
        ).to.deep.equal(["resolved"]);
        const audits = await recorder.audits();
        expect(audits.slice(0, 2).map((audit) => audit.answer)).to.deep.equal([
            true,
            true
        ]);
        // the lost upload was contained: no audit failed
        await TestSession.settleDetached();
    });

    it("an evidence upload refused because the evidence period expired is contained: the audit ends without a failure and the next audit uploads again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, firstUploads, auditorUploads } =
            await stageEvidenceUploadRetry(h, {
                customError: "RaceConditionDisputeEvidencePeriodExpired"
            });
        const auditor = h.getPeer(auditorIndex);

        // the first audit found more evidence; the chain refused its upload
        expect(firstUploads).to.have.length(1);
        expect(firstUploads[0]).to.include({ waited: false });

        // the refusal rolled the marker back: the next audit uploads again
        await waitFor(async () => {
            const uploads = await auditorUploads.submissions();
            return uploads.length === 2 && uploads[1].waited;
        }, h.event.protocolEventTimeoutMs());
        const own = await waitForCommittedDisputeOf(h, 0, auditor.address);
        expect(own.input.selfRemoval).to.equal(true);

        // the refused upload was contained: no audit failed
        await TestSession.settleDetached();
    });

    it("a comparison dropped by a kill cannot erase its replacement when it settles later", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, recorder } =
            await stageEvidenceComparisonReplacedAfterKill(h);

        // the kill dropped the held comparison: the next audit compared again
        expect(
            (await recorder.comparisons()).map(
                (comparison) => comparison.outcome
            )
        ).to.deep.equal(["pending", "resolved"]);
        const replacement = (await recorder.audits()).at(-1)!;
        expect(replacement.outcome).to.equal("resolved");

        // the dropped comparison fails only now
        await recorder.releaseHeld("fail");
        await recorder.waitUntilSettled(2);
        await TestSession.expectFirstDetachedError({
            includes: EVIDENCE_COMPARISON_FAULT_MESSAGE,
            timeoutMs: h.event.protocolEventTimeoutMs()
        });

        // the replacement answer is still kept: no third comparison
        const repeated = await recorder.repeatLastAudit();
        expect(repeated).to.include({
            outcome: "resolved",
            answer: replacement.answer
        });
        const comparisons = await recorder.comparisons();
        expect(
            comparisons.map((comparison) => comparison.outcome)
        ).to.deep.equal(["rejected", "resolved"]);
        expect(comparisons[0].errorName).to.equal(
            "EvidenceComparisonFaultError"
        );
        expect(
            h.event.getEventCallCount(auditorIndex, "onDisputeKilled")
        ).to.equal(1);
        await TestSession.settleDetached({
            expectedErrorIncludes: EVIDENCE_COMPARISON_FAULT_MESSAGE
        });
    });

    it("a committed reduced result drops the fork's kept comparison: asked again, the fork compares again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, recorders } =
            await stageEvidenceAuditsOfDisputeRace(h);
        const recorder = recorders.get(auditorIndex)!;

        // before the reduced result the answer is kept
        const kept = await recorder.repeatLastAudit();
        expect(kept.outcome).to.equal("resolved");
        expect(
            h.event.getEventCallCount(
                auditorIndex,
                "onDisputeReducedResultCommitted"
            )
        ).to.equal(0);
        expect(await recorder.comparisons()).to.have.length(1);

        await h.event.waitForPeers(
            "onDisputeReducedResultCommitted",
            [auditorIndex],
            1
        );

        await recorder.repeatLastAudit();
        const comparisons = await recorder.comparisons();
        expect(comparisons).to.have.length(2);
        expect(comparisons[1].outcome).to.not.equal("pending");
    });
});
