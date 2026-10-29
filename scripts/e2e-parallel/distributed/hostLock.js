const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST_LOCK_DIR = path.join(
    os.tmpdir(),
    `peer3-pool-${process.getuid?.() ?? "user"}`
);
const HOST_LOCK_PATH = path.join(HOST_LOCK_DIR, "server-v8");
const LEGACY_HEARTBEAT_GRACE_MS = 60000;
const OWNER_VERSION = 1;
const CLAIM_MARKER = ".claim-";
const RECOVERY_MARKER = ".recovery-";

function acquireHostLock(options = {}) {
    const handles = [];
    try {
        if (!options.allowSharedHost) {
            handles.push(
                acquireOsFileLock(
                    options.lockPath || HOST_LOCK_PATH,
                    "Another test:parallel:server owns this host",
                    {
                        mode: options.lockPath ? undefined : 0o700,
                        legacyHeartbeatGraceMs: options.legacyHeartbeatGraceMs,
                        afterRecoveryRename: options.afterRecoveryRename
                    }
                )
            );
        }
        if (options.workRoot) {
            const resolvedRoot = path.resolve(options.workRoot);
            handles.push(
                acquireOsFileLock(
                    path.join(resolvedRoot, "host-state", "server.lock"),
                    workRootContentionMessage(resolvedRoot),
                    {
                        legacyHeartbeatGraceMs: options.legacyHeartbeatGraceMs,
                        afterRecoveryRename: options.afterRecoveryRename
                    }
                )
            );
        }
    } catch (error) {
        for (const handle of handles.reverse()) handle.release();
        throw error;
    }

    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            for (const handle of handles.reverse()) handle.release();
        }
    };
}

function workRootContentionMessage(workRoot) {
    return `Another worker server owns work root ${path.resolve(workRoot)}; every worker on a shared host needs a different --work-root`;
}

function acquireOsFileLock(lockPath, contentionMessage, options = {}) {
    fs.mkdirSync(path.dirname(lockPath), {
        recursive: true,
        mode: options.mode
    });
    sweepRecoveryArtifacts(lockPath);
    migrateSiblingLegacyLock(lockPath, contentionMessage, options);

    const owner = {
        version: OWNER_VERSION,
        pid: process.pid,
        token: crypto.randomBytes(24).toString("hex")
    };
    for (;;) {
        if (claimLock(lockPath, owner)) return lockHandle(lockPath, owner);
        options.afterFailedClaim?.();
        let observed;
        try {
            observed = readOwner(lockPath, options);
        } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
        if (ownerIsLive(observed, options)) {
            throw new Error(contentionMessage);
        }
        recoverObservedOwner(lockPath, observed, options);
    }
}

function claimLock(lockPath, owner) {
    const stagingPath = `${lockPath}${CLAIM_MARKER}${process.pid}-${owner.token}`;
    fs.writeFileSync(stagingPath, `${JSON.stringify(owner)}\n`, {
        mode: 0o600,
        flag: "wx"
    });
    try {
        // A hard link publishes the complete staged owner record atomically.
        fs.linkSync(stagingPath, lockPath);
        return true;
    } catch (error) {
        if (error.code === "EEXIST") return false;
        throw error;
    } finally {
        fs.rmSync(stagingPath, { force: true });
    }
}

function lockHandle(lockPath, owner) {
    let released = false;
    return {
        lockPath,
        owner,
        release() {
            if (released) return;
            released = true;
            let observed;
            try {
                observed = readOwner(lockPath);
            } catch (error) {
                if (error.code === "ENOENT") return;
                throw error;
            }
            if (!sameCanonicalOwner(observed, owner)) return;
            displaceOwner(lockPath, observed, { removeOnMatch: true });
        }
    };
}

function readOwner(lockPath, options = {}) {
    const stats = safeLstat(lockPath);
    if (!stats) {
        const error = new Error(`Lock owner disappeared: ${lockPath}`);
        error.code = "ENOENT";
        throw error;
    }
    rejectUnsupportedPath(lockPath, stats);
    if (stats.isDirectory()) {
        return {
            format: "legacy-heartbeat",
            pid: null,
            identity: directoryIdentity(stats),
            heartbeatMs: stats.mtimeMs,
            graceMs: options.legacyHeartbeatGraceMs ?? LEGACY_HEARTBEAT_GRACE_MS
        };
    }
    return parseOwnerContents(lockPath, fs.readFileSync(lockPath, "utf8"));
}

function parseOwnerContents(lockPath, contents) {
    const trimmed = contents.trim();
    if (/^[1-9][0-9]*$/.test(trimmed)) {
        return {
            format: "legacy-pid",
            pid: Number(trimmed),
            identity: `pid:${trimmed}`
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        throw new Error(`Malformed lock owner record: ${lockPath}`);
    }
    if (
        parsed?.version !== OWNER_VERSION ||
        !Number.isInteger(parsed.pid) ||
        parsed.pid <= 0 ||
        typeof parsed.token !== "string" ||
        !/^[a-f0-9]{48}$/.test(parsed.token)
    ) {
        throw new Error(`Malformed lock owner record: ${lockPath}`);
    }
    return {
        format: "canonical",
        version: parsed.version,
        pid: parsed.pid,
        token: parsed.token,
        identity: `canonical:${parsed.pid}:${parsed.token}`
    };
}

function ownerIsLive(owner, options = {}) {
    if (owner.format === "legacy-heartbeat") {
        const graceMs = options.legacyHeartbeatGraceMs ?? owner.graceMs;
        return Date.now() - owner.heartbeatMs < graceMs;
    }
    return isProcessAlive(owner.pid);
}

function recoverObservedOwner(lockPath, observed, options = {}) {
    if (ownerIsLive(observed, options)) return false;
    return displaceOwner(lockPath, observed, {
        removeOnMatch: true,
        afterRename: options.afterRecoveryRename
    });
}

function displaceOwner(lockPath, observed, options = {}) {
    const recoveryPath = `${lockPath}${RECOVERY_MARKER}${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
    try {
        fs.renameSync(lockPath, recoveryPath);
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
    options.afterRename?.(recoveryPath, observed);

    let displaced;
    try {
        displaced = readOwner(recoveryPath, {
            legacyHeartbeatGraceMs: observed.graceMs
        });
    } catch (error) {
        restoreDisplacedOwner(lockPath, recoveryPath);
        if (error.code === "ENOENT") return false;
        throw error;
    }
    // Recheck identity after rename so a lagging reclaimer cannot delete a successor.
    if (!sameOwner(displaced, observed)) {
        restoreDisplacedOwner(lockPath, recoveryPath);
        return false;
    }
    if (options.removeOnMatch) {
        fs.rmSync(recoveryPath, { recursive: true, force: true });
    }
    return true;
}

function restoreDisplacedOwner(lockPath, recoveryPath) {
    const stats = safeLstat(recoveryPath);
    if (!stats) return;
    rejectUnsupportedPath(recoveryPath, stats);
    if (stats.isFile()) {
        try {
            fs.linkSync(recoveryPath, lockPath);
        } catch (error) {
            if (error.code === "EEXIST") {
                throw new Error(
                    `Lock recovery conflict left displaced owner at ${recoveryPath}`
                );
            }
            throw error;
        }
        fs.unlinkSync(recoveryPath);
        return;
    }
    try {
        fs.renameSync(recoveryPath, lockPath);
    } catch (error) {
        if (
            error.code === "EEXIST" ||
            error.code === "ENOTEMPTY" ||
            error.code === "ENOTDIR"
        ) {
            throw new Error(
                `Lock recovery conflict left displaced owner at ${recoveryPath}`
            );
        }
        throw error;
    }
}

function sweepRecoveryArtifacts(lockPath) {
    const parent = path.dirname(lockPath);
    const prefixes = [CLAIM_MARKER, RECOVERY_MARKER].map(
        (marker) => `${path.basename(lockPath)}${marker}`
    );
    let entries;
    try {
        entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }
    for (const entry of entries) {
        if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
        const artifactPath = path.join(parent, entry.name);
        const owner = readOwner(artifactPath);
        if (ownerIsLive(owner)) {
            // A live artifact may hold a displaced successor, so it is conflict evidence.
            throw new Error(
                `Live lock artifact requires inspection: ${artifactPath}`
            );
        }
        fs.rmSync(artifactPath, { recursive: true, force: true });
    }
}

function migrateSiblingLegacyLock(lockPath, contentionMessage, options) {
    const legacyPath = `${lockPath}.lock`;
    const stats = safeLstat(legacyPath);
    if (!stats) return;
    rejectUnsupportedPath(legacyPath, stats);
    const observed = readOwner(legacyPath, options);
    if (ownerIsLive(observed, options)) throw new Error(contentionMessage);
    recoverObservedOwner(legacyPath, observed, options);
}

function safeLstat(target) {
    try {
        return fs.lstatSync(target);
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function rejectUnsupportedPath(target, stats) {
    if (stats.isSymbolicLink()) {
        throw new Error(`Lock owner must not be a symbolic link: ${target}`);
    }
    if (!stats.isFile() && !stats.isDirectory()) {
        throw new Error(`Unsupported lock owner type: ${target}`);
    }
}

function directoryIdentity(stats) {
    return `directory:${stats.dev}:${stats.ino}:${stats.mtimeMs}`;
}

function sameCanonicalOwner(observed, expected) {
    return (
        observed.format === "canonical" &&
        observed.pid === expected.pid &&
        observed.token === expected.token
    );
}

function sameOwner(left, right) {
    return left.format === right.format && left.identity === right.identity;
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

module.exports = {
    HOST_LOCK_DIR,
    HOST_LOCK_PATH,
    LEGACY_HEARTBEAT_GRACE_MS,
    acquireHostLock,
    acquireOsFileLock,
    workRootContentionMessage
};
