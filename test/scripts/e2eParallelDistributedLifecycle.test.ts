import { expect } from "chai";
import { LeasePoolHarness } from "../fixtures/distributed/leasePool";

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
});
