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
async function fixture(outputs, body) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-output-"));
    const service = new ReviewService({
        stateRoot: root
    });
    await service.sessions.initialize();
    const input = request();
    const model = new RecordedModelOutput(outputs);
    service.prompt = "Fixed source-only prompt.";
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
            [result(), result()],
            async ({ service, input, execution, root }) => {
                const route = `/repos/${input.repository.name}/pulls/${input.pr}/files`;
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
                    { code: "INVALID_RESULT" }
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
                assert.equal(output.revision, 1);
                assert.equal(output.sessionId, "owned-session");
                assert.equal(model.prompts.length, 2);
                assert.equal(
                    model.prompts[1].split("\nController timing: ")[0],
                    "Structured output failed these schema identifiers: schema:result. Read the original context through the permitted tools and return the complete corrected Markdown report with bookkeeping markers; do not duplicate prose as JSON findings."
                );
                const timing = JSON.parse(
                    model.prompts[1].split("\nController timing: ")[1]
                );
                assert.ok(
                    timing.modelBudgetRemainingMs > 0 &&
                        timing.modelBudgetRemainingMs <= 1000
                );
                assert.equal(execution.budget.durations.length, 2);
                assert.equal(execution.correctionUsed, true);
            }
        );
    });
    it("fails two invalid outputs without a third turn or success report", async function () {
        await fixture(
            ["invalid JSON", "still invalid"],
            async ({ service, input, model, execution, root }) => {
                await assert.rejects(
                    service.generate(input, execution, input, root),
                    { code: "INVALID_RESULT" }
                );
                assert.equal(model.prompts.length, 2);
                assert.equal(execution.correctionUsed, true);
                await assert.rejects(
                    fs.access(path.join(root, `${input.attempt}-1.json`)),
                    { code: "ENOENT" }
                );
            }
        );
    });
    it("preserves valid incomplete coverage without converting it to approval", async function () {
        const generated = result();
        generated.recommendation = "comment";
        generated.coverage.complete = false;
        generated.coverage.missing.push("thread-resolution");
        await fixture(
            [generated],
            async ({ service, input, model, execution, root }) => {
                const output = await service.generate(
                    input,
                    execution,
                    input,
                    root
                );
                assert.equal(output.coverage.complete, false);
                assert.equal(output.recommendation, "comment");
                assert.equal(model.prompts.length, 1);
            }
        );
    });
    it("rejects complete coverage when a required discussion collection was never read", async function () {
        await fixture(
            [result(), result()],
            async ({ service, input, model, execution, root }) => {
                execution.context.budget.sources =
                    execution.context.budget.sources.filter(
                        (source) => !source.url.endsWith("/reviews")
                    );
                await assert.rejects(
                    service.generate(input, execution, input, root),
                    { code: "INVALID_RESULT" }
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
});
