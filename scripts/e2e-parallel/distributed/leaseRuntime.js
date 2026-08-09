const fs = require("fs");
const path = require("path");
const { killProcessGroup } = require("../shared/processGroup");

class LeaseRuntime {
    constructor(workRoot) {
        fs.mkdirSync(workRoot, { recursive: true });
        this.workRoot = fs.realpathSync(workRoot);
        const leasesRoot = path.join(this.workRoot, "leases");
        fs.mkdirSync(leasesRoot, { recursive: true });
        this.root = fs.mkdtempSync(path.join(leasesRoot, "lease-"));
        this.children = new Set();
        this.locks = new Set();
        this.abortController = new AbortController();
        this.cleaning = null;
    }

    addChild(child) {
        this.children.add(child);
        child.once("exit", () => this.children.delete(child));
    }

    holdLock(lock) {
        this.locks.add(lock);
    }

    inheritedFileDescriptors() {
        return [...this.locks].map((lock) => lock.fd);
    }

    cancel() {
        this.abortController.abort();
        for (const child of this.children) {
            killProcessGroup(child, "SIGTERM");
        }
    }

    cleanup(graceMs = 2000) {
        if (this.cleaning) return this.cleaning;
        this.cleaning = (async () => {
            this.cancel();
            const deadline = Date.now() + graceMs;
            while (this.children.size && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            for (const child of this.children) {
                killProcessGroup(child, "SIGKILL");
            }
            const killDeadline = Date.now() + graceMs;
            while (this.children.size && Date.now() < killDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (this.children.size) {
                throw new Error(
                    "Failed to stop workspace processes before releasing ownership"
                );
            }
            for (const lock of this.locks) lock.release();
            this.locks.clear();
            fs.rmSync(this.root, { recursive: true, force: true });
            if (fs.existsSync(this.root))
                throw new Error(`Failed to clean lease ${this.root}`);
        })();
        return this.cleaning;
    }
}

module.exports = { LeaseRuntime };
