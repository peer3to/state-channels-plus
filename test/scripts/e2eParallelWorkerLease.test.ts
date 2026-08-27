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
    LEGACY_HEARTBEAT_GRACE_MS,
    acquireHostLock,
    acquireOsFileLock
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

function startLockChild(lockPath: string, mode = "hold", resumePath?: string) {
    return fork(
        HOST_LOCK_CHILD,
        [lockPath, mode, ...(resumePath ? [resumePath] : [])],
        {
            stdio: ["ignore", "ignore", "ignore", "ipc"]
        }
    );
}

function deadOwner(token = "a".repeat(48)) {
    return JSON.stringify({ version: 1, pid: 2147483647, token });
}

function recoveryArtifacts(lockPath: string) {
    const prefix = `${path.basename(lockPath)}.recovery-`;
    return fs
        .readdirSync(path.dirname(lockPath))
        .filter((entry) => entry.startsWith(prefix));
}

function claimArtifacts(lockPath: string) {
    const prefix = `${path.basename(lockPath)}.claim-`;
    return fs
        .readdirSync(path.dirname(lockPath))
        .filter((entry) => entry.startsWith(prefix));
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

    it("holds a live host lock through an event-loop stall", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-test-${process.pid}`
        );
        const holder = startLockChild(lockPath, "stall");
        try {
            expect(await waitForChildMessage(holder)).to.deep.equal({
                kind: "acquired"
            });
            const contender = startLockChild(lockPath, "release");
            try {
                expect(await waitForChildMessage(contender)).to.deep.include({
                    kind: "error",
                    message: "Another test:parallel:server owns this host"
                });
            } finally {
                stopChild(contender);
            }
        } finally {
            holder.send("release");
        }
    });

    it("keeps the explicit shared-host bypass when no work root is supplied", async function () {
        const lockPath = path.join(os.tmpdir(), `peer3-bypass-${process.pid}`);
        const holder = startLockChild(lockPath);
        try {
            expect(await waitForChildMessage(holder)).to.deep.equal({
                kind: "acquired"
            });
            const bypass = startLockChild(lockPath, "bypass");
            try {
                expect(await waitForChildMessage(bypass)).to.deep.equal({
                    kind: "acquired"
                });
            } finally {
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
            const reclaimed = acquireHostLock({ lockPath });
            reclaimed.release();
        } finally {
            stopChild(holder);
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("retries when the live owner releases between failed claim and owner read", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-release-race-${process.pid}`
        );
        const holder = acquireHostLock({ lockPath });
        try {
            let released = false;
            const replacement = acquireOsFileLock(lockPath, "contended", {
                afterFailedClaim() {
                    if (released) return;
                    released = true;
                    holder.release();
                }
            });
            expect(released).to.equal(true);
            replacement.release();
        } finally {
            holder.release();
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("lets exactly one process recover a stale lock", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-race-${process.pid}`
        );
        fs.writeFileSync(lockPath, deadOwner());
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
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("sweeps a dead recovery artifact left after rename", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-recovery-orphan-${process.pid}`
        );
        fs.writeFileSync(lockPath, deadOwner());
        const reclaimer = startLockChild(lockPath, "crash-after-rename");
        try {
            await new Promise((resolve) => reclaimer.once("exit", resolve));
            expect(recoveryArtifacts(lockPath)).to.have.length(1);
            const replacement = acquireHostLock({ lockPath });
            expect(recoveryArtifacts(lockPath)).to.be.empty;
            replacement.release();
        } finally {
            stopChild(reclaimer);
            fs.rmSync(lockPath, { force: true });
            for (const artifact of recoveryArtifacts(lockPath)) {
                fs.rmSync(path.join(path.dirname(lockPath), artifact), {
                    recursive: true,
                    force: true
                });
            }
        }
    });

    it("settles safely when another contender sweeps an in-flight recovery artifact", async function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-in-flight-sweep-${process.pid}`
        );
        const resumePath = `${lockPath}.resume`;
        const holder = startLockChild(lockPath);
        let reclaimer: ChildProcess | undefined;
        let successor: ChildProcess | undefined;
        try {
            expect(await waitForChildMessage(holder)).to.deep.equal({
                kind: "acquired"
            });
            holder.kill("SIGKILL");
            await new Promise((resolve) => holder.once("exit", resolve));

            reclaimer = startLockChild(
                lockPath,
                "pause-after-rename",
                resumePath
            );
            expect(await waitForChildMessage(reclaimer)).to.deep.include({
                kind: "renamed"
            });
            successor = startLockChild(lockPath);
            expect(await waitForChildMessage(successor)).to.deep.equal({
                kind: "acquired"
            });
            fs.writeFileSync(resumePath, "resume");
            expect(await waitForChildMessage(reclaimer)).to.deep.include({
                kind: "error",
                message: "Another test:parallel:server owns this host"
            });
            expect(recoveryArtifacts(lockPath)).to.be.empty;
        } finally {
            stopChild(holder);
            if (reclaimer) stopChild(reclaimer);
            if (successor) stopChild(successor);
            fs.rmSync(lockPath, { force: true });
            fs.rmSync(resumePath, { force: true });
            for (const artifact of recoveryArtifacts(lockPath)) {
                fs.rmSync(path.join(path.dirname(lockPath), artifact), {
                    recursive: true,
                    force: true
                });
            }
        }
    });

    it("sweeps a dead claim artifact before acquiring", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-claim-orphan-${process.pid}`
        );
        const claimPath = `${lockPath}.claim-2147483647-${"d".repeat(48)}`;
        fs.writeFileSync(claimPath, deadOwner("d".repeat(48)));
        try {
            const lock = acquireHostLock({ lockPath });
            expect(claimArtifacts(lockPath)).to.be.empty;
            lock.release();
        } finally {
            fs.rmSync(lockPath, { force: true });
            fs.rmSync(claimPath, { force: true });
        }
    });

    it("restores a displaced successor after a recovery identity mismatch", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-recovery-mismatch-${process.pid}`
        );
        const successor = {
            version: 1,
            pid: process.pid,
            token: "b".repeat(48)
        };
        fs.writeFileSync(lockPath, deadOwner());
        try {
            expect(() =>
                acquireOsFileLock(lockPath, "contended", {
                    afterRecoveryRename(recoveryPath: string) {
                        fs.writeFileSync(
                            recoveryPath,
                            JSON.stringify(successor)
                        );
                    }
                })
            ).to.throw("contended");
            expect(JSON.parse(fs.readFileSync(lockPath, "utf8"))).to.deep.equal(
                successor
            );
            expect(recoveryArtifacts(lockPath)).to.be.empty;
        } finally {
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("reports a recovery conflict when a canonical file replaces a legacy directory", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-directory-restore-${process.pid}`
        );
        fs.mkdirSync(lockPath);
        const stale = new Date(Date.now() - LEGACY_HEARTBEAT_GRACE_MS - 1000);
        fs.utimesSync(lockPath, stale, stale);
        try {
            expect(() =>
                acquireOsFileLock(lockPath, "contended", {
                    afterRecoveryRename(recoveryPath: string) {
                        fs.writeFileSync(
                            lockPath,
                            JSON.stringify({
                                version: 1,
                                pid: process.pid,
                                token: "e".repeat(48)
                            })
                        );
                        const changed = new Date(stale.getTime() - 1000);
                        fs.utimesSync(recoveryPath, changed, changed);
                    }
                })
            ).to.throw("Lock recovery conflict left displaced owner at");
        } finally {
            fs.rmSync(lockPath, { recursive: true, force: true });
            for (const artifact of recoveryArtifacts(lockPath)) {
                fs.rmSync(path.join(path.dirname(lockPath), artifact), {
                    recursive: true,
                    force: true
                });
            }
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
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("does not let an old handle remove a successor token", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-pid-reuse-${process.pid}`
        );
        const lock = acquireHostLock({ lockPath }) as {
            release: () => void;
        };
        const successor = {
            version: 1,
            pid: process.pid,
            token: "c".repeat(48)
        };
        try {
            fs.writeFileSync(lockPath, JSON.stringify(successor));
            lock.release();
            expect(JSON.parse(fs.readFileSync(lockPath, "utf8"))).to.deep.equal(
                successor
            );
        } finally {
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("migrates a dead legacy pid lock into the canonical owner record", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-legacy-stale-${process.pid}`
        );
        fs.writeFileSync(lockPath, "2147483647");
        try {
            const lock = acquireHostLock({ lockPath });
            expect(JSON.parse(fs.readFileSync(lockPath, "utf8"))).to.include({
                version: 1,
                pid: process.pid
            });
            lock.release();
        } finally {
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("honors a live owner in the legacy pid lock", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-legacy-live-${process.pid}`
        );
        fs.writeFileSync(lockPath, String(process.pid));
        try {
            expect(() => acquireHostLock({ lockPath })).to.throw(
                "Another test:parallel:server owns this host"
            );
        } finally {
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("migrates a legacy heartbeat only after the sixty-second grace", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-legacy-heartbeat-${process.pid}`
        );
        fs.mkdirSync(`${lockPath}.lock`);
        try {
            expect(() => acquireHostLock({ lockPath })).to.throw(
                "Another test:parallel:server owns this host"
            );
            const stale = new Date(
                Date.now() - LEGACY_HEARTBEAT_GRACE_MS - 1000
            );
            fs.utimesSync(`${lockPath}.lock`, stale, stale);
            const lock = acquireHostLock({ lockPath });
            expect(fs.existsSync(`${lockPath}.lock`)).to.equal(false);
            lock.release();
        } finally {
            fs.rmSync(lockPath, { force: true });
            fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
        }
    });

    it("fails closed for a malformed owner record", function () {
        const lockPath = path.join(
            os.tmpdir(),
            `peer3-lock-legacy-ambiguous-${process.pid}`
        );
        fs.writeFileSync(lockPath, "");
        try {
            expect(() => acquireHostLock({ lockPath })).to.throw(
                "Malformed lock owner record"
            );
        } finally {
            fs.rmSync(lockPath, { force: true });
        }
    });

    it("refuses a symbolic lock path", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "host-lock-symlink-test-")
        );
        const lockPath = path.join(root, "host.lock");
        fs.writeFileSync(path.join(root, "target"), "");
        fs.symlinkSync(path.join(root, "target"), lockPath);
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
            expect(
                fs.existsSync(
                    path.join(root, "environments", firstKey, "workspace.lock")
                )
            ).to.equal(true);
            first.release();
            second.release();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("names the work root when one workspace is already owned", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "workspace-contention-")
        );
        const environmentKey = "d".repeat(64);
        const first = acquireWorkspaceLock(root, environmentKey);
        try {
            let failure: Error | null = null;
            try {
                acquireWorkspaceLock(root, environmentKey);
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include(root);
            expect(failure?.message).to.include("different --work-root");
        } finally {
            first.release();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects two shared-host servers using the same resolved work root", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "shared-root-lock-")
        );
        const first = acquireHostLock({
            allowSharedHost: true,
            workRoot: root
        });
        try {
            expect(() =>
                acquireHostLock({ allowSharedHost: true, workRoot: root })
            ).to.throw(root);
            expect(
                fs.existsSync(path.join(root, "host-state", "server.lock"))
            ).to.equal(true);
        } finally {
            first.release();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects two ordinary servers using one work root even with isolated global locks", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "ordinary-root-lock-")
        );
        const first = acquireHostLock({
            lockPath: path.join(root, "global-one.lock"),
            workRoot: root
        });
        try {
            expect(() =>
                acquireHostLock({
                    lockPath: path.join(root, "global-two.lock"),
                    workRoot: root
                })
            ).to.throw("different --work-root");
        } finally {
            first.release();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects ordinary then shared-host ownership of one work root", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mixed-root-lock-"));
        const globalLock = path.join(root, "ordinary-global.lock");
        const first = acquireHostLock({ lockPath: globalLock, workRoot: root });
        try {
            expect(() =>
                acquireHostLock({ allowSharedHost: true, workRoot: root })
            ).to.throw("different --work-root");
        } finally {
            first.release();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects shared-host then ordinary ownership of one work root", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "reverse-root-lock-")
        );
        const globalLock = path.join(root, "ordinary-global.lock");
        const first = acquireHostLock({
            allowSharedHost: true,
            workRoot: root
        });
        try {
            expect(() =>
                acquireHostLock({ lockPath: globalLock, workRoot: root })
            ).to.throw("different --work-root");
        } finally {
            first.release();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("allows shared-host servers with distinct resolved work roots", function () {
        const parent = fs.mkdtempSync(
            path.join(os.tmpdir(), "distinct-roots-")
        );
        const firstRoot = path.join(parent, "one");
        const secondRoot = path.join(parent, "two");
        const first = acquireHostLock({
            allowSharedHost: true,
            workRoot: firstRoot
        });
        const second = acquireHostLock({
            allowSharedHost: true,
            workRoot: secondRoot
        });
        try {
            expect(
                fs.existsSync(path.join(firstRoot, "host-state", "server.lock"))
            ).to.equal(true);
            expect(
                fs.existsSync(
                    path.join(secondRoot, "host-state", "server.lock")
                )
            ).to.equal(true);
        } finally {
            first.release();
            second.release();
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });
});
