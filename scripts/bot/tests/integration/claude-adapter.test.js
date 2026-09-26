const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
    BUILT_IN,
    ClaudeAdapter,
    TOOL_NAMES
} = require("../../adapters/claude");
const { configuration } = require("../../config");
const { ContextBudget, PublicGitHub } = require("../../github-read");
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
// One probe tool call through the real adapter; returns what the model received.
async function probeResult(model, length, withWorkspace = false) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-cap-"));
    const config = configuration({
        stateRoot: path.join(root, "state"),
        provider: "claude",
        model,
        claudePath: path.join(__dirname, "../fixtures/claude-peer.js")
    });
    const workspace = withWorkspace
        ? Object.fromEntries(
              ["source", "git", "github", "scratch"].map((name) => [
                  name,
                  path.join(root, name)
              ])
          )
        : null;
    for (const directory of Object.values(workspace || {}))
        await fs.mkdir(directory, { recursive: true });
    // {"v":"…"} serialises to exactly `length` characters.
    const value = { v: "x".repeat(length - 8) };
    // A real reader supplies the canonical URL the snapshot is saved under.
    const publicGitHub = new PublicGitHub(
        { id: 1, name: "owner/repo" },
        6,
        new ContextBudget(config.limits)
    );
    const adapter = new ClaudeAdapter(
        config,
        { call: async () => value, close: async () => {}, publicGitHub },
        workspace
    );
    try {
        await adapter.open();
        const id = await adapter.session(null, "Result size probe.");
        await adapter.turn("Probe.", new ModelBudget(20000));
        const native = JSON.parse(
            await fs.readFile(
                path.join(config.runtimeRoot, `${id}.json`),
                "utf8"
            )
        );
        return { ...native.probe, workspace };
    } finally {
        await adapter.stop();
        await fs.rm(root, { recursive: true, force: true });
    }
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
    it("runs the review in the sandboxed workspace with the configured model and effort and the model's own tools", async function () {
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
                // The model keeps its own tools, runs headless in scratch, and
                // the sandbox hides secrets, blocks network and writes elsewhere.
                const workspace = path.join(
                    service.config.stateRoot,
                    "workspaces",
                    service.sessions.key(input)
                );
                const scratch = path.join(workspace, "scratch");
                assert.deepEqual(native.builtInTools, BUILT_IN);
                assert.equal(native.cwd, scratch);
                assert.equal(native.permissionPrompts, "none");
                const { sandbox, permissions } = native.settings;
                assert.equal(sandbox.enabled, true);
                assert.equal(sandbox.failIfUnavailable, true);
                assert.equal(sandbox.allowUnsandboxedCommands, false);
                assert.deepEqual(sandbox.network.allowedDomains, []);
                assert.ok(
                    sandbox.filesystem.denyRead.includes(`/${os.homedir()}`)
                );
                assert.deepEqual(sandbox.filesystem.allowWrite, [
                    `/${scratch}`
                ]);
                // The worker's own checkout of the PR head stays read-only.
                assert.ok(
                    sandbox.filesystem.denyWrite.includes(
                        `/${path.join(service.config.stateRoot, "worktrees", `pr-${input.repository.id}-${input.pr}`)}`
                    )
                );
                assert.equal(
                    permissions.blockReadsOutsideWorkingDirectories,
                    true
                );
                assert.deepEqual(permissions.deny, ["WebFetch", "WebSearch"]);
                // The discussion was fetched once into the read-only snapshot.
                const snapshot = await fs.readdir(
                    path.join(workspace, "github")
                );
                for (const name of [
                    `pulls-${input.pr}.json`,
                    `issues-${input.pr}-comments.json`,
                    `pulls-${input.pr}-comments.json`,
                    `pulls-${input.pr}-reviews.json`,
                    `pulls-${input.pr}-files.json`,
                    `pulls-${input.pr}-commits.json`
                ])
                    assert.ok(snapshot.includes(name), name);
                assert.equal(native.instructions, service.instructions);
                // Claude Code keeps its default result caps.
                assert.equal(native.maxMcpOutputTokens, undefined);
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
                assert.equal(
                    (await fs.readdir(service.config.runtimeRoot)).filter(
                        (file) => file.endsWith("-settings.json")
                    ).length,
                    0
                );
            },
            { provider: "claude" }
        );
    });
    it("delivers a tool result of exactly 30,000 characters unchanged", async function () {
        const probe = await probeResult("probe-source-model", 30000);
        assert.equal(probe.isError, false);
        assert.equal(probe.length, 30000);
    });
    it("replaces a result far above the CLI's default caps with the recoverable error, never a preview", async function () {
        const probe = await probeResult("probe-source-model", 100000);
        assert.equal(probe.isError, true);
        assert.match(probe.text, /RESULT_TOO_LARGE/);
    });
    it("returns a recoverable error naming the snapshot file for a GitHub page over 30,000 characters", async function () {
        const probe = await probeResult("probe-github-model", 30001, true);
        assert.equal(probe.isError, true);
        assert.match(probe.text, /RESULT_TOO_LARGE/);
        assert.ok(
            probe.text.includes(`${probe.workspace.github}/pulls-6-files.json`),
            probe.text
        );
    });
    it("names the saved snapshot file for a browser PR files link and a numeric repository link", async function () {
        const browser = await probeResult(
            "probe-github-browser-model",
            30001,
            true
        );
        assert.ok(
            browser.text.includes(
                `${browser.workspace.github}/pulls-6-files.json`
            ),
            browser.text
        );
        const numeric = await probeResult(
            "probe-github-repositories-model",
            30001,
            true
        );
        assert.ok(
            numeric.text.includes(
                `${numeric.workspace.github}/pulls-6-comments.page-2.json`
            ),
            numeric.text
        );
    });
    it("gives source listing and search results over 30,000 characters their own recovery advice", async function () {
        const list = await probeResult("probe-list-model", 30001, true);
        assert.equal(list.isError, true);
        assert.match(list.text, /git ls-files/);
        assert.doesNotMatch(list.text, /start\/count/);
        const search = await probeResult("probe-search-model", 30001, true);
        assert.match(search.text, /git grep/);
    });
    it("returns a recoverable error pointing at a narrower read for source over 30,000 characters", async function () {
        const probe = await probeResult("probe-source-model", 30001, true);
        assert.equal(probe.isError, true);
        assert.match(probe.text, /RESULT_TOO_LARGE/);
        assert.match(probe.text, /narrower start\/count/);
        assert.ok(probe.text.includes(probe.workspace.source), probe.text);
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
    it("repairs a fixed finding without evidence in the same session before returning it", async function () {
        await executionFixture(
            async ({ service, connected, input }) => {
                await publishFinding(service, input);
                service.config.model = "fix-without-evidence-model";
                const message = await request(await connected, input, "fix");
                assert.equal(
                    message.operation,
                    "result",
                    JSON.stringify(message.value)
                );
                const [finding] = message.value.findings;
                assert.equal(finding.id, "R1FO1");
                assert.equal(finding.status, "fixed");
                assert.ok(finding.evidence.length > 0);
                const native = await thread(service, message.value.sessionId);
                // One review turn plus one repair turn on the same session.
                assert.equal(native.turns, 2);
            },
            { provider: "claude" }
        );
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
    it("stops the review when the CLI session exposes a tool beyond its sandboxed set", async function () {
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
