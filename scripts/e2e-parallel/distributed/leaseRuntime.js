const fs = require("fs");
const path = require("path");

class LeaseRuntime {
    constructor(workRoot) {
        fs.mkdirSync(workRoot, { recursive: true });
        this.workRoot = fs.realpathSync(workRoot);
        const leasesRoot = path.join(this.workRoot, "leases");
        fs.mkdirSync(leasesRoot, { recursive: true });
        this.root = fs.mkdtempSync(path.join(leasesRoot, "lease-"));
        this.children = new Set();
        this.abortController = new AbortController();
        this.cleaning = null;
    }

    addChild(child) {
        this.children.add(child);
        child.once("exit", () => this.children.delete(child));
    }

    cancel() {
        this.abortController.abort();
        for (const child of this.children) {
            if (!child.pid) continue;
            try {
                if (process.platform === "win32") child.kill("SIGTERM");
                else process.kill(-child.pid, "SIGTERM");
            } catch {}
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
                if (!child.pid) continue;
                try {
                    if (process.platform === "win32") child.kill("SIGKILL");
                    else process.kill(-child.pid, "SIGKILL");
                } catch {}
            }
            fs.rmSync(this.root, { recursive: true, force: true });
            if (fs.existsSync(this.root))
                throw new Error(`Failed to clean lease ${this.root}`);
        })();
        return this.cleaning;
    }
}

module.exports = { LeaseRuntime };
