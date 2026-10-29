const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { gitFixture } = require("../fixtures/git");
const { RecordedGitHub } = require("../fixtures/github");
const { Sessions } = require("../../sessions");
const { LifecycleCleanup } = require("../../cleanup");
const { prepareWorkspace } = require("../../workspace");
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
async function cleanupFixture(
    body,
    previous = { sessionId: "registered-session" }
) {
    await gitFixture(async ({ owner, input, pull, root }) => {
        const tree = await owner.prepare(input, pull);
        const sessions = new Sessions(path.join(root, "sessions"), DEFAULTS);
        await sessions.initialize();
        sessions.previous.set("1-6", previous);
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
            deleteNative: async (id, provider) => {
                deleted.push(id);
                providers.push(provider);
            }
        });
        const providers = [];
        try {
            await body({ cleanup, tree, deleted, providers, root, wire });
        } finally {
            await sessions.close();
        }
    });
}
describe("review owned lifecycle cleanup", function () {
    it("preserves ownership after native deletion fails and retries successfully", async function () {
        await cleanupFixture(async ({ cleanup, tree, deleted, wire }) => {
            const records = structuredClone(wire.records),
                remove = cleanup.deleteNative;
            cleanup.deleteNative = async () => {
                throw new Error("native deletion unavailable");
            };
            assert.equal((await cleanup.run()).deleted, 0);
            await fs.access(tree.checkout);
            const manifest = JSON.parse(
                await fs.readFile(
                    path.join(cleanup.worktrees.root, "pr-1-6.json"),
                    "utf8"
                )
            );
            assert.notEqual(manifest.nativeDeleted, true);
            assert.deepEqual(deleted, []);
            cleanup.deleteNative = remove;
            wire.records.push(...records);
            assert.equal((await cleanup.run()).deleted, 1);
            assert.deepEqual(deleted, ["registered-session"]);
            await assert.rejects(fs.access(tree.checkout));
            wire.done();
        });
    });
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
            // The closed PR's workspace goes; another PR's scratch notes stay.
            const stateRoot = path.dirname(cleanup.worktrees.root);
            const workspace = await prepareWorkspace(
                stateRoot,
                "1-6",
                tree.checkout
            );
            await fs.writeFile(path.join(workspace.scratch, "note"), "gone");
            const siblingNote = path.join(
                stateRoot,
                "workspaces",
                "1-7",
                "scratch",
                "note"
            );
            await fs.mkdir(path.dirname(siblingNote), { recursive: true });
            await fs.writeFile(siblingNote, "keep");
            const summary = await cleanup.run();
            assert.equal(summary.deleted, 1);
            assert.deepEqual(deleted, ["registered-session"]);
            await assert.rejects(fs.access(tree.checkout), { code: "ENOENT" });
            assert.equal(await fs.readFile(sentinel, "utf8"), "keep");
            await assert.rejects(
                fs.access(path.join(stateRoot, "workspaces", "1-6")),
                { code: "ENOENT" }
            );
            assert.equal(await fs.readFile(siblingNote, "utf8"), "keep");
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
            const original = await fs.readFile(
                path.join(tree.checkout, "README.md")
            );
            const records = structuredClone(wire.records);
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
            await fs.writeFile(path.join(tree.checkout, "README.md"), original);
            wire.records.push(...records);
            const restarted = new LifecycleCleanup({
                worktrees: cleanup.worktrees,
                sessions: cleanup.sessions,
                repositories: null,
                limits: DEFAULTS,
                exchange: wire.exchange.bind(wire),
                deleteNative: async (id) => deleted.push(id)
            });
            assert.equal((await restarted.run()).deleted, 1);
            assert.deepEqual(deleted, ["registered-session"]);
            await assert.rejects(fs.access(tree.checkout));
            wire.done();
        });
    });
    it("deletes each closed PR's native session with the provider that created it", async function () {
        await cleanupFixture(
            async ({ cleanup, deleted, providers }) => {
                assert.equal((await cleanup.run()).deleted, 1);
                assert.deepEqual(deleted, ["claude-session"]);
                assert.deepEqual(providers, ["claude"]);
            },
            { sessionId: "claude-session", sessionProvider: "claude" }
        );
        await cleanupFixture(async ({ cleanup, providers }) => {
            assert.equal((await cleanup.run()).deleted, 1);
            // Records saved before provider selection hold Codex sessions.
            assert.deepEqual(providers, ["codex"]);
        });
    });
});
