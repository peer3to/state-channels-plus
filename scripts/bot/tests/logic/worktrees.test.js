const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { gitFixture } = require("../fixtures/git");
describe("review worktree ownership", function () {
    it("fetches exact PR and base refs into a detached owned worktree", async function () {
        await gitFixture(async ({ owner, input, pull, command }) => {
            const tree = await owner.prepare(input, pull);
            assert.equal(
                command(tree.checkout, ["rev-parse", "HEAD"]),
                input.head
            );
            assert.equal(tree.base, input.base);
            assert.equal(tree.mergeBase, input.mergeBase);
            assert.equal(
                command(tree.checkout, ["branch", "--show-current"]),
                ""
            );
        });
    });
    it("rejects an old head after the actual PR ref is force moved", async function () {
        await gitFixture(async ({ owner, input, pull, remote, command }) => {
            command(remote, ["update-ref", "refs/pull/6/head", input.base]);
            await assert.rejects(owner.prepare(input, pull), {
                code: "STALE_HEAD"
            });
            await assert.rejects(fs.access(path.join(owner.root, "pr-1-6")), {
                code: "ENOENT"
            });
        });
    });
    it("preserves reports across head changes and rejects unexpected tracked edits", async function () {
        await gitFixture(async ({ owner, input, pull }) => {
            const tree = await owner.prepare(input, pull);
            const reports = path.join(
                tree.checkout,
                "temp/pr-github-reviews/6"
            );
            await fs.mkdir(reports, { recursive: true });
            await fs.writeFile(
                path.join(reports, "attempt-review.md"),
                "Recorded review"
            );
            await owner.prepare(input, pull);
            assert.equal(
                await fs.readFile(
                    path.join(reports, "attempt-review.md"),
                    "utf8"
                ),
                "Recorded review"
            );
            await fs.writeFile(
                path.join(tree.checkout, "README.md"),
                "Unexpected tracked edit"
            );
            await assert.rejects(owner.prepare(input, pull));
            assert.equal(
                await fs.readFile(
                    path.join(tree.checkout, "README.md"),
                    "utf8"
                ),
                "Unexpected tracked edit"
            );
        });
    });
    it("deletes only manifest-owned worktree resources and retains sibling sentinels", async function () {
        await gitFixture(async ({ owner, input, pull, root }) => {
            const tree = await owner.prepare(input, pull);
            const sentinel = path.join(root, "developer-sentinel");
            await fs.writeFile(sentinel, "keep");
            const { checkout, ...record } = tree;
            await owner.remove(record);
            await assert.rejects(fs.access(checkout), { code: "ENOENT" });
            assert.equal(await fs.readFile(sentinel, "utf8"), "keep");
        });
    });
    it("rejects a missing PR ref without fetching a bare SHA", async function () {
        await gitFixture(async ({ owner, input, pull, remote, command }) => {
            command(remote, ["update-ref", "-d", "refs/pull/6/head"]);
            await assert.rejects(owner.prepare(input, pull), {
                code: "SERVICE_UNAVAILABLE"
            });
            await assert.rejects(fs.access(path.join(owner.root, "pr-1-6")), {
                code: "ENOENT"
            });
        });
    });
    it("rejects an invalid base ref without executing its text", async function () {
        await gitFixture(async ({ owner, input, pull, root }) => {
            await assert.rejects(
                owner.prepare(input, {
                    ...pull,
                    base: { ...pull.base, ref: "main; touch escaped" }
                }),
                { code: "INVALID_REQUEST" }
            );
            await assert.rejects(fs.access(path.join(root, "escaped")), {
                code: "ENOENT"
            });
        });
    });
    it("keeps repository identity across an authorized repository rename", async function () {
        await gitFixture(async ({ owner, input, pull }) => {
            const first = await owner.prepare(input, pull);
            const renamed = await owner.prepare(
                {
                    ...input,
                    repository: { ...input.repository, name: "owner/renamed" }
                },
                {
                    ...pull,
                    base: {
                        ...pull.base,
                        repo: { ...pull.base.repo, full_name: "owner/renamed" }
                    }
                }
            );
            assert.equal(first.checkout, renamed.checkout);
            assert.equal(first.repositoryId, renamed.repositoryId);
        });
    });
    it("records an advanced target tip without changing the immutable review head", async function () {
        await gitFixture(
            async ({ owner, input, pull, source, remote, command }) => {
                command(source, ["checkout", "main"]);
                await fs.writeFile(
                    path.join(source, "base-only.md"),
                    "Target-only change\n"
                );
                command(source, ["add", "base-only.md"]);
                command(source, ["commit", "-m", "Advance target"]);
                command(source, ["push", remote, "main"]);
                const tree = await owner.prepare(input, pull);
                assert.equal(tree.head, input.head);
                assert.equal(tree.mergeBase, input.mergeBase);
                assert.notEqual(tree.base, input.base);
            }
        );
    });
    it("rejects unrelated source ancestry during preparation", async function () {
        await gitFixture(
            async ({ owner, input, pull, source, remote, command }) => {
                command(source, ["checkout", "--orphan", "unrelated"]);
                command(source, ["rm", "-rf", "."]);
                await fs.writeFile(
                    path.join(source, "other.md"),
                    "Unrelated history\n"
                );
                command(source, ["add", "other.md"]);
                command(source, ["commit", "-m", "Unrelated root"]);
                command(source, ["push", remote, "unrelated:main", "--force"]);
                await assert.rejects(owner.prepare(input, pull), {
                    code: "SERVICE_UNAVAILABLE"
                });
            }
        );
    });
    it("rejects expired setup ownership before any Git preparation", async function () {
        await gitFixture(async ({ owner, input, pull }) => {
            await assert.rejects(owner.prepare(input, pull, 0), {
                code: "SETUP_TIMEOUT"
            });
        });
    });
});
