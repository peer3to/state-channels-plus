const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { gitFixture } = require("../fixtures/git");
const { RecordedGitHub } = require("../fixtures/github");
const { Sessions } = require("../../sessions");
const { LifecycleCleanup } = require("../../cleanup");
const { DEFAULTS } = require("../../config");
function closed(input) {
    return {
        number: input.pr,
        state: "closed",
        base: {
            repo: { id: input.repository.id, full_name: input.repository.name }
        }
    };
}
async function cleanupFixture(body) {
    await gitFixture(async ({ owner, input, pull, root }) => {
        const tree = await owner.prepare(input, pull);
        const sessions = new Sessions(path.join(root, "sessions"), DEFAULTS);
        await sessions.initialize();
        sessions.previous.set("1-6", { sessionId: "registered-session" });
        const prefix = `/repos/${input.repository.name}`;
        const wire = new RecordedGitHub([
            {
                path: `${prefix}/pulls?state=all&per_page=100`,
                response: [closed(input)]
            },
            { path: `${prefix}/pulls/6`, response: closed(input) }
        ]);
        const deleted = [];
        const cleanup = new LifecycleCleanup({
            worktrees: owner,
            sessions,
            repositories: null,
            limits: DEFAULTS,
            exchange: wire.exchange.bind(wire),
            deleteNative: async (id) => {
                deleted.push(id);
            }
        });
        try {
            await body({ cleanup, tree, deleted, root, wire });
        } finally {
            await sessions.close();
        }
    });
}
describe("review owned lifecycle cleanup", function () {
    it("deletes the registered closed PR worktree and exact native session while preserving siblings", async function () {
        await cleanupFixture(async ({ cleanup, tree, deleted, root, wire }) => {
            const sentinel = path.join(root, "unregistered-developer-data");
            await fs.writeFile(sentinel, "keep");
            const journal = path.join(
                cleanup.sessions.root,
                "1-6-publication.json"
            );
            const sibling = path.join(
                cleanup.sessions.root,
                "1-7-publication.json"
            );
            await fs.writeFile(journal, JSON.stringify({ states: [] }));
            await fs.writeFile(sibling, JSON.stringify({ states: [] }));
            const summary = await cleanup.run();
            assert.equal(summary.deleted, 1);
            assert.deepEqual(deleted, ["registered-session"]);
            await assert.rejects(fs.access(tree.checkout), { code: "ENOENT" });
            assert.equal(await fs.readFile(sentinel, "utf8"), "keep");
            await assert.rejects(fs.access(journal), { code: "ENOENT" });
            assert.deepEqual(JSON.parse(await fs.readFile(sibling, "utf8")), {
                states: []
            });
            wire.done();
            const again = await cleanup.run();
            assert.equal(again.registered, 0);
            assert.deepEqual(deleted, ["registered-session"]);
        });
    });
    it("retains the native deletion ledger when unexpected worktree edits defer cleanup", async function () {
        await cleanupFixture(async ({ cleanup, tree, deleted, wire }) => {
            await fs.writeFile(
                path.join(tree.checkout, "README.md"),
                "Unexpected developer edit"
            );
            const summary = await cleanup.run();
            assert.equal(summary.deleted, 0);
            assert.equal(summary.deferred, 1);
            assert.deepEqual(deleted, ["registered-session"]);
            const manifest = JSON.parse(
                await fs.readFile(
                    path.join(cleanup.worktrees.root, "pr-1-6.json"),
                    "utf8"
                )
            );
            assert.equal(manifest.nativeDeleted, true);
            assert.equal(
                await fs.readFile(
                    path.join(tree.checkout, "README.md"),
                    "utf8"
                ),
                "Unexpected developer edit"
            );
            wire.done();
        });
    });
});
