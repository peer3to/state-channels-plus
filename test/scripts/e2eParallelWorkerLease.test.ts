import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const {
    WorkerLeaseManager
} = require("../../scripts/e2e-parallel/distributed/workerLeaseManager.js");
const {
    LeaseRuntime
} = require("../../scripts/e2e-parallel/distributed/leaseRuntime.js");
const {
    acquireHostLock
} = require("../../scripts/e2e-parallel/distributed/hostLock.js");

describe("distributed worker lease", function () {
    it("grants one active lease and queued waiters in FIFO order", async function () {
        const granted: string[] = [];
        const manager = new WorkerLeaseManager({
            queueLength: 2,
            onGrant: (connection: { sessionId: string }) =>
                granted.push(connection.sessionId)
        });
        const a = { sessionId: "a" };
        const b = { sessionId: "b" };
        const c = { sessionId: "c" };
        expect(manager.request(a).kind).to.equal("LEASE_GRANTED");
        expect(manager.request(b)).to.deep.include({
            kind: "BUSY",
            position: 1
        });
        expect(manager.request(c)).to.deep.include({
            kind: "BUSY",
            position: 2
        });
        await manager.release(a, async () => {});
        expect(granted).to.deep.equal(["a", "b"]);
        expect(manager.active).to.equal(b);
    });

    it("removes the complete lease tree and makes cleanup idempotent", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "lease-runtime-test-")
        );
        try {
            const runtime = new LeaseRuntime(root);
            fs.writeFileSync(path.join(runtime.root, "side-effect"), "data");
            await Promise.all([runtime.cleanup(), runtime.cleanup()]);
            expect(fs.existsSync(runtime.root)).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("uses an OS-held host lock and allows the explicit bypass", function () {
        if (process.platform !== "darwin" && process.platform !== "linux")
            this.skip();
        const lockPath = path.join("/tmp", `peer3-lock-test-${process.pid}`);
        const first = acquireHostLock({ lockPath, workRoot: "/tmp/root-a" });
        try {
            expect(() =>
                acquireHostLock({ lockPath, workRoot: "/tmp/root-b" })
            ).to.throw(/owns this host/);
            expect(() =>
                acquireHostLock({ lockPath, allowSharedHost: true })
            ).to.not.throw();
        } finally {
            first.release();
            fs.rmSync(lockPath, { force: true });
        }
        const afterRelease = acquireHostLock({ lockPath });
        afterRelease.release();
        fs.rmSync(lockPath, { force: true });
    });
});
