// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { ChildProcess, fork } from "child_process";

const {
    WorkerLeaseManager
} = require("../../scripts/e2e-parallel/distributed/workerLeaseManager.js");
const {
    acquireHostLock
} = require("../../scripts/e2e-parallel/distributed/hostLock.js");
const {
    acquireWorkspaceLock
} = require("../../scripts/e2e-parallel/distributed/workspaceLock.js");
const {
    deriveEnvironmentKey
} = require("../../scripts/e2e-parallel/distributed/workspaceCache.js");
const {
    progressElapsedMs
} = require("../../scripts/e2e-parallel/distributed/server.js");

const HOST_LOCK_CHILD = path.join(__dirname, "fixtures", "hostLockChild.js");

function waitForChildMessage(child: ChildProcess) {
    return new Promise<{ kind: string; message?: string }>(
        (resolve, reject) => {
            child.once("message", (message) =>
                resolve(message as { kind: string; message?: string })
            );
            child.once("error", reject);
            child.once("exit", (code) => {
                if (code && code !== 0) {
                    reject(new Error(`host-lock child exited ${code}`));
                }
            });
        }
    );
}

function startLockChild(lockPath: string, mode = "hold") {
    return fork(HOST_LOCK_CHILD, [lockPath, mode, "2000"], {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
}

function stopChild(child: ChildProcess) {
    if (!child.killed) child.kill("SIGKILL");
}

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

    it("faults permanently when lease cleanup fails", async function () {
        const faults: Error[] = [];
        const granted: string[] = [];
        const statuses: Array<{ sessionId: string; status: object }> = [];
        const manager = new WorkerLeaseManager({
            onFault: (error: Error) => faults.push(error),
            onGrant: (connection: { sessionId: string }) =>
                granted.push(connection.sessionId),
            onQueueStatus: (
                connection: { sessionId: string },
                status: object
            ) => statuses.push({ sessionId: connection.sessionId, status })
        });
        const failed = { sessionId: "failed" };
        const next = { sessionId: "next" };

        manager.request(failed);
        manager.request(next);
        const release = await manager.release(failed, async () => {
            throw new Error("cleanup failed");
        });

        expect(faults.map((error) => error.message)).to.deep.equal([
            "cleanup failed"
        ]);
        expect(release).to.deep.include({ faulted: true });
        expect(release.message).to.include("administrator must restart it");
        expect(manager.active).to.equal(null);
        expect(manager.state).to.equal("faulted");
        expect(manager.waiters).to.be.empty;
        expect(granted).to.deep.equal(["failed"]);
        expect(statuses.at(-1)).to.deep.include({ sessionId: "next" });
        expect(statuses.at(-1)?.status).to.deep.include({
            kind: "FAULTED",
            message: release.message
        });
        expect(manager.request({ sessionId: "future" })).to.deep.equal({
            kind: "FAULTED",
            message: release.message
        });
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

    it("holds the host lock against another process and allows the explicit bypass", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-test-${process.pid}`
        );
        const holder = startLockChild(lockPath);
        try {
            expect(await waitForChildMessage(holder)).to.deep.equal({
                kind: "acquired"
            });
            const contender = startLockChild(lockPath, "release");
            const bypass = startLockChild(lockPath, "bypass");
            try {
                expect(await waitForChildMessage(contender)).to.deep.include({
                    kind: "error",
                    message: "Another test:parallel:server owns this host"
                });
                expect(await waitForChildMessage(bypass)).to.deep.equal({
                    kind: "acquired"
                });
            } finally {
                stopChild(contender);
                stopChild(bypass);
            }
        } finally {
            holder.send("release");
        }
    });

    it("reclaims a host lock after its owner process crashes", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-stale-${process.pid}`
        );
        const holder = startLockChild(lockPath);
        try {
            expect(await waitForChildMessage(holder)).to.deep.equal({
                kind: "acquired"
            });
            holder.kill("SIGKILL");
            await new Promise((resolve) => holder.once("exit", resolve));
            const stale = new Date(Date.now() - 5000);
            fs.utimesSync(`${lockPath}.lock`, stale, stale);
            const reclaimed = acquireHostLock({
                lockPath,
                staleMs: 2000,
                updateMs: 1000
            });
            reclaimed.release();
        } finally {
            stopChild(holder);
            fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
        }
    });

    it("lets exactly one process recover a stale lock", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-race-${process.pid}`
        );
        fs.mkdirSync(`${lockPath}.lock`);
        const stale = new Date(Date.now() - 5000);
        fs.utimesSync(`${lockPath}.lock`, stale, stale);
        const first = startLockChild(lockPath);
        const second = startLockChild(lockPath);
        try {
            const results = await Promise.all([
                waitForChildMessage(first),
                waitForChildMessage(second)
            ]);
            expect(
                results.filter((result) => result.kind === "acquired")
            ).to.have.length(1);
            expect(
                results.filter((result) => result.kind === "error")
            ).to.have.length(1);
        } finally {
            stopChild(first);
            stopChild(second);
            fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
        }
    });

    it("releases in one process and reacquires in another", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-release-${process.pid}`
        );
        const first = startLockChild(lockPath, "release");
        let second: ChildProcess | undefined;
        try {
            expect(await waitForChildMessage(first)).to.deep.equal({
                kind: "acquired"
            });
            if (first.exitCode === null) {
                await new Promise((resolve) => first.once("exit", resolve));
            }
            second = startLockChild(lockPath, "release");
            expect(await waitForChildMessage(second)).to.deep.equal({
                kind: "acquired"
            });
        } finally {
            stopChild(first);
            if (second) stopChild(second);
            fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
        }
    });

    it("does not use pid-file contents as lock ownership", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-pid-reuse-${process.pid}`
        );
        fs.writeFileSync(lockPath, String(process.pid));
        try {
            acquireHostLock({ lockPath }).release();
        } finally {
            fs.rmSync(lockPath, { force: true });
            fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
        }
    });

    it("refuses a symbolic lock path", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "host-lock-symlink-test-")
        );
        const lockPath = path.join(root, "host.lock");
        fs.writeFileSync(path.join(root, "target"), "");
        fs.symlinkSync(path.join(root, "target"), `${lockPath}.lock`);
        try {
            expect(() => acquireHostLock({ lockPath })).to.throw(
                /must not be a symbolic link/
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("locks identical source independently for two orchestrator identities", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "environment-lock-test-")
        );
        const workspaceId = "a".repeat(64);
        const firstKey = deriveEnvironmentKey("1".repeat(64), workspaceId);
        const secondKey = deriveEnvironmentKey("2".repeat(64), workspaceId);
        try {
            const first = acquireWorkspaceLock(root, firstKey);
            const second = acquireWorkspaceLock(root, secondKey);
            first.release();
            second.release();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
