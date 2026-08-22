const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST_LOCK_DIR = path.join(
    os.tmpdir(),
    `peer3-pool-${process.getuid?.() ?? "user"}`
);
const HOST_LOCK_PATH = path.join(HOST_LOCK_DIR, "server-v8.lock");

function acquireHostLock(options = {}) {
    if (options.allowSharedHost) return { release() {} };
    return acquireOsFileLock(
        options.lockPath || HOST_LOCK_PATH,
        "Another test:parallel:server owns this host",
        { mode: options.lockPath ? undefined : 0o700 }
    );
}

// Exclusive across processes via an atomic link() of a pid file. A lock whose
// owner died is reclaimed, which is what flock(2) gave us for free before —
// without the native fs-ext binding (and it works on Windows).
function acquireOsFileLock(lockPath, contentionMessage, options = {}) {
    fs.mkdirSync(path.dirname(lockPath), {
        recursive: true,
        mode: options.mode
    });
    rejectSymlink(lockPath);
    if (!claimLock(lockPath)) {
        // Someone holds it. Reclaim only if the recorded owner is gone, then
        // race the other reclaimers for the free slot exactly once.
        if (!clearStaleLock(lockPath)) throw new Error(contentionMessage);
        if (!claimLock(lockPath)) throw new Error(contentionMessage);
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            // Only drop the file while we still own it: a lock we were judged
            // stale for belongs to whoever reclaimed it.
            if (readLockOwner(lockPath) === process.pid) {
                fs.rmSync(lockPath, { force: true });
            }
        }
    };
}

// Writes the pid first, then links it into place, so the lock file is never
// observed empty by a concurrent staleness check.
function claimLock(lockPath) {
    const stagingPath = `${lockPath}.${process.pid}.staging`;
    // A crash can leave our own staging file behind; "wx" would then refuse.
    fs.rmSync(stagingPath, { force: true });
    fs.writeFileSync(stagingPath, String(process.pid), {
        mode: 0o600,
        flag: "wx"
    });
    try {
        fs.linkSync(stagingPath, lockPath);
        return true;
    } catch (error) {
        if (error.code === "EEXIST") return false;
        throw error;
    } finally {
        fs.rmSync(stagingPath, { force: true });
    }
}

function clearStaleLock(lockPath) {
    const ownerPid = readLockOwner(lockPath);
    if (ownerPid === undefined) return true; // vanished under us; the slot is free
    if (ownerPid !== null && isProcessAlive(ownerPid)) return false;
    fs.rmSync(lockPath, { force: true });
    return true;
}

// pid of the owner, `null` when the file is unreadable as one, `undefined`
// when there is no lock file at all.
function readLockOwner(lockPath) {
    rejectSymlink(lockPath);
    let contents;
    try {
        contents = fs.readFileSync(lockPath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
    }
    const ownerPid = Number.parseInt(contents.trim(), 10);
    return Number.isInteger(ownerPid) && ownerPid > 0 ? ownerPid : null;
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means the process exists but is owned by another user.
        return error.code === "EPERM";
    }
}

function rejectSymlink(lockPath) {
    let stats;
    try {
        stats = fs.lstatSync(lockPath);
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }
    if (stats.isSymbolicLink()) {
        throw new Error(`Host lock must not be a symbolic link: ${lockPath}`);
    }
}

module.exports = {
    HOST_LOCK_DIR,
    HOST_LOCK_PATH,
    acquireHostLock,
    acquireOsFileLock
};
