const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const { Worktrees } = require("../../worktrees");
const { request } = require("./records");
function command(root, args) {
    return execFileSync(
        "git",
        [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.name=Review Fixture",
            "-c",
            "user.email=review-fixture@example.invalid",
            "-C",
            root,
            ...args
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
}
async function gitFixture(body, { holdFetch = false } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-git-"));
    let child;
    try {
        const source = path.join(root, "source"),
            remoteRoot = path.join(root, "remote"),
            remote = path.join(remoteRoot, "repo.git");
        await fs.mkdir(source);
        await fs.mkdir(remoteRoot);
        command(source, ["init", "-b", "main"]);
        await fs.writeFile(
            path.join(source, "README.md"),
            "Original source.\n"
        );
        command(source, ["add", "README.md"]);
        command(source, ["commit", "-m", "Initial fixture"]);
        const base = command(source, ["rev-parse", "HEAD"]);
        command(source, ["checkout", "-b", "feature"]);
        await fs.writeFile(
            path.join(source, "README.md"),
            "Reviewed source.\n"
        );
        command(source, ["commit", "-am", "Feature fixture"]);
        const head = command(source, ["rev-parse", "HEAD"]);
        command(source, ["clone", "--bare", source, remote]);
        command(remote, ["update-ref", "refs/pull/6/head", head]);
        child = spawn(
            process.execPath,
            [
                path.join(__dirname, "git-http-server.js"),
                remoteRoot,
                holdFetch ? "hold" : "run"
            ],
            {
                env: { PATH: process.env.PATH },
                stdio: ["ignore", "pipe", "pipe", "ipc"]
            }
        );
        const fetchHeld = holdFetch
            ? once(child, "message")
            : Promise.resolve();
        const releaseFetch = () => {
            if (child?.connected) child.send("release");
        };
        const exited = once(child, "exit");
        let errors = "";
        child.stderr.on("data", (chunk) => {
            errors += chunk.toString();
        });
        const [ready] = await once(child.stdout, "data");
        const port = Number(ready.toString().trim());
        if (!Number.isInteger(port))
            throw new Error("Git fixture did not bind a port");
        const owner = new Worktrees(path.join(root, "owned"), {
            1: `http://127.0.0.1:${port}/repo.git`
        });
        await owner.initialize();
        const input = request({
            repository: { id: 1, name: "owner/repo" },
            head,
            base,
            mergeBase: base
        });
        const pull = {
            number: 6,
            head: { sha: head },
            base: { ref: "main", repo: { id: 1, full_name: "owner/repo" } }
        };
        await body({
            root,
            source,
            remote,
            owner,
            input,
            pull,
            command,
            fetchHeld,
            releaseFetch
        });
        child.kill("SIGTERM");
        const [code] = await exited;
        if (code !== 0 || errors)
            throw new Error("Git fixture shutdown failed: " + errors);
        child = null;
    } finally {
        if (child) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
        }
        await fs.rm(root, { recursive: true });
    }
}
module.exports = { gitFixture };
