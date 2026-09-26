// What the compiled test tree under dist/ is built from, and the stamp the
// build leaves behind so a later run can tell whether the tree is current.
//
// Two kinds of staleness are told apart. A source whose content changed only
// moves its modification time: the tree is refreshed in place (tsc emits over
// the old files; nothing is deleted, because an outer run may be loading from
// the same tree). A source added, removed or renamed changes the file set:
// the tree is rebuilt from scratch, so a twin of a deleted or renamed file
// cannot linger and be run.
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

const SOURCE_DIRS = ["src", "test", "scripts", "typechain-types"];
const SOURCE_FILES = ["hardhat.config.ts", "tsconfig.json", "package.json"];
const SOURCE_EXTENSION = /\.(c|m)?tsx?$|\.(c|m)?js$|\.json$|\.sol$/;
const STAMP_PATH = path.join("dist", ".test-build-stamp");

/** Every compiled or mirrored source under `root`, with the newest mtime. */
function scanSources(root = process.cwd()) {
    const files = [];
    let newestMtimeMs = 0;
    const visit = (file) => {
        let stat;
        try {
            stat = fs.statSync(file);
        } catch {
            return;
        }
        files.push(path.relative(root, file));
        if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs;
    };
    for (const dir of SOURCE_DIRS) {
        const stack = [path.join(root, dir)];
        while (stack.length) {
            const current = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const file = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "node_modules") stack.push(file);
                } else if (SOURCE_EXTENSION.test(entry.name)) {
                    visit(file);
                }
            }
        }
    }
    for (const file of SOURCE_FILES) visit(path.join(root, file));
    files.sort();
    const fileSetHash = createHash("sha256")
        .update(files.join("\n"))
        .digest("hex");
    return { fileCount: files.length, fileSetHash, newestMtimeMs };
}

function readStamp(root = process.cwd()) {
    try {
        const stamp = JSON.parse(
            fs.readFileSync(path.join(root, STAMP_PATH), "utf8")
        );
        return Number.isFinite(stamp.builtAtMs) && stamp.fileSetHash
            ? stamp
            : undefined;
    } catch {
        return undefined;
    }
}

function writeStamp(root = process.cwd()) {
    const { fileCount, fileSetHash } = scanSources(root);
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(
        path.join(root, STAMP_PATH),
        JSON.stringify({ builtAtMs: Date.now(), fileCount, fileSetHash })
    );
}

/**
 * "current" when nothing changed since the stamp, "refresh" when only
 * contents changed, "rebuild" when the file set changed or no stamp exists.
 */
function compiledTreeState(root = process.cwd()) {
    const stamp = readStamp(root);
    if (!stamp) return "rebuild";
    const sources = scanSources(root);
    if (sources.fileSetHash !== stamp.fileSetHash) return "rebuild";
    return sources.newestMtimeMs > stamp.builtAtMs ? "refresh" : "current";
}

module.exports = { compiledTreeState, scanSources, writeStamp, STAMP_PATH };
