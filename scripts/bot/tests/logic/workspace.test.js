const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { checkReadRoots, snapshotName } = require("../../workspace");
const { sandboxArgs } = require("../../adapters/codex");
const { sandboxSettings } = require("../../adapters/claude");

// Runs body with HOME and the node executable path pointed at a fake home.
async function withFakeHome(body) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "review-home-"));
    const previous = { home: process.env.HOME, execPath: process.execPath };
    process.env.HOME = home;
    try {
        await body(home);
    } finally {
        process.env.HOME = previous.home;
        process.execPath = previous.execPath;
        await fs.rm(home, { recursive: true, force: true });
    }
}
function workspaceUnder(root) {
    return {
        source: path.join(root, "worktrees", "pr-1-6"),
        git: path.join(root, "worktrees", "repo-1.git"),
        github: path.join(root, "workspaces", "1-6", "github"),
        scratch: path.join(root, "workspaces", "1-6", "scratch")
    };
}

describe("review workspace sandbox roots", function () {
    it("rejects a readable root that equals or contains a secret path and accepts narrower ones", function () {
        const secrets = ["/home/u", "/home/u/.codex", "/srv/work"];
        for (const root of ["/home/u", "/home", "/", "/srv/work"])
            assert.throws(() => checkReadRoots([root], secrets), {
                code: "ISOLATION_UNVERIFIED"
            });
        for (const root of [
            "/home/u/.nvm/versions/node/v22",
            "/home/u/.codex/packages/standalone/releases/0.156.1",
            "/usr/local",
            "/srv/work/review/workspaces/1-6/scratch"
        ])
            assert.deepEqual(checkReadRoots([root], secrets), [root]);
    });
    it("refuses a Claude sandbox when node is installed directly under the home folder", async function () {
        await withFakeHome(async (home) => {
            process.execPath = path.join(home, "bin", "node");
            assert.throws(
                () =>
                    sandboxSettings(
                        workspaceUnder(path.join(home, "work", "review")),
                        path.join(home, "work", "review")
                    ),
                { code: "ISOLATION_UNVERIFIED" }
            );
            process.execPath = path.join(
                home,
                ".nvm",
                "versions",
                "node",
                "v22",
                "bin",
                "node"
            );
            const settings = sandboxSettings(
                workspaceUnder(path.join(home, "work", "review")),
                path.join(home, "work", "review")
            );
            assert.ok(
                settings.sandbox.filesystem.denyRead.includes(`/${home}`)
            );
        });
    });
    it("refuses a Codex sandbox when codex is installed directly under the home folder", async function () {
        await withFakeHome(async (home) => {
            process.execPath = "/usr/local/bin/node";
            const codex = path.join(home, "bin", "codex");
            await fs.mkdir(path.dirname(codex), { recursive: true });
            await fs.writeFile(codex, "#!/bin/sh\n", { mode: 0o755 });
            const stateRoot = path.join(home, "work", "review");
            assert.throws(
                () => sandboxArgs(workspaceUnder(stateRoot), codex, stateRoot),
                { code: "ISOLATION_UNVERIFIED" }
            );
            const nested = path.join(home, ".codex", "releases", "v1", "bin");
            await fs.mkdir(nested, { recursive: true });
            await fs.writeFile(path.join(nested, "codex"), "#!/bin/sh\n", {
                mode: 0o755
            });
            const args = sandboxArgs(
                workspaceUnder(stateRoot),
                path.join(nested, "codex"),
                stateRoot
            );
            assert.ok(
                args.some((arg) => arg.includes('"write"')),
                JSON.stringify(args)
            );
        });
    });
    it("names snapshot files after the API route and page", function () {
        assert.equal(
            snapshotName(
                "https://api.github.com/repos/o/r/pulls/6/comments?per_page=100&page=2"
            ),
            "pulls-6-comments.page-2.json"
        );
        assert.equal(
            snapshotName(
                "https://api.github.com/repos/o/r/pulls/6?per_page=100"
            ),
            "pulls-6.json"
        );
    });
});
