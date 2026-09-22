const assert = require("node:assert/strict");
const { markdownResult, decodeModelResult } = require("../../markdown-result");
const { result, request } = require("../fixtures/records");
const { validateReport, renderFinding } = require("../../review-format");
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
    it("converts plain prose without model-authored hidden metadata", function () {
        const input = request();
        const source = `# Review\n\n## Correctness\n\n### [FO1] Retry failure\nStatus: fixed\nLocation: src/a.js:42\n\n🟠 **[FO1] — Retry failure.**\n\nFixed at https://github.com/owner/repo/blob/${input.head}/src/a.js#L42\n\n> **Fix FO1-FIX**\n> Preserve the acknowledgement.\n\n## Discussion\n\n| comment:123 | response | Verified the change. | FO1 |\n\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests not run\nLenses: correctness; tests\nBehaviors: retry recovery\n`;
        assert.ok(!source.includes("<!--"));
        const converted = decodeModelResult(source, {
            request: input,
            previous: [{ id: "FO1", threadId: "thread-1" }],
            revisions: new Map([
                ["finding:FO1", "a".repeat(64)],
                ["comment:123", "b".repeat(64)]
            ])
        });
        assert.equal(converted.findings[0].threadId, "thread-1");
        assert.equal(converted.findings[0].evidence.length, 1);
        assert.equal(converted.accounting.length, 2);
        assert.equal(converted.accounting[0].sourceRevision, "b".repeat(64));
        assert.equal(converted.coverage.complete, true);
        assert.ok(!converted.findings[0].body.includes("Location:"));
        validateReport(result(input, converted), input);
        assert.throws(() => decodeModelResult(source, { request: input }), {
            code: "INVALID_RESULT"
        });
    });
    it("keeps Studio routing outside the published AI prose through conversion", function () {
        const source = markdown({
            kind: "inline",
            path: "src/a.js",
            line: 42,
            side: "RIGHT"
        })
            .replace("General PR comment", "Inline comment")
            .replace(
                "  <!-- human:FO1:start -->",
                "  **Target:** src/a.js:42\n\n  <!-- human:FO1:start -->"
            );
        const converted = markdownResult(source);
        validateReport(result(request(), converted), request());
        const body = renderFinding(converted.findings[0], "author");
        assert.ok(!body.includes("Inline comment"));
        assert.ok(!body.includes("Target:"));
        assert.ok(body.includes("A problem with **one** owner."));
        assert.equal(converted.findings[0].path, "src/a.js");
        assert.equal(converted.findings[0].line, 42);
    });
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
