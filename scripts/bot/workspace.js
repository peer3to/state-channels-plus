const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { check, ownedPath, writeJson } = require("./data");
const { git } = require("./worktrees");
// The model-visible review workspace. The models read the pinned source, its git
// history and the worker's GitHub snapshot, and write only to their scratch folder.
// Everything else on the worker (secrets, logins, other state) stays hidden by
// each provider's sandbox; see adapters/codex.js and adapters/claude.js.
async function prepareWorkspace(stateRoot, key, checkout) {
    const root = await ownedPath(stateRoot, `workspaces/${key}`, true);
    const workspace = {
        source: checkout,
        git: path.resolve(
            checkout,
            git(["rev-parse", "--git-common-dir"], checkout).trim()
        ),
        github: path.join(root, "github"),
        scratch: path.join(root, "scratch")
    };
    // The snapshot is rebuilt for every review; scratch notes persist per PR.
    await fsp.rm(workspace.github, { recursive: true, force: true });
    for (const directory of [workspace.github, workspace.scratch])
        await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsp.mkdir(path.join(workspace.scratch, "tmp"), { recursive: true });
    return workspace;
}
async function removeWorkspace(stateRoot, key) {
    await fsp.rm(await ownedPath(stateRoot, `workspaces/${key}`, true), {
        recursive: true,
        force: true
    });
}
// api.github.com/repos/o/r/pulls/6/comments?page=2 -> pulls-6-comments.page-2.json
function snapshotName(url) {
    const parsed = new URL(url);
    const route = parsed.pathname.split("/").slice(4).filter(Boolean).join("-");
    const page = parsed.searchParams.get("page");
    return `${route}${page && page !== "1" ? `.page-${page}` : ""}.json`;
}
async function writeSnapshot(directory, url, page) {
    if (new URL(url).hostname !== "api.github.com") return;
    await writeJson(directory, snapshotName(url), {
        url,
        next: page.next,
        data: page.data
    });
}
// Directories a sandboxed command needs to run node from the worker's install.
function toolchainRoots() {
    return [path.dirname(path.dirname(process.execPath))];
}
function resolveExecutable(name) {
    if (path.isAbsolute(name)) return fs.realpathSync(name);
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
        const candidate = path.join(directory, name);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return fs.realpathSync(candidate);
        } catch {}
    }
    return null;
}
// Paths holding the worker's secrets or logins that sandboxes must never expose.
function secretRoots(stateRoot) {
    return [
        ...new Set([
            os.homedir(),
            path.resolve(__dirname, "../.."),
            path.dirname(stateRoot),
            process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
            process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
        ])
    ];
}
// A sandbox read root may sit inside a secret path (e.g. ~/.nvm/...) but must
// never equal or contain one: node at ~/bin/node would otherwise expose ~.
function checkReadRoots(roots, secrets) {
    for (const root of roots)
        for (const secret of secrets) {
            const relative = path.relative(root, secret);
            check(
                relative.startsWith("..") || path.isAbsolute(relative),
                "ISOLATION_UNVERIFIED"
            );
        }
    return roots;
}
module.exports = {
    prepareWorkspace,
    removeWorkspace,
    snapshotName,
    writeSnapshot,
    toolchainRoots,
    resolveExecutable,
    secretRoots,
    checkReadRoots
};
