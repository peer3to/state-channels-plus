const fs = require("fs");
const os = require("os");
const path = require("path");
const lockfile = require("proper-lockfile");

const HOST_LOCK_DIR = path.join(
    os.tmpdir(),
    `peer3-pool-${process.getuid?.() ?? "user"}`
);
const HOST_LOCK_PATH = path.join(HOST_LOCK_DIR, "server-v8");
const DEFAULT_STALE_MS = 10000;
const DEFAULT_UPDATE_MS = 2000;

function acquireHostLock(options = {}) {
    if (options.allowSharedHost) return { release() {} };
    return acquireOsFileLock(
        options.lockPath || HOST_LOCK_PATH,
        "Another test:parallel:server owns this host",
        {
            mode: options.lockPath ? undefined : 0o700,
            staleMs: options.staleMs,
            updateMs: options.updateMs
        }
    );
}

// The lock is an atomic directory with a heartbeat. Ownership does not depend
// on a pid, so pid reuse cannot preserve a dead owner's lock. Stale recovery
// renames the exact stale directory before removing it.
function acquireOsFileLock(lockPath, contentionMessage, options = {}) {
    fs.mkdirSync(path.dirname(lockPath), {
        recursive: true,
        mode: options.mode
    });
    rejectSymlink(lockPath);
    migrateLegacyPidLock(lockPath, contentionMessage);
    let releaseLock;
    try {
        releaseLock = lockfile.lockSync(lockPath, {
            realpath: false,
            retries: 0,
            stale: options.staleMs ?? DEFAULT_STALE_MS,
            update: options.updateMs ?? DEFAULT_UPDATE_MS
        });
    } catch (error) {
        if (error.code === "ELOCKED") throw new Error(contentionMessage);
        throw error;
    }

    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            releaseLock();
        }
    };
}

function migrateLegacyPidLock(lockPath, contentionMessage) {
    const legacyPath = `${lockPath}.lock`;
    let stats;
    try {
        stats = fs.lstatSync(legacyPath);
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }
    if (stats.isDirectory()) return;
    if (!stats.isFile()) {
        throw new Error(`Unsupported host lock type: ${legacyPath}`);
    }

    let ownerPid;
    try {
        const contents = fs.readFileSync(legacyPath, "utf8");
        const parsed = Number.parseInt(contents.trim(), 10);
        if (Number.isInteger(parsed) && parsed > 0) ownerPid = parsed;
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") return;
        throw error;
    }
    if (ownerPid === undefined) {
        throw new Error(
            `Legacy host lock requires cleanup after its previous owner stops: ${legacyPath}`
        );
    }
    if (isProcessAlive(ownerPid)) {
        throw new Error(contentionMessage);
    }
    try {
        fs.unlinkSync(legacyPath);
    } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

function rejectSymlink(lockPath) {
    for (const candidate of [lockPath, `${lockPath}.lock`]) {
        let stats;
        try {
            stats = fs.lstatSync(candidate);
        } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
        if (stats.isSymbolicLink()) {
            throw new Error(
                `Host lock must not be a symbolic link: ${candidate}`
            );
        }
    }
}

module.exports = {
    HOST_LOCK_DIR,
    HOST_LOCK_PATH,
    acquireHostLock,
    acquireOsFileLock
};
