const assert = require("node:assert/strict");
const { canApprove, reviewStatus } = require("../../approval");
const { resolutionEvidence, threadSettled } = require("../../review-decisions");
const { sourceRevision } = require("../../reconcile");
const { request, result } = require("../fixtures/records");
function fixture() {
    const input = request();
    const report = result(input, { recommendation: "comment" });
    report.coverage.verificationMissing = ["Tests are CI-owned"];
    const observations = {
        pull: {
            state: "open",
            draft: false,
            head: { sha: input.head },
            user: { id: 7 }
        },
        findings: [],
        threads: [],
        inline: [],
        comments: [],
        reviews: []
    };
    const state = {
        head: input.head,
        round: 1,
        status: "complete",
        findings: [],
        approvalEvidence: resolutionEvidence(report, observations, 9)
    };
    const receipt = { complete: true, kind: "review", round: 1 };
    const status = () =>
        reviewStatus(input, report.executionId, state, receipt);
    const allowed = () =>
        canApprove({
            status: status(),
            observations,
            head: input.head,
            botId: 9,
            ciPassed: true
        });
    return { input, report, observations, state, receipt, status, allowed };
}
describe("deterministic review approval", function () {
    it("approves a confirmed clean source review without model approval or runtime verification", function () {
        const f = fixture();
        assert.equal(f.allowed(), true);
        assert.equal(
            canApprove({
                status: f.status(),
                observations: f.observations,
                head: f.input.head,
                botId: 9,
                ciPassed: false
            }),
            false
        );
    });
    it("requires confirmed receipt, matching round and execution, complete evidence and closed findings", function () {
        const f = fixture();
        for (const [target, field, value] of [
            [f.receipt, "complete", false],
            [f.receipt, "round", 2],
            [f.receipt, "kind", "notice"],
            [f.state, "status", "partial"],
            [f.state, "head", "b".repeat(40)],
            [f.state.approvalEvidence, "executionId", "other"],
            [f.state.approvalEvidence, "complete", false],
            [f.state.approvalEvidence, "accounted", false],
            [f.state.approvalEvidence, "threadsResolved", false]
        ]) {
            const old = target[field];
            target[field] = value;
            assert.equal(f.allowed(), false, field);
            target[field] = old;
        }
        f.state.findings.push({
            id: "F1",
            status: "continued",
            human: { required: true }
        });
        assert.equal(f.allowed(), false);
        f.state.findings[0].status = "fixed";
        assert.equal(f.allowed(), true);
    });
    it("blocks fresh or edited general discussion until its revision has a settled decision", function () {
        const f = fixture();
        const comment = { id: 20, user: { id: 7 }, body: "Is the race fixed?" };
        f.observations.comments.push(comment);
        assert.equal(f.allowed(), false);
        const decision = {
            sourceId: "comment:20",
            sourceRevision: sourceRevision(comment),
            disposition: "no-action",
            response: "Yes, verified in source.",
            findingId: null
        };
        f.state.approvalEvidence.accounting.push(decision);
        assert.equal(f.allowed(), true);
        decision.disposition = "response";
        assert.equal(f.allowed(), false);
        decision.findingId = "F1";
        f.state.findings.push({ id: "F1", status: "fixed" });
        assert.equal(f.allowed(), true);
        comment.body += " A new concern.";
        assert.equal(f.allowed(), false);
    });
    it("blocks reopened threads, stale heads, drafts, closed PRs and self approval", function () {
        const f = fixture();
        f.observations.threads.push({
            isResolved: false,
            comments: { nodes: [] }
        });
        assert.equal(f.allowed(), false);
        f.observations.threads[0].isResolved = true;
        assert.equal(f.allowed(), true);
        for (const [target, field, value] of [
            [f.observations.pull, "draft", true],
            [f.observations.pull, "state", "closed"],
            [f.observations.pull.head, "sha", "b".repeat(40)],
            [f.observations.pull.user, "id", 9]
        ]) {
            const old = target[field];
            target[field] = value;
            assert.equal(f.allowed(), false);
            target[field] = old;
        }
    });
    it("resolves third-party threads only with settled revision-bound decisions for every reply", function () {
        const f = fixture();
        const comment = { id: 20, user: { id: 7 }, body: "Concern" };
        const reply = { id: 21, user: { id: 8 }, body: "Another concern" };
        f.observations.inline.push(comment, reply);
        const thread = {
            comments: { nodes: [{ databaseId: 20 }, { databaseId: 21 }] }
        };
        const settled = () =>
            threadSettled(thread, f.observations, f.report, 9);
        for (const item of [comment, reply])
            f.report.accounting.push({
                sourceId: "inline:" + item.id,
                sourceRevision: sourceRevision(item),
                disposition: "fixed",
                response: "Verified fix in source",
                findingId: null
            });
        assert.equal(settled(), true);
        f.report.accounting[1].disposition = "continued";
        assert.equal(settled(), false);
        f.report.accounting[1].disposition = "fixed";
        reply.body += " edit";
        assert.equal(settled(), false);
        reply.body = "Another concern";
        comment.user.id = 9;
        assert.equal(
            settled(),
            false,
            "bot-owned finding lifecycle remains authoritative"
        );
    });
});
