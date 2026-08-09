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
    if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error(
            "Host locking is unsupported; pass --allow-shared-host to bypass it"
        );
    }
    return acquireOsFileLock(
        options.lockPath || HOST_LOCK_PATH,
        "Another test:parallel:server owns this host",
        { mode: options.lockPath ? undefined : 0o700 }
    );
}

function acquireOsFileLock(lockPath, contentionMessage, options = {}) {
    if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error("OS-held file locking is unsupported on this platform");
    }
    let fsExt;
    try {
        fsExt = require("fs-ext");
    } catch (error) {
        // Keep the underlying loader error: "module not found" vs a native
        // ABI mismatch vs an unbuilt binding need different fixes.
        throw new Error(
            `fs-ext is required for distributed worker locking: ${error.message}`
        );
    }
    fs.mkdirSync(path.dirname(lockPath), {
        recursive: true,
        mode: options.mode
    });
    try {
        if (fs.lstatSync(lockPath).isSymbolicLink()) {
            throw new Error(
                `Host lock must not be a symbolic link: ${lockPath}`
            );
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const flags =
        fs.constants.O_CREAT |
        fs.constants.O_APPEND |
        fs.constants.O_RDWR |
        (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(lockPath, flags, 0o600);
    try {
        fsExt.flockSync(fd, "exnb");
    } catch (error) {
        fs.closeSync(fd);
        if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") {
            throw new Error(contentionMessage);
        }
        throw error;
    }
    let released = false;
    return {
        fd,
        release() {
            if (released) return;
            released = true;
            fsExt.flockSync(fd, "un");
            fs.closeSync(fd);
        }
    };
}

module.exports = {
    HOST_LOCK_DIR,
    HOST_LOCK_PATH,
    acquireHostLock,
    acquireOsFileLock
};
