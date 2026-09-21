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
describe("pinned native adapter acceptance", function () {
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
