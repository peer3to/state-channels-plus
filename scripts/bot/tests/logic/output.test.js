const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { ReviewService } = require("../../server");
const { ModelBudget } = require("../../timing");
const { ContextBudget, PublicGitHub } = require("../../github-read");
const { DEFAULTS } = require("../../config");
const { digest } = require("../../data");
const { request, result } = require("../fixtures/records");
const { RecordedGitHub } = require("../fixtures/github");
const { RecordedModelOutput } = require("../fixtures/model");
function stallAfterRecordedTurns(model, execution) {
    model.beforeTurn = async () => {
        if (model.outputs.length) return;
        execution.budget = new ModelBudget(5);
        await execution.budget.run(
            () => new Promise(() => {}),
            async () => {}
        );
    };
}
async function fixture(outputs, body) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-output-"));
    const service = new ReviewService({
        stateRoot: root
    });
    await service.sessions.initialize();
    const input = request();
    const model = new RecordedModelOutput(outputs);
    service.prompt = "Fixed source-only prompt.";
    service.instructions =
        "Current source-review policy: verificationMissing records runtime limitations separately.";
    const observations = new RecordedGitHub([
        {
            path: `/repos/${input.repository.name}/pulls/${input.pr}`,
            response: {
                number: input.pr,
                head: { sha: input.head },
                base: { repo: { full_name: input.repository.name } }
            }
        },
        {
            path: `/repos/${input.repository.name}/issues/${input.pr}/comments`,
            response: []
        },
        {
            path: `/repos/${input.repository.name}/pulls/${input.pr}/comments`,
            response: []
        },
        {
            path: `/repos/${input.repository.name}/pulls/${input.pr}/reviews`,
            response: []
        }
    ]);
    const context = new PublicGitHub(
        input.repository.name,
        input.pr,
        new ContextBudget(DEFAULTS),
        observations.exchange.bind(observations)
    );
    for (const route of [
        `pulls/${input.pr}`,
        `issues/${input.pr}/comments`,
        `pulls/${input.pr}/comments`,
        `pulls/${input.pr}/reviews`
    ])
        await context.read(
            `https://api.github.com/repos/${input.repository.name}/${route}`
        );
    observations.done();
    const execution = {
        id: "execution-1",
        effective: digest("context"),
        adapter: model,
        tools: { gatheringMs: 0 },
        budget: new ModelBudget(1000),
        context,
        sessionId: "owned-session",
        revision: 0,
        correctionUsed: false,
        validationMs: 0
    };
    try {
        await body({ service, input, model, execution, root });
    } finally {
        await service.sessions.close();
        await fs.rm(root, { recursive: true });
    }
}
describe("review recorded native output boundary", function () {
    it("finishes missing required discussion through the real reader during continuation", async function () {
        const incomplete = result(undefined, { recommendation: "comment" });
        incomplete.coverage.complete = false;
        incomplete.coverage.missing = ["reviews"];
        await fixture(
            [incomplete, result()],
            async ({ service, input, execution, model, root }) => {
                execution.context.budget.sources =
                    execution.context.budget.sources.filter(
                        (source) => !source.url.endsWith("/reviews")
                    );
                const wire = new RecordedGitHub([
                    {
                        path: `/repos/${input.repository.name}/pulls/${input.pr}/reviews`,
                        response: []
                    }
                ]);
                execution.context.exchange = wire.exchange.bind(wire);
                model.beforeTurn = async () => {
                    if (model.prompts.length !== 1) return;
                    assert.equal(execution.context.gathered(), false);
                    await assert.rejects(
                        fs.access(path.join(root, `${input.attempt}-0.json`)),
                        { code: "ENOENT" }
                    );
                    await execution.context.read(
                        `https://api.github.com/repos/${input.repository.name}/pulls/${input.pr}/reviews`
                    );
                };
                const completed = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(completed.coverage.complete, true);
                assert.equal(execution.context.gathered(), true);
                assert.equal(model.prompts.length, 2);
                assert.equal(execution.correctionUsed, false);
                wire.done();
            }
        );
    });
    it("repairs missing discussion accounting before handing a completed review to CI", async function () {
        const completion =
            "## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests not run\nLenses: correctness\nBehaviors: retry\n";
        const draft = "# Review\n\n" + completion;
        const repaired =
            "# Review\n\n## Discussion\n| comment:123 | no-action | The specified behavior already matches the implementation. | - |\n\n" +
            completion;
        await fixture(
            [draft, repaired],
            async ({ service, input, execution, model, root }) => {
                const wire = new RecordedGitHub([
                    {
                        path: `/repos/${input.repository.name}/issues/${input.pr}/comments`,
                        response: [
                            {
                                id: 123,
                                body: "Please check the retry behavior.",
                                user: { id: 7, type: "User", login: "author" }
                            }
                        ]
                    }
                ]);
                execution.context.exchange = wire.exchange.bind(wire);
                await execution.context.read(
                    `https://api.github.com/repos/${input.repository.name}/issues/${input.pr}/comments`
                );
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(model.prompts.length, 2);
                assert.match(
                    model.prompts[1],
                    /missing dispositions for: comment:123/
                );
                assert.equal(output.accounting[0].sourceId, "comment:123");
                assert.equal(
                    output.accounting[0].sourceRevision,
                    execution.context.revisions.get("comment:123")
                );
                assert.equal(execution.correctionUsed, false);
                wire.done();
            }
        );
    });
    it("repairs an invalid inline target on the same session before returning model success", async function () {
        await require("../fixtures/git").gitFixture(async (tree) => {
            const draft = (line) =>
                `# Review\n\n## Correctness\n\n### [FO1] Retry\nStatus: new\nLocation: README.md:${line}\n\n🟠 **[FO1] — Retry defect.**\n\nSee https://github.com/owner/repo/blob/${tree.input.head}/README.md#L1\n\n> **Fix FO1-FIX**\n> Preserve the result.\n\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: tests not run\nLenses: correctness\nBehaviors: retry\n`;
            await fixture(
                [draft(999), draft(1)],
                async ({ service, input, execution, model, root }) => {
                    Object.assign(input, {
                        head: tree.input.head,
                        base: tree.input.base,
                        mergeBase: tree.input.mergeBase
                    });
                    execution.repoRoot = tree.source;
                    execution.sourceBase = input.base;
                    const output = await service.generate(
                        input,
                        execution,
                        input,
                        root
                    );
                    assert.equal(output.findings[0].line, 1);
                    assert.equal(model.prompts.length, 2);
                    assert.match(model.prompts[1], /FO1 targets README.md:999/);
                    assert.equal(execution.correctionUsed, false);
                    assert.equal(output.sessionId, "owned-session");
                    assert.equal(output.revision, 0);
                    assert.equal(
                        await fs.readFile(
                            path.join(root, `${input.attempt}-0-draft-0.md`),
                            "utf8"
                        ),
                        draft(999)
                    );
                }
            );
        });
    });
    it("repairs malformed accounting-correction output without advancing beyond revision one", async function () {
        await fixture(
            [result(), "invalid Markdown", result()],
            async ({ service, input, execution, model, root }) => {
                model.turnMs = 15;
                execution.result = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                const corrected = await service.correct(
                    input,
                    execution,
                    "Account for the new discussion."
                );
                assert.equal(corrected.revision, 1);
                const timing = corrected.evidence.durations;
                assert.ok(timing.turns.every((duration) => duration >= 10));
                assert.equal(
                    timing.correctionMs,
                    timing.turns[1] + timing.turns[2]
                );
                assert.equal(
                    timing.gatheringMs + timing.assessmentMs,
                    timing.turns[0]
                );
                assert.equal(
                    timing.modelMs,
                    timing.turns.reduce((sum, duration) => sum + duration, 0)
                );
                assert.equal(model.prompts.length, 3);
                await fs.access(path.join(root, `${input.attempt}-0.json`));
                await fs.access(path.join(root, `${input.attempt}-1.json`));
                assert.equal(
                    await fs.readFile(
                        path.join(root, `${input.attempt}-1-draft-0.md`),
                        "utf8"
                    ),
                    "invalid Markdown"
                );
            }
        );
    });
    it("repairs a recovered read error with only a footer and preserves the substantive draft", async function () {
        const original = result(undefined, { recommendation: "comment" });
        original.report += `
## Correctness
- [ ] **[FO1] General PR comment**
<!-- pr-review-finding {"id":"FO1","kind":"general","status":"new","evidence":["retry owner source"]} -->
<!-- human:FO1:start -->
<!-- human:FO1:end -->
<!-- ai:FO1:start -->
🟠 **[FO1] Retry loses the pending operation.**
Keep the operation until its acknowledgment is persisted.
> **Fix FO1-FIX**
> Preserve the pending operation across retry.
<!-- ai:FO1:end -->
- [ ] **[FO2] Inline comment**
<!-- pr-review-finding {"id":"FO2","kind":"inline","path":"README.md","line":1,"side":"RIGHT","status":"new","evidence":["source line 1"]} -->
<!-- human:FO2:start -->
<!-- human:FO2:end -->
<!-- ai:FO2:start -->
🟠 **[FO2] Missing validation at this source boundary.**
> **Fix FO2-FIX**
> Validate before accepting the operation.
<!-- ai:FO2:end -->
- [ ] **[FO3] General PR comment**
<!-- pr-review-finding {"id":"FO3","kind":"general","status":"new","decision":{"required":true,"question":"Which policy applies?","reason":"The contract leaves this open.","revision":1,"authority":"author"},"evidence":["policy gap"]} -->
<!-- human:FO3:start -->
<!-- human:FO3:end -->
<!-- ai:FO3:start -->
🧑 **HUMAN DECISION REQUIRED**
**[FO3] Choose the intended retry policy.**
**STOP — implementing agents:** Ask the Human.
> **Fix FO3-FIX**
> Follow the chosen policy.
<!-- ai:FO3:end -->
`;
        const control = {
            coverage: original.coverage,
            accounting: [],
            recommendation: "comment",
            errors: [
                "Wrong-path read failed; the intended source was subsequently read in full."
            ]
        };
        const draft =
            original.report +
            "\n<!-- review-result " +
            JSON.stringify(control) +
            " -->\n";
        const footer =
            "<!-- review-result " +
            JSON.stringify({ ...control, errors: [] }) +
            " -->";
        await fixture(
            [draft, footer],
            async ({ service, input, execution, model, root }) => {
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(output.report.trim(), original.report.trim());
                assert.equal(output.findings.length, 3);
                const expected =
                    require("../../markdown-result").decodeModelResult(
                        original.report + "\n" + footer,
                        { request: input }
                    );
                assert.deepEqual(output.findings, expected.findings);
                assert.equal(output.findings[1].path, "README.md");
                assert.equal(output.findings[1].line, 1);
                assert.equal(
                    output.findings[2].human.question,
                    "Which policy applies?"
                );
                assert.equal(output.findings[0].id, "FO1");
                assert.match(
                    output.findings[0].body,
                    /Preserve the pending operation across retry/
                );
                assert.deepEqual(output.findings[0].evidence, [
                    "retry owner source"
                ]);
                assert.deepEqual(output.evidence.errors, []);
                assert.ok(
                    model.prompts[1].includes("coverage.complete is true")
                );
                assert.ok(model.prompts[1].includes("UNRESOLVED"));
                assert.equal(
                    await fs.readFile(
                        path.join(root, `${input.attempt}-0-draft-0.md`),
                        "utf8"
                    ),
                    draft
                );
                assert.equal(model.prompts.length, 2);
            }
        );
    });
    it("does not silently clear a genuinely unresolved failure during footer repair", async function () {
        const original = result(undefined, { recommendation: "comment" });
        const control = {
            coverage: original.coverage,
            accounting: [],
            recommendation: "comment",
            errors: ["Required source remains unavailable"]
        };
        const draft =
            original.report +
            "\n<!-- review-result " +
            JSON.stringify(control) +
            " -->\n";
        const footer =
            "<!-- review-result " +
            JSON.stringify({
                ...control,
                coverage: {
                    ...control.coverage,
                    complete: false,
                    missing: ["Required source"]
                }
            }) +
            " -->";
        await fixture(
            [draft, footer],
            async ({ service, input, execution, model, root }) => {
                stallAfterRecordedTurns(model, execution);
                await assert.rejects(
                    service.generate(input, execution, input, root),
                    { code: "REVIEW_TIMEOUT" }
                );
                await fs.access(
                    path.join(root, `${input.attempt}-0-draft-0.md`)
                );
                await assert.rejects(
                    fs.access(path.join(root, `${input.attempt}-1.json`)),
                    { code: "ENOENT" }
                );
            }
        );
    });
    it("loads the full review audits before source-only automation overrides", async function () {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-skill-"));
        const service = new ReviewService({ stateRoot: root });
        try {
            await service.start();
            const skillRoot = path.join(__dirname, "../../skill");
            const full = await fs.readFile(
                path.join(
                    skillRoot,
                    "inherited/review-implementation/SKILL.md"
                ),
                "utf8"
            );
            const override = await fs.readFile(
                path.join(skillRoot, "references/automation.md"),
                "utf8"
            );
            assert.ok(service.instructions.includes(full));
            assert.ok(
                service.instructions.includes(
                    await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
                )
            );
            assert.ok(
                service.instructions.indexOf(override) >
                    service.instructions.indexOf(full)
            );
            assert.ok(override.includes("HUMAN DECISION REQUIRED"));
            assert.ok(override.includes("advisory, not a resolution gate"));
        } finally {
            await service.close();
            await fs.rm(root, { recursive: true });
        }
    });
    it("refreshes policy on resumed reviews and keeps accounting corrections focused", async function () {
        await fixture(
            [result(), result(), result()],
            async ({ service, input, execution, model, root }) => {
                await service.generate(input, execution, input, root);
                const files = [
                    "automation.md",
                    "source-review.md",
                    "model-output.md"
                ];
                service.instructions = (
                    await Promise.all(
                        files.map((file) =>
                            fs.readFile(
                                path.join(
                                    __dirname,
                                    "../../skill/references",
                                    file
                                ),
                                "utf8"
                            )
                        )
                    )
                ).join("\n\n");
                service.prompt = await fs.readFile(
                    path.join(
                        __dirname,
                        "../../skill/references/review-prompt.md"
                    ),
                    "utf8"
                );
                const resumed = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                const corrected = await service.correct(
                    input,
                    execution,
                    "Account for comment:12."
                );
                assert.equal(resumed.sessionId, "owned-session");
                assert.equal(corrected.sessionId, resumed.sessionId);
                assert.equal(model.prompts.length, 3);
                assert.ok(model.prompts[1].includes(service.instructions));
                assert.ok(!model.prompts[2].includes(service.instructions));
                assert.ok(model.prompts[2].includes("focused correction"));
                assert.ok(model.prompts[2].includes("comment:12"));
                assert.ok(model.prompts[1].includes(service.prompt));
                assert.ok(!model.prompts[0].includes(service.instructions));
            }
        );
    });
    it("accepts completed source review Markdown with unverified live acceptance without retry", async function () {
        const output = result(undefined, { recommendation: "comment" });
        output.coverage.verificationMissing = ["Live acceptance not observed"];
        const markdown =
            output.report +
            `\n<!-- review-result ${JSON.stringify({ coverage: output.coverage, accounting: [], recommendation: "comment", errors: [] })} -->\n`;
        await fixture(
            [markdown],
            async ({ service, input, execution, model, root }) => {
                const generated = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.deepEqual(
                    generated.coverage.verificationMissing,
                    output.coverage.verificationMissing
                );
                assert.equal(generated.coverage.complete, true);
                assert.equal(model.prompts.length, 1);
            }
        );
    });
    it("continues an incomplete review on the same owner before accepting completion", async function () {
        const output = result(undefined, { recommendation: "comment" });
        output.coverage.complete = false;
        output.coverage.missing = ["PR discussion and source diff"];
        output.evidence.errors = ["Context retrieval failed"];
        await fixture(
            [output, result(undefined, { recommendation: "comment" })],
            async ({ service, input, execution, model, root }) => {
                const completed = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(completed.coverage.complete, true);
                assert.equal(model.prompts.length, 2);
                assert.match(model.prompts[1], /PR discussion and source diff/);
                assert.match(model.prompts[1], /Continue the existing review/);
                assert.equal(execution.correctionUsed, false);
            }
        );
    });
    it("preserves actionable findings when only thread-resolution status is unknown", async function () {
        const output = result(undefined, { recommendation: "comment" });
        output.coverage.verificationMissing = [
            "Thread resolution unknown; publisher must verify current state."
        ];
        const markdown =
            output.report +
            `
## Correctness
- [ ] **[FO1] General PR comment**
  <!-- pr-review-finding {"id":"FO1","kind":"general","status":"new","threadId":null,"evidence":["source inspection"],"decision":null} -->
  <!-- human:FO1:start -->
  <!-- human:FO1:end -->
  <!-- ai:FO1:start -->
  🟠 **[FO1] — Retry drops pending work.**
  A failed retry removes the queued item before acknowledgment, losing the operation.
  > **Fix FO1-FIX**
  > Retain the item until acknowledged and verify recovery after a failed retry.
  <!-- ai:FO1:end -->
<!-- review-result ${JSON.stringify({ coverage: output.coverage, accounting: [], recommendation: "comment", errors: [] })} -->`;
        await fixture(
            [markdown],
            async ({ service, input, execution, model, root }) => {
                const generated = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(generated.findings.length, 1);
                assert.equal(generated.findings[0].id, "FO1");
                assert.equal(generated.coverage.complete, true);
                assert.deepEqual(
                    generated.coverage.verificationMissing,
                    output.coverage.verificationMissing
                );
                assert.equal(model.prompts.length, 1);
            }
        );
    });
    it("accepts a Markdown-only native turn without asking for duplicated JSON prose", async function () {
        const original = result();
        const markdown =
            original.report +
            `\n<!-- review-result ${JSON.stringify({ coverage: original.coverage, accounting: [], recommendation: "approve" })} -->\n`;
        await fixture(
            [markdown],
            async ({ service, input, execution, model, root }) => {
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(model.prompts.length, 1);
                assert.deepEqual(output.findings, []);
                assert.equal(output.coverage.complete, true);
                assert.equal(output.sessionId, "owned-session");
                assert.equal(output.report.trim(), original.report.trim());
            }
        );
    });
    it("provides the model its remaining budget and deadline", async function () {
        await fixture(
            [result()],
            async ({ service, input, execution, model, root }) => {
                const before = Date.now();
                await service.generate(input, execution, input, root);
                const bound = JSON.parse(
                    model.prompts[0].split("Controller-bound input:\n")[1]
                );
                assert.ok(
                    bound.modelBudgetRemainingMs > 0 &&
                        bound.modelBudgetRemainingMs <= 1000
                );
                assert.ok(Date.parse(bound.modelDeadlineUtc) >= before);
                assert.ok(
                    Date.parse(bound.modelDeadlineUtc) <= Date.now() + 1000
                );
                assert.equal(bound.head, input.head);
            }
        );
    });
    it("rejects complete coverage after a permitted evidence read fails", async function () {
        await fixture(
            [
                result(),
                result(undefined, {
                    coverage: {
                        complete: false,
                        missing: ["files"],
                        files: [],
                        lenses: [],
                        behaviors: []
                    },
                    recommendation: "comment"
                })
            ],
            async ({ service, input, execution, model, root }) => {
                const route = `/repos/${input.repository.name}/pulls/${input.pr}/files`;
                stallAfterRecordedTurns(model, execution);
                const failure = new RecordedGitHub([
                    { path: route, status: 503, response: {} }
                ]);
                execution.context.exchange = failure.exchange.bind(failure);
                assert.equal(execution.context.gathered(), true);
                await assert.rejects(
                    execution.context.read(`https://api.github.com${route}`),
                    { code: "CONTEXT_UNAVAILABLE" }
                );
                failure.done();
                await assert.rejects(
                    service.generate(input, execution, input, root),
                    { code: "REVIEW_TIMEOUT" }
                );
                await assert.rejects(
                    fs.access(path.join(root, `${input.attempt}-1.json`)),
                    { code: "ENOENT" }
                );
            }
        );
    });
    it("returns a valid first result without a corrective turn", async function () {
        await fixture(
            [result()],
            async ({ service, input, model, execution, root }) => {
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(output.revision, 0);
                assert.equal(model.prompts.length, 1);
                assert.equal(execution.correctionUsed, false);
            }
        );
    });
    it("uses one fixed format correction on the original session and cumulative budget", async function () {
        await fixture(
            ["invalid JSON", result()],
            async ({ service, input, model, execution, root }) => {
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(output.revision, 0);
                assert.equal(output.sessionId, "owned-session");
                assert.equal(model.prompts.length, 2);
                assert.ok(model.prompts[0].includes(service.instructions));
                assert.ok(!model.prompts[1].includes(service.instructions));
                assert.ok(model.prompts[1].includes("Validation feedback:"));
                const timing = JSON.parse(
                    model.prompts[1].split("\nController timing: ")[1]
                );
                assert.ok(
                    timing.modelBudgetRemainingMs > 0 &&
                        timing.modelBudgetRemainingMs <= 1000
                );
                assert.equal(execution.budget.durations.length, 2);
                assert.equal(execution.correctionUsed, false);
            }
        );
    });
    it("repairs more than one invalid output on the same cumulative budget", async function () {
        await fixture(
            ["invalid JSON", "still invalid", result()],
            async ({ service, input, model, execution, root }) => {
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(model.prompts.length, 3);
                assert.equal(output.evidence.durations.turns.length, 3);
                const timing = output.evidence.durations;
                assert.ok(timing.turns.every((duration) => duration > 0));
                assert.equal(
                    timing.correctionMs,
                    timing.turns[1] + timing.turns[2]
                );
                assert.equal(
                    timing.modelMs,
                    timing.turns.reduce((sum, duration) => sum + duration, 0)
                );
                assert.equal(
                    timing.assessmentMs + timing.gatheringMs,
                    timing.turns[0]
                );
                assert.equal(timing.modelMs, execution.budget.consumed);
                const firstRepair = JSON.parse(
                    model.prompts[1].split("\nController timing: ")[1]
                );
                const secondRepair = JSON.parse(
                    model.prompts[2].split("\nController timing: ")[1]
                );
                assert.ok(
                    secondRepair.modelBudgetRemainingMs <=
                        firstRepair.modelBudgetRemainingMs
                );
                assert.equal(execution.correctionUsed, false);
                await fs.access(path.join(root, `${input.attempt}-0.json`));
            }
        );
    });
    it("continues a review that incorrectly counts resolved threads as missing evidence", async function () {
        const generated = result();
        generated.recommendation = "comment";
        generated.coverage.complete = false;
        generated.coverage.missing.push(
            "132 replies in controller-listed resolved threads"
        );
        await fixture(
            [generated, result()],
            async ({ service, input, model, execution, root }) => {
                const completed = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(completed.coverage.complete, true);
                assert.equal(model.prompts.length, 2);
                assert.match(
                    model.prompts[1],
                    /resolved threads are intentionally out of scope/
                );
            }
        );
    });
    it("rejects complete coverage when a required discussion collection was never read", async function () {
        await fixture(
            [
                result(),
                result(undefined, {
                    coverage: {
                        complete: false,
                        missing: ["reviews"],
                        files: [],
                        lenses: [],
                        behaviors: []
                    },
                    recommendation: "comment"
                })
            ],
            async ({ service, input, model, execution, root }) => {
                execution.context.budget.sources =
                    execution.context.budget.sources.filter(
                        (source) => !source.url.endsWith("/reviews")
                    );
                stallAfterRecordedTurns(model, execution);
                await assert.rejects(
                    service.generate(input, execution, input, root),
                    { code: "REVIEW_TIMEOUT" }
                );
                assert.equal(model.prompts.length, 2);
                await assert.rejects(
                    fs.access(path.join(root, `${input.attempt}-1.json`)),
                    { code: "ENOENT" }
                );
            }
        );
    });
    it("fails report persistence with DISK_FULL and does not retry the model", async function () {
        await fixture(
            [result()],
            async ({ service, input, model, execution, root }) => {
                const original = fs.writeFile;
                try {
                    // The only mocked boundary is the explicitly approved ENOSPC write.
                    fs.writeFile = async (file, ...args) => {
                        if (String(file).includes("-review.md.")) {
                            const error = new Error("No space left");
                            error.code = "ENOSPC";
                            throw error;
                        }
                        return original(file, ...args);
                    };
                    await assert.rejects(
                        service.generate(input, execution, input, root),
                        { code: "DISK_FULL", message: "Disk is full." }
                    );
                    assert.equal(model.prompts.length, 1);
                    await assert.rejects(
                        fs.access(
                            path.join(root, `${input.attempt}-0-review.md`)
                        ),
                        { code: "ENOENT" }
                    );
                } finally {
                    fs.writeFile = original;
                }
            }
        );
    });
    it("fails mandatory draft persistence before accepting a result or retrying the model", async function () {
        const output = result();
        const draft =
            output.report +
            `\n<!-- review-result ${JSON.stringify({ coverage: output.coverage, accounting: [], recommendation: "approve", errors: [] })} -->`;
        await fixture(
            [draft],
            async ({ service, input, model, execution, root }) => {
                const original = fs.writeFile;
                try {
                    // Only the storage syscall is fault-injected; validation and persistence remain real.
                    fs.writeFile = async (file, ...args) => {
                        if (String(file).includes("-draft-0.md.")) {
                            const error = new Error("No space left");
                            error.code = "ENOSPC";
                            throw error;
                        }
                        return original(file, ...args);
                    };
                    await assert.rejects(
                        service.generate(input, execution, input, root),
                        { code: "DISK_FULL" }
                    );
                    assert.equal(model.prompts.length, 1);
                    assert.equal(execution.result, undefined);
                    await assert.rejects(
                        fs.access(path.join(root, `${input.attempt}-0.json`)),
                        { code: "ENOENT" }
                    );
                    await assert.rejects(
                        fs.access(
                            path.join(root, `${input.attempt}-0-draft-0.md`)
                        ),
                        { code: "ENOENT" }
                    );
                } finally {
                    fs.writeFile = original;
                }
            }
        );
    });
    it("preserves the first draft when a later repair draft cannot be written", async function () {
        const originalDraft = "Malformed first draft retained for recovery.";
        await fixture(
            [originalDraft, "Second draft"],
            async ({ service, input, model, execution, root }) => {
                const original = fs.writeFile;
                try {
                    fs.writeFile = async (file, ...args) => {
                        if (String(file).includes("-draft-1.md.")) {
                            const error = new Error("No space left");
                            error.code = "ENOSPC";
                            throw error;
                        }
                        return original(file, ...args);
                    };
                    await assert.rejects(
                        service.generate(input, execution, input, root),
                        { code: "DISK_FULL" }
                    );
                    assert.equal(model.prompts.length, 2);
                    assert.equal(execution.result, undefined);
                    assert.equal(
                        await fs.readFile(
                            path.join(root, `${input.attempt}-0-draft-0.md`),
                            "utf8"
                        ),
                        originalDraft
                    );
                    await assert.rejects(
                        fs.access(path.join(root, `${input.attempt}-0.json`)),
                        { code: "ENOENT" }
                    );
                } finally {
                    fs.writeFile = original;
                }
            }
        );
    });
});
