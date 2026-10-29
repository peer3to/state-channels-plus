const { execFileSync, execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { check, ownedPath, writeJson } = require("./data");
const { sanitized } = require("./errors");
const SHA = /^[a-f0-9]{40}$/;
function gitInvocation(args, cwd, timeoutMs) {
    return [
        [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "protocol.file.allow=never",
            "-c",
            "protocol.ext.allow=never",
            "-c",
            "submodule.recurse=false",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "credential.helper=",
            "-c",
            "core.attributesFile=/dev/null",
            ...args
        ],
        {
            cwd,
            encoding: "utf8",
            timeout: Math.max(1, Math.min(60000, timeoutMs)),
            maxBuffer: 8 * 1024 * 1024,
            env: {
                PATH: process.env.PATH,
                HOME: cwd,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_TERMINAL_PROMPT: "0",
                GIT_LFS_SKIP_SMUDGE: "1"
            },
            stdio: ["ignore", "pipe", "pipe"]
        }
    ];
}
function gitError(error) {
    if (
        error.code === "ENOSPC" ||
        /No space left on device/.test(String(error.stderr || ""))
    )
        error.code = "ENOSPC";
    return sanitized(error);
}
function git(args, cwd, timeoutMs = 60000) {
    try {
        return execFileSync(
            "git",
            ...gitInvocation(args, cwd, timeoutMs)
        ).trim();
    } catch (error) {
        throw gitError(error);
    }
}
function gitAsync(args, cwd, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            ...gitInvocation(args, cwd, timeoutMs),
            (error, stdout, stderr) => {
                if (error) {
                    error.stderr = stderr;
                    reject(gitError(error));
                } else resolve(stdout.trim());
            }
        );
    });
}
class Worktrees {
    root;
    chain = Promise.resolve();
    origins;
    constructor(root, origins = {}) {
        this.root = root;
        this.origins = Object.freeze({ ...origins });
    }
    async initialize() {
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        this.root = await fs.realpath(this.root);
    }
    exclusive(operation) {
        const next = this.chain.then(operation);
        this.chain = next.catch(() => {});
        return next;
    }
    async prepare(request, pr, deadline = performance.now() + 300000) {
        return this.exclusive(async () => {
            const run = (args, cwd) => {
                check(performance.now() < deadline, "SETUP_TIMEOUT");
                return gitAsync(args, cwd, deadline - performance.now());
            };
            check(
                pr.number === request.pr &&
                    pr.base?.repo?.id === request.repository.id
            );
            check(pr.head?.sha === request.head, "STALE_HEAD");
            const branch = pr.base.ref;
            check(
                typeof branch === "string" &&
                    /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(branch) &&
                    !branch.includes("..") &&
                    !branch.includes("//") &&
                    !branch.endsWith("/")
            );
            const clone = await ownedPath(
                this.root,
                `repo-${request.repository.id}.git`,
                true
            );
            const relative = `pr-${request.repository.id}-${request.pr}`;
            const checkout = await ownedPath(this.root, relative, true);
            const remote =
                this.origins[request.repository.id] ||
                `https://github.com/${request.repository.name}.git`;
            try {
                try {
                    await fs.access(clone);
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                    await fs.mkdir(clone, { mode: 0o700 });
                    await run(["init", "--bare", clone], this.root);
                }
                const headRef = `refs/review/${request.pr}/head`,
                    baseRef = `refs/review/${request.pr}/base`;
                await run(
                    [
                        "fetch",
                        "--no-tags",
                        "--no-recurse-submodules",
                        remote,
                        `+refs/pull/${request.pr}/head:${headRef}`,
                        `+refs/heads/${branch}:${baseRef}`
                    ],
                    clone
                );
                const head = await run(["rev-parse", headRef], clone),
                    base = await run(["rev-parse", baseRef], clone);
                check(head === request.head, "STALE_HEAD");
                const mergeBase = await run(["merge-base", head, base], clone);
                check(SHA.test(base) && SHA.test(mergeBase));
                check(mergeBase === request.mergeBase, "STALE_HEAD");
                let exists = true;
                try {
                    await fs.access(checkout);
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                    exists = false;
                }
                if (exists) {
                    check(
                        (await run(
                            ["status", "--porcelain", "--untracked-files=no"],
                            checkout
                        )) === ""
                    );
                    await run(["checkout", "--detach", head], checkout);
                } else
                    await run(
                        ["worktree", "add", "--detach", checkout, head],
                        clone
                    );
                const record = {
                    generation: crypto.randomUUID(),
                    repositoryId: request.repository.id,
                    repositoryName: request.repository.name,
                    pr: request.pr,
                    relative,
                    head,
                    base,
                    mergeBase,
                    headRef,
                    baseRef
                };
                await writeJson(this.root, `${relative}.json`, record);
                return { ...record, checkout };
            } catch (error) {
                throw sanitized(error);
            }
        });
    }
    async remove(record, keepManifest = false) {
        return this.exclusive(async () => {
            check(record.relative === `pr-${record.repositoryId}-${record.pr}`);
            const checkout = await ownedPath(this.root, record.relative, true);
            const manifest = await ownedPath(
                this.root,
                `${record.relative}.json`
            );
            const saved = JSON.parse(await fs.readFile(manifest, "utf8"));
            check(JSON.stringify(saved) === JSON.stringify(record));
            const clone = await ownedPath(
                this.root,
                `repo-${record.repositoryId}.git`
            );
            try {
                await fs.access(checkout);
                check(
                    (await gitAsync(
                        ["status", "--porcelain", "--untracked-files=no"],
                        checkout
                    )) === ""
                );
                const untracked = (
                    await gitAsync(["ls-files", "--others"], checkout)
                )
                    .split("\n")
                    .filter(Boolean);
                check(
                    untracked.every((name) =>
                        name.startsWith(`temp/pr-github-reviews/${record.pr}/`)
                    )
                );
                await gitAsync(
                    ["worktree", "remove", "--force", checkout],
                    clone
                );
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            await gitAsync(["update-ref", "-d", record.headRef], clone);
            await gitAsync(["update-ref", "-d", record.baseRef], clone);
            if (!keepManifest) await fs.unlink(manifest);
        });
    }
}
module.exports = { Worktrees, git };
