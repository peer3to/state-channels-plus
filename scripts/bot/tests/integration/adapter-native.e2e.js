const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
async function snapshot(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const rows = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) rows.push([entry.name, await snapshot(file)]);
        else if (entry.isSymbolicLink())
            rows.push([entry.name, await fs.readlink(file)]);
        else
            rows.push([
                entry.name,
                (await fs.readFile(file)).toString("base64")
            ]);
    }
    return rows;
}
const { CodexAdapter } = require("../../adapters/codex");
const { configuration } = require("../../config");
const { ModelBudget } = require("../../timing");
const { SourceTools } = require("../../source-tools");
const { gitFixture } = require("../fixtures/git");
describe("pinned native adapter acceptance", function () {
    it("reads tracked source through the native Code Mode gateway and releases its process group", async function () {
        assert.equal(process.env.REVIEW_NATIVE_ACCEPTANCE, "1");
        await gitFixture(async ({ root, source, input }) => {
            const config = configuration({
                stateRoot: path.join(root, "review")
            });
            const tools = new SourceTools(
                source,
                input,
                null,
                path.join(root, "reports")
            );
            const before = await snapshot(source);
            const adapter = new CodexAdapter(config, tools);
            try {
                await adapter.open();
                const args = adapter.process.child.spawnargs;
                assert.ok(
                    args.some(
                        (arg, i) =>
                            arg === "--enable" &&
                            args[i + 1] === "code_mode_host"
                    )
                );
                assert.ok(
                    args.some(
                        (arg, i) =>
                            arg === "--disable" && args[i + 1] === "shell_tool"
                    )
                );
                assert.ok(
                    args.some(
                        (arg, i) =>
                            arg === "--disable" &&
                            args[i + 1] === "unified_exec"
                    )
                );
                await adapter.session(
                    null,
                    "Authorized source-only tool integration check. Use only source_read. Do not run shell commands, access credentials, or change files."
                );
                const answer = await adapter.turn(
                    "Call source_read with path README.md, start 1, count 1. Return exactly the line you read, with no formatting or explanation.",
                    new ModelBudget(45000)
                );
                assert.ok(
                    tools.gatheringMs > 0,
                    "The real source tool must run."
                );
                assert.equal(answer.trim(), "Reviewed source.");
                assert.deepEqual(await snapshot(source), before);
            } finally {
                await adapter.stop();
            }
            assert.equal(tools.closed, true);
            assert.throws(() => process.kill(-adapter.process.child.pid, 0), {
                code: "ESRCH"
            });
        });
    });
    it("expires a shortened native turn and verifies process exit before reuse", async function () {
        assert.equal(
            process.env.REVIEW_NATIVE_ACCEPTANCE,
            "1",
            "Native acceptance requires explicit enablement and a logged-in codex on PATH; it is not a skipped pass."
        );
        assert.ok(process.env.REVIEW_WORK_ROOT);
        const config = configuration({
            stateRoot: path.resolve(process.env.REVIEW_WORK_ROOT, "review")
        });
        assert.ok(
            process.env.REVIEW_NATIVE_WORKTREE,
            "Assign an isolated source worktree for this acceptance run."
        );
        assert.ok(
            process.env.REVIEW_NATIVE_REPORT_DIR,
            "Assign an isolated report directory for this acceptance run."
        );
        const observedPaths = [
            process.env.REVIEW_NATIVE_WORKTREE,
            process.env.REVIEW_NATIVE_REPORT_DIR
        ];
        for (const root of observedPaths) assert.ok(path.isAbsolute(root));
        const before = await Promise.all(observedPaths.map(snapshot));
        const adapter = new CodexAdapter(config, {
            call: async () => {
                throw new Error(
                    "This native lifecycle probe provides no source tools."
                );
            }
        });
        try {
            await adapter.open();
            const thread = await adapter.session(
                null,
                "This is an authorized native lifecycle probe. Do not use any tools or write files."
            );
            assert.ok(thread);
            // Establish persisted history before testing reuse after interruption.
            // A brand-new thread killed after 1 ms may never reach disk.
            await adapter.turn(
                "Reply with ready. Do not use tools.",
                new ModelBudget(45000)
            );
            await assert.rejects(
                adapter.turn(
                    "Explain why immutable source revisions matter in code review. Do not use tools.",
                    new ModelBudget(1)
                ),
                { code: "REVIEW_TIMEOUT" }
            );
            assert.ok(
                adapter.process.child.exitCode !== null ||
                    adapter.process.child.signalCode !== null
            );
            assert.throws(() => process.kill(-adapter.process.child.pid, 0), {
                code: "ESRCH"
            });
            const afterExit = await Promise.all(observedPaths.map(snapshot));
            assert.deepEqual(afterExit, before);
            await delay(100);
            assert.deepEqual(
                await Promise.all(observedPaths.map(snapshot)),
                afterExit
            );
            const reopened = new CodexAdapter(config, {
                call: async () => {
                    throw new Error("No tools in this probe.");
                }
            });
            try {
                await reopened.open();
                assert.equal((await reopened.read(thread)).thread.id, thread);
                assert.equal(
                    await reopened.session(
                        thread,
                        "Resume the same owned lifecycle probe. Do not use tools."
                    ),
                    thread
                );
                await reopened.delete(thread);
            } finally {
                await reopened.stop();
            }
        } finally {
            await adapter.stop();
        }
    });
});
