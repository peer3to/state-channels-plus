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
const {
    progressElapsedMs
} = require("../../scripts/e2e-parallel/distributed/server.js");

describe("distributed worker lease", function () {
    it("reports finite progress while the leased workspace is still preparing", function () {
        expect(progressElapsedMs({ leaseStartedAt: 1000 }, 1750)).to.equal(750);
        expect(
            progressElapsedMs(
                { leaseStartedAt: 1000, runStartedAt: 1600 },
                1750
            )
        ).to.equal(150);
        expect(progressElapsedMs({}, 1750)).to.equal(0);
    });

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
        await manager.release(b, async () => {});
        expect(granted).to.deep.equal(["a", "b", "c"]);
        expect(manager.active).to.equal(c);
    });

    it("keeps duplicate requests on one connection idempotent", function () {
        const manager = new WorkerLeaseManager();
        const active = { sessionId: "active" };
        const waiting = { sessionId: "waiting" };

        expect(manager.request(active).kind).to.equal("LEASE_GRANTED");
        expect(manager.request(active).kind).to.equal("LEASE_GRANTED");
        expect(manager.request(waiting)).to.deep.include({
            kind: "BUSY",
            position: 1
        });
        expect(manager.request(waiting)).to.deep.include({
            kind: "BUSY",
            position: 1
        });
        expect(manager.waiters).to.deep.equal([waiting]);
    });

    it("returns to service when lease cleanup fails", async function () {
        const faults: Error[] = [];
        const granted: string[] = [];
        const manager = new WorkerLeaseManager({
            onFault: (error: Error) => faults.push(error),
            onGrant: (connection: { sessionId: string }) =>
                granted.push(connection.sessionId)
        });
        const failed = { sessionId: "failed" };
        const next = { sessionId: "next" };

        manager.request(failed);
        manager.request(next);
        await manager.release(failed, async () => {
            throw new Error("cleanup failed");
        });

        expect(faults.map((error) => error.message)).to.deep.equal([
            "cleanup failed"
        ]);
        expect(manager.active).to.equal(next);
        expect(manager.state).to.equal("preparing");
        expect(granted).to.deep.equal(["failed", "next"]);
    });

    it("publishes queue progress, wait estimates, and updated positions", function () {
        const statuses: Array<{
            sessionId: string;
            position: number;
            completedTasks: number;
            totalTasks: number;
            estimatedWaitMs: number | null;
        }> = [];
        const manager = new WorkerLeaseManager({
            onQueueStatus: (
                connection: { sessionId: string },
                status: {
                    position: number;
                    completedTasks: number;
                    totalTasks: number;
                    estimatedWaitMs: number | null;
                }
            ) => statuses.push({ sessionId: connection.sessionId, ...status })
        });
        const active = { sessionId: "active" };
        const next = { sessionId: "next" };
        const later = { sessionId: "later" };
        manager.request(active);
        manager.request(next);
        manager.request(later);
        manager.markRunning(active);
        manager.updateStatus(active, "Running tests");
        manager.updateProgress(active, {
            completedTasks: 5,
            totalTasks: 20,
            elapsedMs: 10000
        });

        expect(statuses[statuses.length - 2]).to.deep.include({
            sessionId: "next",
            position: 1,
            completedTasks: 5,
            totalTasks: 20,
            estimatedWaitMs: 30000
        });
        expect(statuses[statuses.length - 1]).to.deep.include({
            sessionId: "later",
            position: 2,
            estimatedWaitMs: null
        });

        manager.remove(next);
        expect(statuses[statuses.length - 1]).to.deep.include({
            sessionId: "later",
            position: 1,
            estimatedWaitMs: 30000
        });
        expect(() =>
            manager.updateProgress(active, {
                completedTasks: 21,
                totalTasks: 20,
                elapsedMs: 10000
            })
        ).to.throw("Invalid worker progress");
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
