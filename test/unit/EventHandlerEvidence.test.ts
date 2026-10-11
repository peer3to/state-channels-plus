import { Codec, hash, Type } from "@/utils";
import { EVIDENCE_COMPARISON_FAULT_MESSAGE } from "@test/fixtures/customRpc/harnessControl/services/stub/node/EvidenceComparisonRecorder";
import {
    EVIDENCE_UPLOAD_FAILURE_MESSAGE,
    postReasonlessDispute,
    prepareHigherStateCounterDispute,
    stageEvidenceAuditsOfDisputeRace,
    stageEvidenceComparisonReplacedAfterKill,
    stageHeldEvidenceComparisonRace,
    stageHeldHigherStateCounterDispute,
    stageKeptHigherStateComparison,
    stageSequentialEvidenceAudits,
    uploadGenesisDispute,
    waitForCommittedDisputeOf
} from "@test/fixtures/EvidenceComparisonStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const MISSING_INBOUND_RUN_MESSAGE =
    "the inbound run is unavailable after event recovery";

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

    it("a comparison ended by missing own auditing data is not kept: the next audit compares again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, first, recorder } =
            await stageSequentialEvidenceAudits(h, "unrecoverableInboundRun");

        expect(first).to.have.length(1);
        // missing own data throws: there is no partial auditing data
        expect(first[0]).to.include({
            outcome: "rejected",
            errorName: "Error"
        });
        const comparisons = await recorder.comparisons();
        expect(
            comparisons.map((comparison) => comparison.outcome)
        ).to.deep.equal(["rejected", "resolved"]);
        // the failed comparison failed its audit; the retried one completed
        await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 1);
        await TestSession.expectFirstDetachedError({
            includes: MISSING_INBOUND_RUN_MESSAGE,
            timeoutMs: h.event.protocolEventTimeoutMs()
        });
        await TestSession.settleDetached({
            expectedErrorIncludes: MISSING_INBOUND_RUN_MESSAGE
        });
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
        const { auditorIndex, forkId, quietIndices, recorder, uploads } =
            await prepareHigherStateCounterDispute(h, {
                failUploadOnce: true
            });
        const auditor = h.getPeer(auditorIndex);
        await uploadGenesisDispute(h);

        // the first audit found more evidence and sent the compared dispute;
        // its upload failed, which is fatal to that audit
        await waitFor(
            async () => (await uploads.submissions()).length > 0,
            h.event.protocolEventTimeoutMs()
        );
        expect((await uploads.submissions())[0]).to.include({
            waited: false,
            revert: null
        });
        await TestSession.expectFirstDetachedError({
            includes: EVIDENCE_UPLOAD_FAILURE_MESSAGE,
            timeoutMs: h.event.protocolEventTimeoutMs()
        });

        // a second dispute of the fork: the audit reuses the answer
        await h.rpcStub.restoreDisputeInitiationAndDispute(
            quietIndices[0],
            forkId
        );
        await waitFor(async () => {
            const sent = await uploads.submissions();
            return sent.length === 2 && sent[1].waited;
        }, h.event.protocolEventTimeoutMs());
        await waitForCommittedDisputeOf(h, quietIndices[0], auditor.address);

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
        await TestSession.settleDetached({
            expectedErrorIncludes: EVIDENCE_UPLOAD_FAILURE_MESSAGE
        });
    });

    it("a leaving node audits a valid dispute: it disputes at once with its self-removal, building its dispute once and comparing nothing", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, quietIndices, recorder } =
            await prepareHigherStateCounterDispute(h);
        const auditor = h.getPeer(auditorIndex);
        await h.control(auditor).dispute.setForceExit(true).request();
        await uploadGenesisDispute(h);

        const own = await waitForCommittedDisputeOf(
            h,
            quietIndices[0],
            auditor.address
        );
        expect(own.input.selfRemoval).to.equal(true);
        expect(await recorder.comparisons()).to.deep.equal([]);
        expect((await recorder.audits())[0].answer).to.equal(true);
        expect(await recorder.disputeBuilds()).to.equal(1);
    });

    it("a counter-dispute uploads the dispute its comparison built, without building it again", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, quietIndices, recorder, uploads } =
            await stageHeldHigherStateCounterDispute(h);

        await recorder.releaseHeld("forward");
        const own = await waitForCommittedDisputeOf(
            h,
            quietIndices[0],
            h.getPeer(auditorIndex).address
        );

        const comparisons = await recorder.comparisons();
        expect(
            comparisons.map((comparison) => comparison.outcome)
        ).to.deep.equal(["resolved"]);
        expect(hash(Codec.encode(own, Type.Dispute))).to.equal(
            comparisons[0].disputeHash
        );
        expect(await recorder.disputeBuilds()).to.equal(0);
        expect(await uploads.submissions()).to.have.length(1);
    });

    it("a kill of another dispute follows a kept positive comparison: dispute(kill) builds its own dispute with the killed submitter's slash instead of the compared one", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, quietIndices, recorder, uploads } =
            await stageKeptHigherStateComparison(h);
        const auditor = h.getPeer(auditorIndex);
        const [spammerIndex, observerIndex] = quietIndices;
        // only the auditor kills, inside its own multicall
        for (const index of [1, 2, 3])
            await h.rpcStub.suppressDisputeKill(index);
        await h.dispute.restoreDisputeInitiation([auditorIndex]);

        await postReasonlessDispute(h, spammerIndex);
        const own = await waitForCommittedDisputeOf(
            h,
            observerIndex,
            auditor.address
        );

        const [upload] = await uploads.submissions();
        expect(upload.innerMethods).to.include("applyDisputeFraudProofs");
        expect(own.input.onChainSlashes).to.include(
            h.getPeer(spammerIndex).address
        );
        expect(hash(Codec.encode(own, Type.Dispute))).to.not.equal(
            (await recorder.comparisons())[0].disputeHash
        );
        expect(await recorder.disputeBuilds()).to.equal(1);
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
