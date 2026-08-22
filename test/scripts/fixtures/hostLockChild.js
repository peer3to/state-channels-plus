const {
    acquireHostLock
} = require("../../../scripts/e2e-parallel/distributed/hostLock");

const [lockPath, mode, staleMs = "2000"] = process.argv.slice(2);

try {
    const lock = acquireHostLock({
        lockPath,
        allowSharedHost: mode === "bypass",
        staleMs: Number(staleMs),
        updateMs: 1000
    });
    process.send?.({ kind: "acquired" });
    if (mode === "release") {
        lock.release();
        process.exit(0);
    }
    process.on("message", (message) => {
        if (message === "release") {
            lock.release();
            process.exit(0);
        }
    });
} catch (error) {
    process.send?.({ kind: "error", message: error.message });
    process.exit(2);
}
