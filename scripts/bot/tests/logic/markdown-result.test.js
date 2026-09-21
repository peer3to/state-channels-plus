const assert = require("node:assert/strict");
const { markdownResult, decodeModelResult } = require("../../markdown-result");
const { result, request } = require("../fixtures/records");
const { validateReport } = require("../../review-format");
const control = {
    coverage: {
        complete: true,
        missing: [],
        files: [],
        lenses: [],
        behaviors: []
    },
    accounting: [],
    recommendation: "comment"
};
function markdown(metadata = {}) {
    return (
        result().report +
        `\n## Correctness\n\n- [ ] **[FO1] General PR comment**\n  <!-- pr-review-finding ${JSON.stringify({ id: "FO1", kind: "general", ...metadata })} -->\n  <!-- human:FO1:start -->\n  <!-- human:FO1:end -->\n  <!-- ai:FO1:start -->\n  A problem with **one** owner.\n\n  > **Fix FO1-FIX**\n  > Repair the boundary.\n  <!-- ai:FO1:end -->\n\n<!-- review-result ${JSON.stringify(control)} -->\n`
    );
}
describe("Markdown review conversion", function () {
    it("derives one finding body from Markdown and validates the same report", function () {
        const converted = markdownResult(markdown());
        assert.equal(converted.findings.length, 1);
        assert.equal(converted.findings[0].status, "new");
        assert.match(converted.findings[0].body, /Repair the boundary/);
        assert.ok(!converted.report.includes("review-result"));
        validateReport(result(request(), converted), request());
    });
    it("preserves follow-up identity disposition evidence and Human decisions", function () {
        const decision = {
            required: true,
            question: "Which policy?",
            reason: "Intent unclear",
            revision: 1,
            authority: "author"
        };
        const converted = markdownResult(
            markdown({
                status: "continued",
                threadId: "thread_1",
                evidence: ["source"],
                decision
            })
        );
        assert.equal(converted.findings[0].threadId, "thread_1");
        assert.deepEqual(converted.findings[0].human, decision);
        assert.deepEqual(converted.findings[0].evidence, ["source"]);
    });
    it("rejects absent duplicate or malformed control data and retains legacy JSON compatibility", function () {
        assert.throws(() => markdownResult(result().report));
        assert.throws(() =>
            markdownResult(
                markdown() +
                    `\n<!-- review-result ${JSON.stringify(control)} -->`
            )
        );
        assert.throws(() =>
            markdownResult(
                markdown().replace(
                    '"recommendation":"comment"',
                    '"invented":true'
                )
            )
        );
        assert.deepEqual(decodeModelResult(JSON.stringify(result())), result());
    });
});
