const fs = require("fs");
const path = require("path");

const HOST_LOCK_PATH = "/tmp/peer3-test-pool-server-v7.lock";

function acquireHostLock(options = {}) {
    if (options.allowSharedHost) return { release() {} };
    if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error(
            "Host locking is unsupported; pass --allow-shared-host to bypass it"
        );
    }
    let fsExt;
    try {
        fsExt = require("fs-ext");
    } catch {
        throw new Error(
            "fs-ext is required for the distributed worker host lock"
        );
    }
    const lockPath = options.lockPath || HOST_LOCK_PATH;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = fs.openSync(lockPath, "a", 0o600);
    try {
        fsExt.flockSync(fd, "exnb");
    } catch (error) {
        fs.closeSync(fd);
        if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") {
            throw new Error("Another test:parallel:server owns this host");
        }
        throw error;
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            fsExt.flockSync(fd, "un");
            fs.closeSync(fd);
        }
    };
}

module.exports = { HOST_LOCK_PATH, acquireHostLock };
