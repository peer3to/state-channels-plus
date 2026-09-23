const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ClaudeAdapter, TOOL_NAMES } = require("../../adapters/claude");
const { configuration } = require("../../config");
const { ModelBudget } = require("../../timing");
const { request: requestRecord } = require("../fixtures/records");
const { digest } = require("../../data");
const { ReviewService } = require("../../server");
const {
    executionFixture,
    waitForFile
} = require("../fixtures/review-execution");

async function request(connection, input, requestId) {
    const response = once(connection, "payload");
    await connection.send("request", requestId, input.attempt, input);
    return (await response)[0];
}
async function thread(service, sessionId) {
    return JSON.parse(
        await fs.readFile(
            path.join(service.config.runtimeRoot, `${sessionId}.json`),
            "utf8"
        )
    );
}
// A published open finding the next review must account for.
async function publishFinding(service, input) {
    await service.publications.save(input, digest({ states: [] }), [
        {
            version: 1,
            repositoryId: input.repository.id,
            pr: input.pr,
            head: input.base,
            round: 1,
            status: "complete",
            findings: [
                {
                    id: "R1FO1",
                    status: "continued",
                    body: "🟠 **[R1FO1] Retry loses pending work.**",
                    path: null,
                    line: null,
                    threadId: null,
                    evidence: ["pending retry"],
                    human: null
                }
            ],
            actions: [],
            mappings: {}
        }
    ]);
}
async function startedInput(service, input) {
    return (
        await waitForFile(
            path.join(service.config.runtimeRoot, `started-${input.pr}.json`)
        )
    ).input;
}
// Continue the PR with a restarted worker, as a later review would.
async function nextReview(service, tree, input, provider) {
    // Drop the first review's marker so the next one is read, not the stale one.
    await fs.unlink(
        path.join(service.config.runtimeRoot, `started-${input.pr}.json`)
    );
    const resumed = new ReviewService({
        stateRoot: service.config.stateRoot,
        provider,
        codexPath: service.config.codexPath,
        claudePath: service.config.claudePath
    });
    await resumed.start();
    resumed.worktrees.origins = tree.owner.origins;
    const next = { ...input, attempt: "next-review" };
    const output = await resumed.sessions.submit(
        next,
        digest("next-review"),
        (execution) => resumed.execute(next, execution),
        async () => true
    );
    return { resumed, next, output };
}

describe("Claude review adapter", function () {
    it("runs the review through the Claude CLI with the configured model and effort and only the worker source tools", async function () {
        await executionFixture(
            async ({ service, connected, input }) => {
                service.config.effort = "high";
                const message = await request(await connected, input, "claude");
                assert.equal(
                    message.operation,
                    "result",
                    JSON.stringify(message.value)
                );
                assert.equal(message.value.runtime, "claude-2.1.280");
                assert.equal(message.value.coverage.complete, true);
                const native = await thread(service, message.value.sessionId);
                assert.equal(native.model, "claude-opus-5-5");
                assert.equal(native.effort, "high");
                assert.deepEqual(native.allowedTools, TOOL_NAMES);
                assert.equal(native.instructions, service.instructions);
                // Full tool results up to the worker's own byte limit reach the
                // model instead of the CLI's 25k-token default.
                assert.equal(
                    native.maxMcpOutputTokens,
                    String(service.config.limits.maxBytes)
                );
                assert.equal(native.turns, 1);
                const active = service.sessions.slots.get(
                    service.sessions.key(input)
                ).active;
                assert.ok(active.adapter.activity.toolCalls >= 5);
                const files = await fs.readdir(service.config.runtimeRoot);
                await service.sessions.acknowledge(
                    input,
                    message.value.executionId
                );
                assert.equal(
                    (await fs.readdir(service.config.runtimeRoot)).filter(
                        (file) => file.endsWith("-instructions.md")
                    ).length,
                    0,
                    `instructions file removed after release: ${files}`
                );
            },
            { provider: "claude" }
        );
    });
    it("delivers a tool result far above the CLI's default output cap to the model", async function () {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-cap-"));
        const config = configuration({
            stateRoot: root,
            provider: "claude",
            claudePath: path.join(__dirname, "../fixtures/claude-peer.js")
        });
        // About 100 KB, four times the CLI's 25k-token default.
        const large = "x".repeat(100000);
        const adapter = new ClaudeAdapter(config, {
            call: async (name) =>
                name === "source_read"
                    ? { lines: ["Reviewed source.", large] }
                    : { data: [] },
            close: async () => {}
        });
        try {
            await adapter.open();
            await adapter.session(null, "Large result check.");
            const report = await adapter.turn(
                "Controller-bound input:\n" + JSON.stringify(requestRecord()),
                new ModelBudget(20000)
            );
            assert.match(report, /## Review completion/);
        } finally {
            await adapter.stop();
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("resumes the same Claude session for the next review of the PR", async function () {
        await executionFixture(
            async ({ service, connected, input, tree }) => {
                const first = (await request(await connected, input, "one"))
                    .value;
                await service.sessions.acknowledge(input, first.executionId);
                await publishFinding(service, input);
                await service.close();
                const { resumed, next, output } = await nextReview(
                    service,
                    tree,
                    input,
                    "claude"
                );
                try {
                    assert.equal(output.sessionId, first.sessionId);
                    // The resumed conversation already holds the finding prose.
                    const [finding] = (await startedInput(resumed, input))
                        .previousFindings;
                    assert.equal(finding.id, "R1FO1");
                    assert.equal(finding.body, undefined);
                    assert.equal(output.runtime, "claude-2.1.280");
                    assert.equal(
                        (await thread(resumed, first.sessionId)).turns,
                        2
                    );
                    await resumed.sessions.acknowledge(
                        next,
                        output.executionId
                    );
                } finally {
                    await resumed.close();
                }
            },
            { provider: "claude" }
        );
    });
    it("starts a fresh Claude conversation seeded with saved findings when the PR's session belongs to Codex", async function () {
        await executionFixture(async ({ service, connected, input, tree }) => {
            const first = (await request(await connected, input, "codex"))
                .value;
            assert.match(first.runtime, /^codex-/);
            await service.sessions.acknowledge(input, first.executionId);
            await publishFinding(service, input);
            await service.close();
            const { resumed, next, output } = await nextReview(
                service,
                tree,
                input,
                "claude"
            );
            try {
                assert.notEqual(output.sessionId, first.sessionId);
                assert.equal(output.runtime, "claude-2.1.280");
                const fresh = await thread(resumed, output.sessionId);
                assert.equal(fresh.turns, 1);
                assert.equal(fresh.model, "claude-opus-5-5");
                const [finding] = (await startedInput(resumed, input))
                    .previousFindings;
                assert.equal(
                    finding.body,
                    "🟠 **[R1FO1] Retry loses pending work.**"
                );
                assert.deepEqual(finding.evidence, ["pending retry"]);
                await resumed.sessions.acknowledge(next, output.executionId);
                const saved = JSON.parse(
                    await fs.readFile(
                        path.join(
                            resumed.sessions.root,
                            `${resumed.sessions.key(next)}.json`
                        ),
                        "utf8"
                    )
                );
                assert.equal(saved.sessionProvider, "claude");
            } finally {
                await resumed.close();
            }
        });
    });
    it("fails with MODEL_UNAVAILABLE when Claude rejects the configured model", async function () {
        await executionFixture(
            async ({ service, connected, input }) => {
                service.config.model = "unlisted-review-model";
                const message = await request(await connected, input, "bad");
                assert.equal(message.operation, "failure");
                assert.equal(message.value.code, "MODEL_UNAVAILABLE");
            },
            { provider: "claude" }
        );
    });
    it("stops the review when the CLI session exposes a tool beyond the worker source tools", async function () {
        await executionFixture(
            async ({ service, connected, input }) => {
                service.config.model = "extra-tool-model";
                const message = await request(await connected, input, "leak");
                assert.equal(message.operation, "failure");
                assert.equal(message.value.code, "ISOLATION_UNVERIFIED");
            },
            { provider: "claude" }
        );
    });
    it("refuses a CLI permission request and stops the review", async function () {
        await executionFixture(
            async ({ service, connected, input }) => {
                service.config.model = "permission-prompt-model";
                const message = await request(await connected, input, "ask");
                assert.equal(message.operation, "failure");
                assert.equal(message.value.code, "ISOLATION_UNVERIFIED");
            },
            { provider: "claude" }
        );
    });
    it("rejects a CI request that does not accept Claude before starting the CLI", async function () {
        await executionFixture(
            async ({ service, connected, input }) => {
                const message = await request(
                    await connected,
                    { ...input, runtime: "codex" },
                    "codex-only"
                );
                assert.equal(message.operation, "failure");
                assert.equal(message.value.code, "MODEL_UNAVAILABLE");
                assert.deepEqual(
                    (
                        await fs
                            .readdir(service.config.runtimeRoot)
                            .catch(() => [])
                    ).filter((file) => file.endsWith(".json")),
                    []
                );
            },
            { provider: "claude" }
        );
    });
    it("fails with LOGIN_EXPIRED before starting a session when the CLI is logged out", async function () {
        const config = await fs.mkdtemp(path.join(os.tmpdir(), "claude-cfg-"));
        const previous = process.env.CLAUDE_CONFIG_DIR;
        process.env.CLAUDE_CONFIG_DIR = config;
        await fs.writeFile(path.join(config, "logged-out"), "");
        try {
            await executionFixture(
                async ({ service, connected, input }) => {
                    const message = await request(
                        await connected,
                        input,
                        "logged-out"
                    );
                    assert.equal(message.operation, "failure");
                    assert.equal(message.value.code, "LOGIN_EXPIRED");
                    assert.equal(
                        (await fs.readdir(service.config.runtimeRoot)).filter(
                            (file) => file.startsWith("started-")
                        ).length,
                        0
                    );
                },
                { provider: "claude" }
            );
        } finally {
            if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
            else process.env.CLAUDE_CONFIG_DIR = previous;
            await fs.rm(config, { recursive: true, force: true });
        }
    });
});
