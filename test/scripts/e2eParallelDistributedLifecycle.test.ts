// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { LeasePoolHarness } from "../fixtures/distributed/leasePool";
import { TestIsolatedRuntimeBackend } from "../fixtures/distributed/isolatedRuntimeBackend";

const {
    OrchestratorLogStore
} = require("../../scripts/e2e-parallel/distributed/orchestratorLogStore.js");
const {
    ingestAttemptLogMessage
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");

const workspaceManifest = {
    version: 3,
    packageManager: "pnpm",
    workspaceId: "a".repeat(64),
    sourceDigest: "source",
    rootProjectPath: "project",
    runnerEntry: "project/scripts/e2e-parallel/distributed/worker.js",
    repositories: [],
    fileCount: 1,
    expandedBytes: 1
};
const sourceFiles = [
    { path: "project/a.ts", bytes: 1, sha256: "b".repeat(64), mode: 420 }
];
const emptySourceSha256 = crypto
    .createHash("sha256")
    .update(Buffer.alloc(0))
    .digest("hex");

describe("distributed worker pool lifecycle", function () {
    it("deduplicates simultaneous bidirectional discovery into one lease", async function () {
        const pool = await LeasePoolHarness.create();
        try {
            const worker = await pool.startServer("worker-a");
            const orchestrator = await pool.startOrchestrator("run-one");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");

            expect(orchestrator.connectedWorkerCount()).to.equal(1);
            expect(worker.connectionCount()).to.equal(1);
            expect(
                (worker.manager.active as { sessionId: string }).sessionId
            ).to.equal("run-one");

            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN");
        } finally {
            await pool.close();
        }
    });

    it("keeps the orchestrator and surviving server active while a replacement server rejoins", async function () {
        const pool = await LeasePoolHarness.create();
        try {
            const workerA = await pool.startServer("worker-a");
            const workerB = await pool.startServer("worker-b");
            const orchestrator = await pool.startOrchestrator("run-one");
            await Promise.all([
                orchestrator.waitFor("worker-a", "LEASE_GRANTED"),
                orchestrator.waitFor("worker-b", "LEASE_GRANTED")
            ]);
            expect(orchestrator.connectedWorkerCount()).to.equal(2);

            const beforeStop = orchestrator.checkpoint();
            await pool.stopServer(workerB);
            await orchestrator.waitFor("worker-b", "CONNECTION_CLOSED", {
                after: beforeStop
            });
            expect(orchestrator.connectedWorkerCount()).to.equal(1);

            const beforeReplacement = orchestrator.checkpoint();
            const replacement = await pool.startServer("worker-b");
            await orchestrator.waitFor("worker-b", "LEASE_GRANTED", {
                after: beforeReplacement
            });
            expect(orchestrator.connectedWorkerCount()).to.equal(2);

            await orchestrator.send(workerA.name, "RELEASE");
            await orchestrator.waitFor(workerA.name, "LEASE_CLEAN");
            await orchestrator.send(replacement.name, "RELEASE");
            await orchestrator.waitFor(replacement.name, "LEASE_CLEAN", {
                after: beforeReplacement
            });
        } finally {
            await pool.close();
        }
    });

    it("keeps a second orchestrator connected with progress and promotes it on every server", async function () {
        const pool = await LeasePoolHarness.create();
        try {
            const workerA = await pool.startServer("worker-a");
            const workerB = await pool.startServer("worker-b");
            const first = await pool.startOrchestrator("run-one");
            await Promise.all([
                first.waitFor(workerA.name, "LEASE_GRANTED"),
                first.waitFor(workerB.name, "LEASE_GRANTED")
            ]);

            const second = await pool.startOrchestrator("run-two");
            await Promise.all([
                second.waitFor(workerA.name, "BUSY"),
                second.waitFor(workerB.name, "BUSY")
            ]);
            expect(second.connectedWorkerCount()).to.equal(2);

            const progressCheckpoint = second.checkpoint();
            for (const server of [workerA, workerB]) {
                server.manager.markRunning(server.manager.active);
                server.manager.updateStatus(
                    server.manager.active,
                    "Running tests"
                );
                server.manager.updateProgress(server.manager.active, {
                    completedTasks: 4,
                    totalTasks: 10,
                    elapsedMs: 20000
                });
            }
            for (const server of [workerA, workerB]) {
                const status = await second.waitFor(server.name, "BUSY", {
                    after: progressCheckpoint,
                    predicate: (event) =>
                        event.header.completedTasks === 4 &&
                        event.header.estimatedWaitMs === 30000
                });
                expect(status.header).to.include({
                    state: "running",
                    position: 1,
                    status: "Running tests",
                    completedTasks: 4,
                    totalTasks: 10,
                    estimatedWaitMs: 30000
                });
            }

            const promotionCheckpoint = second.checkpoint();
            await Promise.all([
                first.send(workerA.name, "RELEASE"),
                first.send(workerB.name, "RELEASE")
            ]);
            await Promise.all([
                second.waitFor(workerA.name, "LEASE_GRANTED", {
                    after: promotionCheckpoint
                }),
                second.waitFor(workerB.name, "LEASE_GRANTED", {
                    after: promotionCheckpoint
                })
            ]);
            expect(second.connectedWorkerCount()).to.equal(2);
            const cleanupCheckpoint = second.checkpoint();
            await Promise.all([
                second.send(workerA.name, "RELEASE"),
                second.send(workerB.name, "RELEASE")
            ]);
            await Promise.all([
                second.waitFor(workerA.name, "LEASE_CLEAN", {
                    after: cleanupCheckpoint
                }),
                second.waitFor(workerB.name, "LEASE_CLEAN", {
                    after: cleanupCheckpoint
                })
            ]);
        } finally {
            await pool.close();
        }
    });

    it("promotes the waiting orchestrator when the lease owner is killed", async function () {
        const pool = await LeasePoolHarness.create();
        try {
            const worker = await pool.startServer("worker-a");
            const first = await pool.startOrchestrator("run-one");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            const second = await pool.startOrchestrator("run-two");
            await second.waitFor(worker.name, "BUSY");

            const beforeKill = second.checkpoint();
            await pool.closeOrchestrator(first);
            await second.waitFor(worker.name, "LEASE_GRANTED", {
                after: beforeKill
            });
            expect(second.connectedWorkerCount()).to.equal(1);
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN", {
                after: beforeKill
            });
        } finally {
            await pool.close();
        }
    });

    it("grants a new orchestrator immediately after the previous run finishes", async function () {
        const pool = await LeasePoolHarness.create();
        try {
            const worker = await pool.startServer("worker-a");
            const first = await pool.startOrchestrator("run-one");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            await first.send(worker.name, "RELEASE");
            await first.waitFor(worker.name, "LEASE_CLEAN");

            const second = await pool.startOrchestrator("run-two");
            await second.waitFor(worker.name, "LEASE_GRANTED");
            expect(second.received(worker.name, "BUSY")).to.equal(false);
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN");
        } finally {
            await pool.close();
        }
    });

    it("allocates identical source into distinct identity environments and promotes only after cleanup", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const first = await pool.startOrchestrator("run-one");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            const second = await pool.startOrchestrator("run-two");
            await second.waitFor(worker.name, "BUSY");

            await first.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await first.waitFor(worker.name, "WORKSPACE_NEED");
            await first.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await first.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await first.waitFor(worker.name, "PREPARED");
            await first.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 0
            });
            await first.waitFor(worker.name, "WORKER_READY");

            const promotion = second.checkpoint();
            await first.send(worker.name, "RELEASE");
            await first.waitFor(worker.name, "LEASE_CLEAN");
            await second.waitFor(worker.name, "LEASE_GRANTED", {
                after: promotion
            });
            await second.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await second.waitFor(worker.name, "WORKSPACE_NEED", {
                after: promotion
            });

            const allocations = backend.calls
                .filter((entry) => entry.operation === "create")
                .map(
                    (entry) =>
                        (entry.value as { environmentKey: string })
                            .environmentKey
                );
            expect(allocations).to.have.length(2);
            expect(allocations[0]).not.to.equal(allocations[1]);
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN", {
                after: promotion
            });
        } finally {
            await pool.close();
        }
    });

    it("restarts one identity with its prepared volume and requests no unchanged source", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("run-one");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN");

            const restart = orchestrator.checkpoint();
            await orchestrator.send(worker.name, "LEASE_REQUEST", {
                sessionId: "run-two"
            });
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED", {
                after: restart
            });
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            const need = await orchestrator.waitFor(
                worker.name,
                "WORKSPACE_NEED",
                { after: restart }
            );
            expect(JSON.parse(need.body!.toString()).changed).to.deep.equal([]);
            expect(
                backend.calls.filter((entry) => entry.operation === "create")
            ).to.have.length(1);
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED", {
                after: restart
            });
            await orchestrator.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1
            });
            await orchestrator.waitFor(worker.name, "WORKER_READY", {
                after: restart
            });
            const evidence = Buffer.from("second lease failed\n");
            backend.artifactOutput = {
                stdout: evidence,
                stderr: Buffer.alloc(0)
            };
            const taskFlow = orchestrator.checkpoint();
            backend.emitWorkerEvent({ kind: "TASK_REQUEST", requestId: 10 });
            backend.emitWorkerEvent(
                {
                    kind: "ATTEMPT_READY",
                    requestId: 11,
                    assignment: {
                        taskId: "task-2",
                        attemptId: "attempt-2"
                    },
                    result: { code: 1, reduced: { starveCount: 0 } }
                },
                [
                    {
                        name: "stdout",
                        bytes: evidence.length,
                        sha256: crypto
                            .createHash("sha256")
                            .update(evidence)
                            .digest("hex")
                    },
                    {
                        name: "stderr",
                        bytes: 0,
                        sha256: crypto
                            .createHash("sha256")
                            .update(Buffer.alloc(0))
                            .digest("hex")
                    }
                ]
            );
            await Promise.all([
                orchestrator.waitFor(worker.name, "TASK_REQUEST", {
                    after: taskFlow
                }),
                orchestrator.waitFor(worker.name, "LOG_END", {
                    after: taskFlow
                }),
                orchestrator.waitFor(worker.name, "ATTEMPT_RESULT", {
                    after: taskFlow
                })
            ]);
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(
                orchestrator.count(worker.name, "TASK_REQUEST", taskFlow)
            ).to.equal(1);
            expect(
                orchestrator.count(worker.name, "LOG_END", taskFlow)
            ).to.equal(1);
            expect(
                orchestrator.count(worker.name, "ATTEMPT_RESULT", taskFlow)
            ).to.equal(1);
            const retained = [
                ...worker.environmentManager.environments.values()
            ][0];
            expect(retained.listenerCount("frame")).to.equal(1);
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN", {
                after: restart
            });
        } finally {
            await pool.close();
        }
    });

    it("contains an isolated runner crash and grants a later lease", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const first = await pool.startOrchestrator("run-one");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            const second = await pool.startOrchestrator("run-two");
            await second.waitFor(worker.name, "BUSY");
            await first.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await first.waitFor(worker.name, "WORKSPACE_NEED");
            const promotion = second.checkpoint();
            backend.crash();
            const diagnostic = await first.waitFor(
                worker.name,
                "INFRA_PROCESS_LOG",
                { after: promotion }
            );
            expect(diagnostic.body?.toString()).to.equal("test diagnostics");
            await first.waitFor(worker.name, "WORKER_ERROR");
            await second.waitFor(worker.name, "LEASE_GRANTED", {
                after: promotion
            });
            expect(
                backend.calls.filter((entry) => entry.operation === "destroy")
            ).to.have.length(1);
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN", {
                after: promotion
            });
        } finally {
            await pool.close();
        }
    });

    it("relays selected attempt evidence as bounded bytes without a guest path", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        const logRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), "live-artifact-ingestion-")
        );
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("run-one");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            await orchestrator.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1,
                extensions: { isolatedRuntimeMetadata: true }
            });
            await orchestrator.waitFor(worker.name, "WORKER_READY");

            const stdoutFirst = Buffer.from("stdout-before\n");
            const stderr = Buffer.from("stderr-between\n");
            const stdoutLast = Buffer.from("stdout-after\n");
            const stdout = Buffer.concat([stdoutFirst, stdoutLast]);
            backend.artifactChunks = [
                { name: "stdout", body: stdoutFirst },
                { name: "stderr", body: stderr },
                { name: "stdout", body: stdoutLast }
            ];
            const checkpoint = orchestrator.checkpoint();
            backend.emitWorkerEvent(
                {
                    kind: "ATTEMPT_READY",
                    requestId: 7,
                    assignment: {
                        taskId: "task-1",
                        attemptId: "attempt-1"
                    },
                    result: { code: 1, reduced: { starveCount: 0 } }
                },
                [
                    {
                        name: "stdout",
                        bytes: stdout.length,
                        sha256: crypto
                            .createHash("sha256")
                            .update(stdout)
                            .digest("hex")
                    },
                    {
                        name: "stderr",
                        bytes: stderr.length,
                        sha256: crypto
                            .createHash("sha256")
                            .update(stderr)
                            .digest("hex")
                    }
                ]
            );
            const end = await orchestrator.waitFor(worker.name, "LOG_END", {
                after: checkpoint
            });
            const attempt = await orchestrator.waitFor(
                worker.name,
                "ATTEMPT_RESULT",
                {
                    after: checkpoint
                }
            );
            const received = path.join(logRoot, "attempt.ansi");
            const store = new OrchestratorLogStore(logRoot);
            store.begin("attempt", received);
            for (const message of orchestrator.messages(
                worker.name,
                "LOG_CHUNK",
                checkpoint
            )) {
                ingestAttemptLogMessage(store, "attempt", message);
            }
            const output = ingestAttemptLogMessage(store, "attempt", end);
            expect(fs.readFileSync(received, "utf8")).to.equal(
                "stdout-before\nstderr-between\nstdout-after\n"
            );
            expect(output).to.include({
                stdout: stdout.toString(),
                stderr: stderr.toString()
            });
            expect(end.header.byteCount).to.equal(
                stdout.length + stderr.length
            );
            expect(attempt.header.isolatedRuntime).to.deep.include({
                backend: "test"
            });
            expect(JSON.stringify(end.header)).not.to.include("environment");
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN", {
                after: checkpoint
            });
        } finally {
            await pool.close();
            fs.rmSync(logRoot, { recursive: true, force: true });
        }
    });

    it("classifies a mid-run worker exit as a negotiated resource limit and keeps the server available", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.exitClassification = {
            resource: "memory",
            limit: 1024,
            phase: "execution",
            message: "cgroup OOM"
        };
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const first = await pool.startOrchestrator("run-one");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            const second = await pool.startOrchestrator("run-two");
            await second.waitFor(worker.name, "BUSY");
            await first.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await first.waitFor(worker.name, "WORKSPACE_NEED");
            await first.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await first.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await first.waitFor(worker.name, "PREPARED");
            await first.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1,
                extensions: { resourceLimitDetails: true }
            });
            await first.waitFor(worker.name, "WORKER_READY");
            const promotion = second.checkpoint();
            backend.emitWorkerEvent({
                kind: "ISOLATED_WORKER_EXIT",
                code: 137,
                signal: null
            });
            const failure = await first.waitFor(
                worker.name,
                "RESOURCE_LIMIT_EXCEEDED"
            );
            expect(failure.header).to.deep.include({
                resource: "memory",
                limit: 1024,
                phase: "execution"
            });
            await second.waitFor(worker.name, "LEASE_GRANTED", {
                after: promotion
            });
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN", {
                after: promotion
            });
        } finally {
            await pool.close();
        }
    });

    it("keeps preparation alive while the guest reports activity", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.preparationDelayMs = 90;
        backend.preparationStatusIntervalMs = 10;
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend,
                preparationInactivityTimeoutMs: 30
            });
            const orchestrator = await pool.startOrchestrator("active-prepare");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            expect(
                orchestrator.received(worker.name, "PREPARATION_ERROR")
            ).to.equal(false);
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN");
        } finally {
            await pool.close();
        }
    });

    it("fails a preparation lease after the guest becomes silent", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.preparationDelayMs = 90;
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend,
                preparationInactivityTimeoutMs: 30
            });
            const orchestrator = await pool.startOrchestrator("silent-prepare");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            const failure = await orchestrator.waitFor(
                worker.name,
                "PREPARATION_ERROR"
            );
            expect(failure.header.message).to.include("inactivity");
        } finally {
            await pool.close();
        }
    });

    it("reports an unexpected preparation failure before reusing the connection", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.startFailuresRemaining = 1;
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("start-failure");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            const failure = await orchestrator.waitFor(
                worker.name,
                "PREPARATION_ERROR"
            );
            expect(failure.header.message).to.equal(
                "test isolated runtime start failed"
            );

            const retry = orchestrator.checkpoint();
            await orchestrator.send(worker.name, "LEASE_REQUEST", {
                sessionId: "start-failure-retry"
            });
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED", {
                after: retry
            });
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN", {
                after: retry
            });
        } finally {
            await pool.close();
        }
    });

    it("retains cached source after a recoverable preparation command failure", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.preparationFailuresRemaining = 1;
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("prepare-retry");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARATION_ERROR");

            const retry = orchestrator.checkpoint();
            await orchestrator.send(worker.name, "LEASE_REQUEST", {
                sessionId: "prepare-retry-two"
            });
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED", {
                after: retry
            });
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            const need = await orchestrator.waitFor(
                worker.name,
                "WORKSPACE_NEED",
                { after: retry }
            );
            expect(JSON.parse(need.body!.toString()).changed).to.deep.equal([]);
            expect(
                backend.calls.filter((entry) => entry.operation === "create")
            ).to.have.length(1);
            expect(
                backend.calls.filter((entry) => entry.operation === "destroy")
            ).to.have.length(0);
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN", {
                after: retry
            });
        } finally {
            await pool.close();
        }
    });

    it("keeps concurrent attempt artifact transfers isolated by request", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.artifactTransferDelayMs = 10;
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("artifacts");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            await orchestrator.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 2
            });
            await orchestrator.waitFor(worker.name, "WORKER_READY");

            const evidence = Buffer.from("failed attempt\n");
            backend.artifactOutput = {
                stdout: evidence,
                stderr: Buffer.alloc(0)
            };
            const manifest = [
                {
                    name: "stdout",
                    bytes: evidence.length,
                    sha256: crypto
                        .createHash("sha256")
                        .update(evidence)
                        .digest("hex")
                },
                {
                    name: "stderr",
                    bytes: 0,
                    sha256: crypto
                        .createHash("sha256")
                        .update(Buffer.alloc(0))
                        .digest("hex")
                }
            ];
            const taskFlow = orchestrator.checkpoint();
            for (const requestId of [41, 42]) {
                backend.emitWorkerEvent(
                    {
                        kind: "ATTEMPT_READY",
                        requestId,
                        assignment: {
                            taskId: `task-${requestId}`,
                            attemptId: `attempt-${requestId}`
                        },
                        result: { code: 1, reduced: { starveCount: 0 } }
                    },
                    manifest
                );
            }

            await Promise.all(
                [41, 42].map((requestId) =>
                    orchestrator.waitFor(worker.name, "ATTEMPT_RESULT", {
                        after: taskFlow,
                        predicate: (event) =>
                            event.header.requestId === requestId
                    })
                )
            );
            expect(
                orchestrator.count(worker.name, "LOG_END", taskFlow)
            ).to.equal(2);
            expect(
                orchestrator.count(worker.name, "ATTEMPT_RESULT", taskFlow)
            ).to.equal(2);

            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN");
        } finally {
            await pool.close();
        }
    });

    it("times out a stalled artifact transfer and grants a later lease", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.completeArtifactTransfer = false;
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend,
                artifactTransferTimeoutMs: 30
            });
            const first = await pool.startOrchestrator("artifact-stall");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            const second = await pool.startOrchestrator("after-stall");
            await second.waitFor(worker.name, "BUSY");
            await first.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await first.waitFor(worker.name, "WORKSPACE_NEED");
            await first.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await first.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await first.waitFor(worker.name, "PREPARED");
            await first.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1
            });
            await first.waitFor(worker.name, "WORKER_READY");
            const promotion = second.checkpoint();
            backend.emitWorkerEvent(
                {
                    kind: "ATTEMPT_READY",
                    requestId: 31,
                    assignment: {
                        taskId: "stalled",
                        attemptId: "stalled-attempt"
                    },
                    result: { code: 1, reduced: { starveCount: 0 } }
                },
                [
                    {
                        name: "stdout",
                        bytes: 0,
                        sha256: crypto
                            .createHash("sha256")
                            .update(Buffer.alloc(0))
                            .digest("hex")
                    },
                    {
                        name: "stderr",
                        bytes: 0,
                        sha256: crypto
                            .createHash("sha256")
                            .update(Buffer.alloc(0))
                            .digest("hex")
                    }
                ]
            );
            await first.waitFor(worker.name, "WORKER_ERROR");
            await second.waitFor(worker.name, "LEASE_GRANTED", {
                after: promotion
            });
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN", {
                after: promotion
            });
        } finally {
            await pool.close();
        }
    });

    it("treats release racing resource teardown as an idempotent clean end", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("limit-release");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            await orchestrator.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1,
                extensions: { resourceLimitDetails: true }
            });
            await orchestrator.waitFor(worker.name, "WORKER_READY");
            const checkpoint = orchestrator.checkpoint();
            backend.emitResourceLimit({
                resource: "memory",
                limit: 1024,
                phase: "execution",
                message: "cgroup OOM"
            });
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "RESOURCE_LIMIT_EXCEEDED", {
                after: checkpoint
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(
                orchestrator.received(
                    worker.name,
                    "PREPARATION_ERROR",
                    checkpoint
                )
            ).to.equal(false);
            expect(
                orchestrator.received(worker.name, "WORKER_ERROR", checkpoint)
            ).to.equal(false);
        } finally {
            await pool.close();
        }
    });

    it("degrades a mid-run worker exit resource classification to the existing worker error", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        backend.exitClassification = {
            resource: "memory",
            limit: 1024,
            phase: "execution",
            message: "cgroup OOM"
        };
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("old-run");
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED");
            await orchestrator.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await orchestrator.waitFor(worker.name, "WORKSPACE_NEED");
            await orchestrator.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await orchestrator.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await orchestrator.waitFor(worker.name, "PREPARED");
            await orchestrator.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1
            });
            await orchestrator.waitFor(worker.name, "WORKER_READY");
            backend.emitWorkerEvent({
                kind: "ISOLATED_WORKER_EXIT",
                code: 137,
                signal: null
            });

            const failure = await orchestrator.waitFor(
                worker.name,
                "WORKER_ERROR"
            );
            expect(failure.header.message).to.equal(
                "Isolated worker exceeded its memory limit"
            );
        } finally {
            await pool.close();
        }
    });

    it("reports an unclassified mid-run worker exit and grants the next lease", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const first = await pool.startOrchestrator("unexpected-exit");
            await first.waitFor(worker.name, "LEASE_GRANTED");
            const second = await pool.startOrchestrator("after-exit");
            await second.waitFor(worker.name, "BUSY");
            await first.send(
                worker.name,
                "WORKSPACE_OFFER",
                { manifest: workspaceManifest },
                Buffer.from(JSON.stringify(sourceFiles))
            );
            await first.waitFor(worker.name, "WORKSPACE_NEED");
            await first.send(worker.name, "BUNDLE_META", {
                manifest: {
                    ...workspaceManifest,
                    fileCount: 0,
                    expandedBytes: 0,
                    archiveBytes: 0,
                    archiveSha256: emptySourceSha256
                }
            });
            await first.send(worker.name, "BUNDLE_END", {
                byteCount: 0,
                sha256: emptySourceSha256
            });
            await first.waitFor(worker.name, "PREPARED");
            await first.send(worker.name, "RUN_CONFIG", {
                baseEnv: {},
                taskCount: 1
            });
            await first.waitFor(worker.name, "WORKER_READY");
            const promotion = second.checkpoint();
            backend.emitWorkerEvent({
                kind: "ISOLATED_WORKER_EXIT",
                code: 1,
                signal: null
            });
            const failure = await first.waitFor(worker.name, "WORKER_ERROR");
            expect(failure.header.message).to.equal(
                "Isolated environment failed; see infrastructure log"
            );
            await second.waitFor(worker.name, "LEASE_GRANTED", {
                after: promotion
            });
            await second.send(worker.name, "RELEASE");
            await second.waitFor(worker.name, "LEASE_CLEAN", {
                after: promotion
            });
        } finally {
            await pool.close();
        }
    });
});
