const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assertContained } = require("../shared/paths");
const { sha256File } = require("../shared/fileHash");

const PREPARATION_VERSION = 2;

function assertWorkspaceId(workspaceId) {
    if (!/^[a-f0-9]{64}$/.test(workspaceId)) {
        throw new Error("Invalid workspace ID");
    }
}

function assertOrchestratorPublicKey(orchestratorPublicKey) {
    if (
        typeof orchestratorPublicKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(orchestratorPublicKey)
    ) {
        throw new Error("Invalid orchestrator public key");
    }
}

function deriveEnvironmentKey(orchestratorPublicKey, workspaceId) {
    assertOrchestratorPublicKey(orchestratorPublicKey);
    assertWorkspaceId(workspaceId);
    return crypto
        .createHash("sha256")
        .update(orchestratorPublicKey)
        .update("\0")
        .update(workspaceId)
        .digest("hex");
}

function workspacePaths(workRoot, environmentKey) {
    assertWorkspaceId(environmentKey);
    const root = path.join(
        path.resolve(workRoot),
        "environments",
        environmentKey
    );
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

async function inspectWorkspace(workRoot, manifest, orchestratorPublicKey) {
    const environmentKey = deriveEnvironmentKey(
        orchestratorPublicKey,
        manifest.workspaceId
    );
    const paths = workspacePaths(workRoot, environmentKey);
    const previous = readJson(paths.sourceManifest, { files: [] });
    const diff = diffSourceFiles(previous.files, manifest.files);
    const changed = new Set(diff.changed);
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
        if (
            !stat.isFile() ||
            stat.size !== entry.bytes ||
            (stat.mode & 0o777) !== entry.mode
        ) {
            changed.add(entry.path);
            continue;
        }
        const digest = await sha256File(target);
        if (digest !== entry.sha256) changed.add(entry.path);
    }
    const prepared = readJson(paths.preparedState, null);
    return {
        ...paths,
        changed: [...changed].sort(),
        deleted: diff.deleted,
        prepared:
            prepared?.sourceDigest === manifest.sourceDigest &&
            prepared?.preparationVersion === PREPARATION_VERSION,
        preparationChanged:
            prepared?.preparationVersion !== PREPARATION_VERSION,
        environmentKey
    };
}

function directoryBytes(root) {
    if (!fs.existsSync(root)) return 0;
    let bytes = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) bytes += directoryBytes(target);
        else if (entry.isFile()) bytes += fs.statSync(target).size;
    }
    return bytes;
}

class EnvironmentCache {
    constructor(workRoot, options = {}) {
        this.workRoot = path.resolve(workRoot);
        this.maxCachedEnvironments = options.maxCachedEnvironments || 10;
        this.maxCacheDiskBytes = options.maxCacheDiskBytes || 100 * 1024 ** 3;
        this.maxEnvironmentDiskBytes =
            options.maxEnvironmentDiskBytes ||
            Math.floor(this.maxCacheDiskBytes / this.maxCachedEnvironments);
        this.active = new Set();
        this.stopping = new Set();
        this.onEvict = options.onEvict || (async () => {});
        this.measureDirectoryBytes =
            options.measureDirectoryBytes || directoryBytes;
        this.allocationChain = Promise.resolve();
    }

    entries() {
        const environmentsRoot = path.join(this.workRoot, "environments");
        if (!fs.existsSync(environmentsRoot)) return [];
        return fs
            .readdirSync(environmentsRoot, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)
            )
            .map((entry) => {
                const root = path.join(environmentsRoot, entry.name);
                const stat = fs.statSync(root);
                const allocation = readJson(
                    path.join(root, "cache-allocation.json"),
                    {}
                );
                return {
                    environmentKey: entry.name,
                    root,
                    bytes: Math.max(
                        allocation.measuredBytes || 0,
                        allocation.reservedDiskBytes || 0
                    ),
                    lastUsedAt: allocation.lastUsedAt || stat.birthtimeMs
                };
            });
    }

    reserve(environmentKey, requestedDiskBytes = 0) {
        const allocation = this.allocationChain.then(() =>
            this.reserveUnlocked(environmentKey, requestedDiskBytes)
        );
        this.allocationChain = allocation.catch(() => {});
        return allocation;
    }

    async reserveUnlocked(environmentKey, requestedDiskBytes = 0) {
        assertWorkspaceId(environmentKey);
        if (requestedDiskBytes > this.maxEnvironmentDiskBytes) {
            const error = new Error(
                "Environment disk allocation exceeds its cache share"
            );
            error.code = "RESOURCE_ALLOCATION_REJECTED";
            error.resource = "diskBytes";
            error.requested = requestedDiskBytes;
            error.permitted = this.maxEnvironmentDiskBytes;
            throw error;
        }
        let entries = this.entries();
        const existing = entries.find(
            (entry) => entry.environmentKey === environmentKey
        );
        const projectedCount = () => entries.length + (existing ? 0 : 1);
        const projectedBytes = () =>
            entries.reduce((total, entry) => total + entry.bytes, 0) -
            (existing?.bytes || 0) +
            Math.max(existing?.bytes || 0, requestedDiskBytes);
        const evicted = [];
        while (
            projectedCount() > this.maxCachedEnvironments ||
            projectedBytes() > this.maxCacheDiskBytes
        ) {
            const victim = entries
                .filter(
                    (entry) =>
                        entry.environmentKey !== environmentKey &&
                        !this.active.has(entry.environmentKey) &&
                        !this.stopping.has(entry.environmentKey)
                )
                .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
            if (!victim) {
                const error = new Error(
                    "No idle environment can be evicted for this allocation"
                );
                error.code = "RESOURCE_ALLOCATION_REJECTED";
                error.resource = "cache";
                error.requested = requestedDiskBytes;
                error.permitted = this.maxCacheDiskBytes;
                throw error;
            }
            await this.onEvict(victim);
            fs.rmSync(victim.root, { recursive: true, force: true });
            evicted.push(victim.environmentKey);
            entries = entries.filter(
                (entry) => entry.environmentKey !== victim.environmentKey
            );
        }
        const root = workspacePaths(this.workRoot, environmentKey).root;
        fs.mkdirSync(root, { recursive: true });
        const allocationPath = path.join(root, "cache-allocation.json");
        const allocation = readJson(allocationPath, {});
        fs.writeFileSync(
            allocationPath,
            JSON.stringify({
                version: 1,
                reservedDiskBytes: Math.max(
                    allocation.reservedDiskBytes || 0,
                    requestedDiskBytes
                ),
                measuredBytes: allocation.measuredBytes || 0,
                lastUsedAt: allocation.lastUsedAt || 0
            })
        );
        this.active.add(environmentKey);
        return {
            environmentKey,
            evicted,
            measuredBytes: this.entries().reduce(
                (total, entry) => total + entry.bytes,
                0
            )
        };
    }

    beginStop(environmentKey) {
        this.active.delete(environmentKey);
        this.stopping.add(environmentKey);
    }

    release(environmentKey) {
        this.stopping.delete(environmentKey);
        const root = workspacePaths(this.workRoot, environmentKey).root;
        if (fs.existsSync(root)) {
            const allocationPath = path.join(root, "cache-allocation.json");
            const allocation = readJson(allocationPath, {});
            const measuredBytes = this.measureDirectoryBytes(root);
            fs.writeFileSync(
                allocationPath,
                JSON.stringify({
                    version: 1,
                    reservedDiskBytes: allocation.reservedDiskBytes || 0,
                    measuredBytes,
                    lastUsedAt: Date.now()
                })
            );
        }
    }

    invalidate(environmentKey) {
        if (
            this.active.has(environmentKey) ||
            this.stopping.has(environmentKey)
        ) {
            throw new Error("Cannot invalidate an active environment");
        }
        fs.rmSync(workspacePaths(this.workRoot, environmentKey).root, {
            recursive: true,
            force: true
        });
    }
}

function resolveWorkspaceFile(workspaceRoot, relative) {
    const root = path.resolve(workspaceRoot);
    return assertContained(root, path.resolve(root, relative), {
        message: `Workspace path escapes root: ${relative}`
    });
}

function validateWorkspaceManifestPaths(workspaceRoot, manifest) {
    if (
        !manifest ||
        !Array.isArray(manifest.files) ||
        !Array.isArray(manifest.repositories) ||
        manifest.files.length !== manifest.fileCount ||
        typeof manifest.rootProjectPath !== "string"
    ) {
        throw new Error("Invalid workspace manifest");
    }
    resolveWorkspaceFile(workspaceRoot, manifest.rootProjectPath);
    for (const entry of manifest.files) {
        if (typeof entry.path !== "string") {
            throw new Error("Invalid workspace file path");
        }
        resolveWorkspaceFile(workspaceRoot, entry.path);
    }
    for (const repository of manifest.repositories) {
        if (typeof repository.path !== "string") {
            throw new Error("Invalid workspace repository path");
        }
        resolveWorkspaceFile(workspaceRoot, repository.path);
    }
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
                files: manifest.files
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
    EnvironmentCache,
    deriveEnvironmentKey,
    directoryBytes,
    workspacePaths,
    diffSourceFiles,
    inspectWorkspace,
    resolveWorkspaceFile,
    validateWorkspaceManifestPaths,
    removeDeletedFiles,
    commitSourceManifest,
    markPrepared
};
