// @spec-test-coverage-ignore: test-only lock process fixture; no SDK behavior applies
const fs = require("fs");
const {
    acquireHostLock
} = require("../../../scripts/e2e-parallel/distributed/hostLock");

const [lockPath, mode, resumePath] = process.argv.slice(2);

try {
    const lock = acquireHostLock({
        lockPath,
        allowSharedHost: mode === "bypass",
        afterRecoveryRename:
            mode === "crash-after-rename"
                ? () => process.kill(process.pid, "SIGKILL")
                : mode === "pause-after-rename"
                  ? (recoveryPath) => {
                        process.send?.({ kind: "renamed", recoveryPath });
                        while (!fs.existsSync(resumePath)) {
                            Atomics.wait(
                                new Int32Array(new SharedArrayBuffer(4)),
                                0,
                                0,
                                10
                            );
                        }
                    }
                  : undefined
    });
    process.send?.({ kind: "acquired" });
    if (mode === "stall") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
    }
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
