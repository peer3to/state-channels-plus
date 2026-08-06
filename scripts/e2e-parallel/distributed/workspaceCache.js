const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PREPARATION_VERSION = 2;

function assertWorkspaceId(workspaceId) {
    if (!/^[a-f0-9]{64}$/.test(workspaceId)) {
        throw new Error("Invalid workspace ID");
    }
}

function workspacePaths(workRoot, workspaceId) {
    assertWorkspaceId(workspaceId);
    const root = path.join(path.resolve(workRoot), "workspaces", workspaceId);
    return {
        root,
        workspace: path.join(root, "workspace"),
        sourceManifest: path.join(root, "source-manifest.json"),
        preparedState: path.join(root, "prepared.json")
    };
}

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function diffSourceFiles(previousFiles, nextFiles) {
    const previous = new Map(
        (previousFiles || []).map((entry) => [entry.path, entry])
    );
    const next = new Map((nextFiles || []).map((entry) => [entry.path, entry]));
    const changed = [];
    const deleted = [];
    for (const entry of next.values()) {
        const old = previous.get(entry.path);
        if (
            !old ||
            old.sha256 !== entry.sha256 ||
            old.mode !== entry.mode ||
            old.bytes !== entry.bytes
        ) {
            changed.push(entry.path);
        }
    }
    for (const entry of previous.values()) {
        if (!next.has(entry.path)) deleted.push(entry.path);
    }
    changed.sort();
    deleted.sort();
    return { changed, deleted };
}

function inspectWorkspace(workRoot, manifest) {
    const paths = workspacePaths(workRoot, manifest.workspaceId);
    const previous = readJson(paths.sourceManifest, { files: [] });
    const diff = diffSourceFiles(previous.files, manifest.files);
    const changed = new Set(diff.changed);
    const previousByPath = new Map(
        (previous.files || []).map((entry) => [entry.path, entry])
    );
    for (const entry of manifest.files) {
        if (changed.has(entry.path)) continue;
        const target = resolveWorkspaceFile(paths.workspace, entry.path);
        let stat;
        try {
            stat = fs.statSync(target);
        } catch {
            changed.add(entry.path);
            continue;
        }
        const cached = previousByPath.get(entry.path);
        if (
            !stat.isFile() ||
            stat.size !== entry.bytes ||
            (stat.mode & 0o777) !== entry.mode
        ) {
            changed.add(entry.path);
            continue;
        }
        if (stat.mtimeMs !== cached.cachedMtimeMs) {
            const digest = crypto
                .createHash("sha256")
                .update(fs.readFileSync(target))
                .digest("hex");
            if (digest !== entry.sha256) changed.add(entry.path);
        }
    }
    const prepared = readJson(paths.preparedState, null);
    return {
        ...paths,
        changed: [...changed].sort(),
        deleted: diff.deleted,
        prepared:
            prepared?.sourceDigest === manifest.sourceDigest &&
            prepared?.preparationVersion === PREPARATION_VERSION,
        preparationChanged: prepared?.preparationVersion !== PREPARATION_VERSION
    };
}

function resolveWorkspaceFile(workspaceRoot, relative) {
    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, relative);
    if (resolved === root || !resolved.startsWith(root + path.sep)) {
        throw new Error(`Workspace path escapes root: ${relative}`);
    }
    return resolved;
}

function removeDeletedFiles(workspaceRoot, deleted) {
    for (const relative of deleted) {
        const target = resolveWorkspaceFile(workspaceRoot, relative);
        fs.rmSync(target, { force: true });
        let parent = path.dirname(target);
        while (parent !== path.resolve(workspaceRoot)) {
            try {
                fs.rmdirSync(parent);
            } catch {
                break;
            }
            parent = path.dirname(parent);
        }
    }
}

function commitSourceManifest(cache, manifest) {
    fs.mkdirSync(cache.root, { recursive: true });
    fs.writeFileSync(
        cache.sourceManifest,
        JSON.stringify(
            {
                sourceDigest: manifest.sourceDigest,
                files: manifest.files.map((entry) => {
                    const stat = fs.statSync(
                        resolveWorkspaceFile(cache.workspace, entry.path)
                    );
                    return {
                        ...entry,
                        cachedMtimeMs: stat.mtimeMs
                    };
                })
            },
            null,
            2
        )
    );
}

function markPrepared(cache, manifest) {
    fs.writeFileSync(
        cache.preparedState,
        JSON.stringify({
            sourceDigest: manifest.sourceDigest,
            preparationVersion: PREPARATION_VERSION
        })
    );
}

module.exports = {
    workspacePaths,
    diffSourceFiles,
    inspectWorkspace,
    resolveWorkspaceFile,
    removeDeletedFiles,
    commitSourceManifest,
    markPrepared
};
