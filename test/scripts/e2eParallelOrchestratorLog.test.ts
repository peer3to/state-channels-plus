// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

const {
    OrchestratorLogStore,
    sanitizeWorkerLabel
} = require("../../scripts/e2e-parallel/distributed/orchestratorLogStore.js");
const {
    WorkerAttemptSpool
} = require("../../scripts/e2e-parallel/distributed/workerAttemptSpool.js");
const {
    reduceAttemptOutput
} = require("../../scripts/e2e-parallel/shared/taskCoordinator.js");
const {
    getAttemptLogPath,
    getErrorLogPath,
    getLogPath,
    getStarvationLogPath
} = require("../../scripts/e2e-parallel/shared/logging.js");
const {
    WORKER_COLORS,
    aggregateWorkerStats,
    coordinatorResultActions,
    createWorkerColorRegistry,
    createHeartbeatMonitor,
    formatWorkerSummary,
    promoteAttemptLog,
    promoteStarvationAttemptLog,
    recordWorkerFailure,
    validateWorkerStats,
    workerFaultStatus
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    acknowledgeLoglessAttempt,
    shouldTransferAttemptEvidence
} = require("../../scripts/e2e-parallel/distributed/server.js");

describe("distributed orchestrator logs", function () {
    it("keeps worker colors stable across reconnects", function () {
        const registry = createWorkerColorRegistry(["one", "two", "three"]);
        expect(registry.colorFor("id-a", "worker-a")).to.equal("one");
        expect(registry.colorFor("id-b", "worker-b")).to.equal("two");
        expect(registry.colorFor("id-a", "worker-a")).to.equal("one");
        expect(registry.colorFor("new-id-a", "worker-a")).to.equal("one");
        expect(registry.colorFor("id-c", "worker-c")).to.equal("three");
        expect(WORKER_COLORS.length).to.be.at.least(10);
        for (const warningColor of [
            "\x1b[38;5;203m",
            "\x1b[38;5;208m",
            "\x1b[38;5;221m",
            "\x1b[38;5;228m"
        ]) {
            expect(WORKER_COLORS).not.to.include(warningColor);
        }
    });

    it("prints worker faults in red with the worker name", function () {
        let output = "";
        workerFaultStatus({ label: "server-3" }, "FAULTED: restart required", {
            write: (chunk: string) => (output += chunk)
        });
        expect(output).to.equal(
            "\u001b[31m[server-3] FAULTED: restart required\u001b[0m\n"
        );
    });

    it("transfers attempt logs for failures and starvation", function () {
        expect(shouldTransferAttemptEvidence({ code: 0 })).to.equal(false);
        expect(shouldTransferAttemptEvidence({ code: 1 })).to.equal(true);
        expect(
            shouldTransferAttemptEvidence({
                code: 0,
                reduced: { starveCount: 1 }
            })
        ).to.equal(true);
        expect(
            shouldTransferAttemptEvidence({
                code: 0,
                infrastructureFailure: "output spool failed"
            })
        ).to.equal(true);
    });

    it("acknowledges a successful attempt without waiting for a log", function () {
        const sent: Array<Record<string, unknown>> = [];
        const connection = {
            environment: {
                state: "ready",
                async send(kind: string, payload: Record<string, unknown>) {
                    sent.push({ kind, payload });
                }
            }
        };
        acknowledgeLoglessAttempt(connection, 17, false);
        acknowledgeLoglessAttempt(connection, 18, true);
        expect(sent).to.deep.equal([
            {
                kind: "WORKER_MESSAGE",
                payload: {
                    message: { kind: "RESPONSE", requestId: 17, value: true }
                }
            }
        ]);
    });

    it("reduces successful spooled output without uploading it", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "spool-reduce-"));
        try {
            const spool = new WorkerAttemptSpool(
                path.join(root, "attempt.spool"),
                1024 * 1024
            );
            spool.write(
                "stdout",
                '##E2E_TIMING## {"startupMs":12,"deployMs":4}\n'
            );
            spool.write(
                "stderr",
                "Event loop delay 1200ms exceeded configured threshold 1000ms\n"
            );
            const output = spool.readOutput();
            const reduced = reduceAttemptOutput(output.stdout, output.stderr);
            expect(reduced.starveCount).to.equal(1);
            expect(reduced.timing).to.include({
                startupMs: 12,
                deployMs: 4,
                found: true
            });
            spool.remove();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reads attempt spool chunks in chronological stream order", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "spool-order-"));
        try {
            const spool = new WorkerAttemptSpool(
                path.join(root, "attempt.spool"),
                1024 * 1024
            );
            spool.write("stdout", "before");
            spool.write("stderr", "between");
            spool.write("stdout", "after");
            expect(
                [...spool.readRecords(4)].map(
                    (record: { stream: string; body: Buffer }) =>
                        `${record.stream}:${record.body.toString()}`
                )
            ).to.deep.equal([
                "stdout:befo",
                "stdout:re",
                "stderr:betw",
                "stderr:een",
                "stdout:afte",
                "stdout:r"
            ]);
            spool.remove();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("parses runtime readiness separately from event-loop delay", function () {
        const reduced = reduceAttemptOutput(
            [
                '##E2E_TIMING## {"runtimeReadyMs":40}',
                '##E2E_TIMING## {"maxEventLoopDelayMs":300,"elThread":"sdk"}'
            ].join("\n"),
            ""
        );
        expect(reduced.starveCount).to.equal(0);
        expect(reduced.timing.runtimeReadyMs).to.equal(40);
        expect(reduced.timing.el.sdk).to.equal(300);
        expect(reduced.timing.maxEventLoopDelayMs).to.equal(300);
    });

    it("promotes a provisional failure after its worker disconnects", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-result-")
        );
        const assignment = {
            attemptId: "7",
            task: { logName: "provisional failure" }
        };
        try {
            const attemptPath = getAttemptLogPath(
                root,
                assignment.task.logName,
                assignment.attemptId
            );
            fs.writeFileSync(attemptPath, "failed output");
            expect(() =>
                promoteAttemptLog(root, assignment, undefined, 1)
            ).to.not.throw();
            expect(
                fs.readFileSync(
                    getErrorLogPath(root, assignment.task.logName),
                    "utf8"
                )
            ).to.equal("failed output");
            expect(fs.existsSync(attemptPath)).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("retains a starved attempt before scheduling its clean retry", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-starvation-")
        );
        const assignment = {
            attemptId: "8",
            task: { logName: "starved attempt" }
        };
        try {
            const attemptPath = getAttemptLogPath(
                root,
                assignment.task.logName,
                assignment.attemptId
            );
            fs.writeFileSync(attemptPath, "starved output");
            promoteStarvationAttemptLog(root, assignment, undefined);
            expect(
                fs.readFileSync(
                    getStarvationLogPath(root, assignment.task.logName),
                    "utf8"
                )
            ).to.equal("starved output");
            expect(fs.existsSync(attemptPath)).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reports a late speculative failure without counting it twice", function () {
        expect(coordinatorResultActions("complete")).to.deep.equal({
            countCompletion: true,
            report: true
        });
        expect(coordinatorResultActions("late-failure")).to.deep.equal({
            countCompletion: false,
            report: true
        });
        expect(coordinatorResultActions("retry-starvation")).to.deep.equal({
            countCompletion: false,
            report: false
        });
    });

    it("expires a server that stops sending application frames", async function () {
        const peer = new EventEmitter() as EventEmitter & {
            send: () => Promise<void>;
        };
        peer.send = async () => {};
        let timedOut = false;
        const monitor = createHeartbeatMonitor(peer, 25, () => {
            timedOut = true;
            monitor.stop();
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(timedOut).to.equal(true);
    });

    it("aggregates real resource samples across workers", function () {
        const stats = aggregateWorkerStats([
            {
                stats: {
                    peakCpu: 0.8,
                    avgCpu: 0.5,
                    cpuSampleCount: 3,
                    peakOccupiedGb: 4,
                    avgPerTestGb: 1,
                    memorySampleCount: 2,
                    memBoundGb: 8
                }
            },
            {
                stats: {
                    peakCpu: 0.6,
                    avgCpu: 0.2,
                    cpuSampleCount: 1,
                    peakOccupiedGb: 3,
                    avgPerTestGb: 2,
                    memorySampleCount: 2,
                    memBoundGb: 6
                }
            }
        ]);
        expect(stats).to.deep.equal({
            peakCpu: 0.8,
            avgCpu: 0.425,
            sumPeakOccupiedGb: 7,
            avgPerTestGb: 1.5,
            memBoundGb: 14
        });
        expect(aggregateWorkerStats([{ memoryGb: 9 }]).memBoundGb).to.equal(9);
        expect(() => validateWorkerStats({ peakCpu: "not-a-number" })).to.throw(
            "invalid resource statistics"
        );
    });

    it("quarantines a stable worker identity after repeated failures", function () {
        const failures = new Map();
        const ignored = new Set();
        expect(
            recordWorkerFailure(failures, ignored, "bad-worker")
        ).to.deep.equal({ failures: 1, quarantined: false });
        expect(ignored.has("healthy-worker")).to.equal(false);
        expect(
            recordWorkerFailure(failures, ignored, "bad-worker")
        ).to.deep.equal({ failures: 2, quarantined: true });
        expect(ignored.has("bad-worker")).to.equal(true);
    });

    it("prints per-worker resource peaks and bounds", function () {
        const line = formatWorkerSummary(
            {
                color: "",
                label: "server-2",
                capabilities: { slots: 1, workers: 4, memoryGb: 12 },
                executionProfile: { workers: 2 },
                stats: {
                    peakCpu: 0.9,
                    avgCpu: 0.6,
                    peakOccupiedGb: 8,
                    avgPerTestGb: 1.25,
                    memBoundGb: 10
                }
            },
            17
        );
        expect(line).to.include("server-2");
        expect(line).to.include("1 slots, 2 workers (max 4), 12GB");
        expect(line).to.include("17 tests");
        expect(line).to.include("cpu avg 60% / peak 90%");
        expect(line).to.include("mem peak 8.0GB / bound 10.0GB");
    });

    it("keeps canonical, failure, and attempt filenames within filesystem limits", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-log-")
        );
        const logName = `${"long-test-name_".repeat(20)}deadbeef`;
        try {
            const paths = [
                getLogPath(root, logName),
                getErrorLogPath(root, logName),
                getStarvationLogPath(root, logName),
                getAttemptLogPath(root, logName, "693")
            ];
            for (const filePath of paths) {
                expect(
                    Buffer.byteLength(path.basename(filePath))
                ).to.be.at.most(255);
                fs.closeSync(fs.openSync(filePath, "wx"));
            }
            expect(path.basename(paths[1])).to.match(/^error_/);
            expect(path.basename(paths[2])).to.match(/^error_starvation_/);
            expect(path.basename(paths[3])).to.match(/\.attempt-693\.ansi$/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("writes exact ordered ANSI bytes and commits only the matching hash", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-log-")
        );
        try {
            const store = new OrchestratorLogStore(root);
            const filePath = path.join(root, "attempt.ansi");
            const encoder = new TextEncoder();
            const first = encoder.encode("\u001b[31mred");
            const second = encoder.encode(" output\u001b[0m\n");
            store.begin("attempt", filePath);
            store.append("attempt", 0, first);
            store.append("attempt", 1, second);
            const bytes = new Uint8Array(first.length + second.length);
            bytes.set(first);
            bytes.set(second, first.length);
            store.commit("attempt", {
                sequence: 2,
                byteCount: bytes.length,
                sha256: crypto.createHash("sha256").update(bytes).digest("hex")
            });
            expect([...fs.readFileSync(filePath)]).to.deep.equal([...bytes]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("writes failed discovery and hardhat process logs separately", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-process-log-")
        );
        try {
            const store = new OrchestratorLogStore(root);
            expect(
                store.writeInfrastructureProcessChunk(
                    "worker-id",
                    "worker-one",
                    "discovery",
                    0,
                    "discovery process exited",
                    "slot 0 discovery exited (code 1)",
                    "upload-1",
                    0,
                    2,
                    Buffer.from("latest \u001b[31mdiscovery ")
                )
            ).to.equal(undefined);
            const discoveryPath = store.writeInfrastructureProcessChunk(
                "worker-id",
                "worker-one",
                "discovery",
                0,
                "discovery process exited",
                "slot 0 discovery exited (code 1)",
                "upload-1",
                1,
                2,
                Buffer.from("output\u001b[0m\n")
            );
            const hardhatPath = store.writeInfrastructureProcessSnapshot(
                "second-worker-id",
                "worker-two",
                "hardhat",
                1,
                "hardhat process exited",
                "slot 1 hardhat node exited (signal SIGKILL)",
                Buffer.from("hardhat fatal output\n")
            );

            expect(discoveryPath).to.equal(
                path.join(root, "infra", "discovery-server.ansi")
            );
            expect(hardhatPath).to.equal(
                path.join(root, "infra", "hardhat-node.ansi")
            );
            const discovery = fs.readFileSync(discoveryPath, "utf8");
            const hardhat = fs.readFileSync(hardhatPath, "utf8");
            expect(discovery).to.include("=== worker-one slot 0 ===");
            expect(discovery).to.include(
                "trigger: discovery process exited; process failure: slot 0 discovery exited (code 1)"
            );
            expect(discovery).to.include(
                "latest \u001b[31mdiscovery output\u001b[0m"
            );
            expect(discovery).to.not.include("hardhat fatal output");
            expect(hardhat).to.include("=== worker-two slot 1 ===");
            expect(hardhat).to.include(
                "trigger: hardhat process exited; process failure: slot 1 hardhat node exited (signal SIGKILL)"
            );
            expect(hardhat).to.include("hardhat fatal output");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps successful hardhat output without marking infrastructure failed", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-successful-process-log-")
        );
        try {
            const store = new OrchestratorLogStore(root);
            const hardhatPath = store.writeInfrastructureProcessSnapshot(
                "worker-id",
                "worker-one",
                "hardhat",
                0,
                "run completed with --keep-infra-logs",
                "",
                Buffer.from("[mental-poker-precompile] success\n")
            );

            expect(fs.readFileSync(hardhatPath, "utf8")).to.include(
                "[mental-poker-precompile] success"
            );
            expect(
                fs.existsSync(path.join(root, "infra", ".failure"))
            ).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("writes isolated worker exits as persistent runtime diagnostics", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-runtime-log-")
        );
        try {
            const store = new OrchestratorLogStore(root);
            const runtimePath = store.writeInfrastructureProcessChunk(
                "worker-id",
                "worker-one",
                "isolated-runtime",
                undefined,
                "isolated environment failed",
                "Test worker exited unexpectedly (1)",
                "runtime-upload",
                0,
                1,
                Buffer.from(
                    '{"status":"running","exitCode":0,"oomKilled":false}'
                )
            );

            expect(runtimePath).to.equal(
                path.join(root, "infra", "isolated-runtime.ansi")
            );
            expect(
                fs.existsSync(path.join(root, "infra", ".failure"))
            ).to.equal(true);
            const runtime = fs.readFileSync(runtimePath, "utf8");
            expect(runtime).to.include("=== worker-one ===");
            expect(runtime).to.include(
                "process failure: Test worker exited unexpectedly (1)"
            );
            expect(runtime).to.include('"oomKilled":false');
            expect(runtime).not.to.include("slot undefined");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects duplicate sequences, bad checksums, and hostile worker paths", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "orchestrator-log-")
        );
        try {
            const store = new OrchestratorLogStore(root);
            const filePath = path.join(root, "attempt.ansi");
            store.begin("attempt", filePath);
            store.append("attempt", 0, Buffer.from("x"));
            expect(() => store.append("attempt", 0, Buffer.from("x"))).to.throw(
                /Out-of-order/
            );
            expect(() =>
                store.commit("attempt", {
                    sequence: 1,
                    byteCount: 1,
                    sha256: "bad"
                })
            ).to.throw(/checksum/);
            const diagnostic = store.infrastructurePath(
                "id",
                "../../hostile worker",
                "../outside"
            );
            expect(
                diagnostic.startsWith(path.join(root, "infra") + path.sep)
            ).to.equal(true);
            expect(path.basename(diagnostic)).to.equal("outside");
            expect(() => sanitizeWorkerLabel("😈")).to.throw(/empty/);
            expect(() =>
                store.writeInfrastructureProcessSnapshot(
                    "id",
                    "worker",
                    "../outside",
                    0,
                    "process exited",
                    "code 1",
                    Buffer.alloc(0)
                )
            ).to.throw(/Unknown infrastructure process/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("fails only the attempt when its bounded spool fills", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-spool-"));
        try {
            const spool = new WorkerAttemptSpool(path.join(root, "attempt"), 8);
            expect(() => spool.write("stdout", Buffer.alloc(4))).to.throw(
                /limit/
            );
            spool.remove();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
