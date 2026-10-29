const assert = require("node:assert/strict");
const {
    markdownResult,
    decodeModelResult,
    repairModelResult
} = require("../../markdown-result");
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
    it("refuses footer-only repair of a footer-free draft until a complete document arrives", function () {
        const full = markdown(),
            footer = `<!-- review-result ${JSON.stringify(control)} -->`;
        const previous = full.replace(footer, "");
        assert.throws(() =>
            markdownResult(repairModelResult(previous, footer))
        );
        assert.deepEqual(
            markdownResult(repairModelResult(previous, full)),
            markdownResult(full)
        );
    });
    it("refuses footer-only repair of an ambiguous two-footer draft", function () {
        const full = markdown(),
            footer = `<!-- review-result ${JSON.stringify(control)} -->`;
        assert.throws(() =>
            markdownResult(repairModelResult(full + footer, footer))
        );
        assert.deepEqual(
            markdownResult(repairModelResult(full + footer, full)),
            markdownResult(full)
        );
    });
    it("rejects a malformed open finding following a valid fixed finding", function () {
        const source =
            "## Correctness\n### [FO1] Fixed\nStatus: fixed\nLocation: general\n[FO1] Fixed.\n> Fix FO1-FIX\n### [FO-2] Open\nStatus: new\nLocation: general\n[FO-2] Defect.\n> Fix FO-2-FIX\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: none\nLenses: correctness\nBehaviors: retry\n";
        assert.throws(() => decodeModelResult(source, { request: request() }), {
            code: "INVALID_RESULT"
        });
    });
    it("converts general prose and extracts the visible Human decision", function () {
        const input = request();
        const source = `## Correctness\n### [FO1] Policy\nStatus: new\nLocation: general\n🧑 **HUMAN DECISION REQUIRED**\nDecision: Which policy should apply?\n[FO1] Preserve the Human's choice.\nhttps://github.com/owner/repo/blob/${input.head}/README.md#L1\n> Fix FO1-FIX\n> Wait for the Human.\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests\nLenses: correctness\nBehaviors: policy\n`;
        const converted = decodeModelResult(source, { request: input });
        const finding = converted.findings[0];
        assert.equal(finding.path, null);
        assert.equal(finding.line, null);
        assert.equal(finding.status, "new");
        assert.equal(finding.evidence.length, 1);
        assert.equal(finding.human.question, "Which policy should apply?");
        assert.match(finding.body, /Wait for the Human/);
        validateReport(result(input, converted), input);
        assert.throws(
            () =>
                decodeModelResult(
                    source.replace(
                        "Decision: Which policy should apply?\n",
                        ""
                    ),
                    { request: input }
                ),
            { code: "INVALID_RESULT" }
        );
    });
    it("preserves incomplete coverage and rejects omitted completion fields", function () {
        const source =
            "# Review\n## Review completion\nComplete: no\nMissing: discussion; source\nVerification missing: tests\nLenses: correctness\nBehaviors: retry\n";
        const converted = decodeModelResult(source, { request: request() });
        assert.deepEqual(converted.coverage.missing, ["discussion", "source"]);
        assert.equal(converted.coverage.complete, false);
        require("../../protocol").result(
            result(request(), {
                ...converted,
                evidence: result().evidence,
                recommendation: "comment"
            }),
            request()
        );
        assert.throws(
            () =>
                require("../../protocol").result(
                    result(request(), {
                        ...converted,
                        evidence: result().evidence,
                        coverage: { ...converted.coverage, complete: true },
                        recommendation: "comment"
                    }),
                    request()
                ),
            { code: "INVALID_RESULT" }
        );
        assert.throws(
            () =>
                decodeModelResult(
                    source.replace("Missing: discussion; source\n", ""),
                    { request: request() }
                ),
            { code: "INVALID_RESULT" }
        );
    });
    it("rejects malformed finding-shaped prose instead of declaring a clean review", function () {
        const completion =
            "## Review completion\nComplete: yes\nMissing: none\nVerification missing: none\nLenses: correctness\nBehaviors: review\n";
        assert.equal(
            decodeModelResult("# Review\n\n" + completion, {
                request: request()
            }).findings.length,
            0
        );
        assert.throws(
            () =>
                decodeModelResult(
                    "## Correctness\n### [FO-1] Defect\nStatus: new\nLocation: general\n\n🟠 Defect\n> Fix FO-1-FIX\n\n" +
                        completion,
                    { request: request() }
                ),
            { code: "INVALID_RESULT" }
        );
    });
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
