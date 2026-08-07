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
    getAttemptLogPath,
    getErrorLogPath,
    getLogPath
} = require("../../scripts/e2e-parallel/shared/logging.js");
const {
    aggregateWorkerStats,
    createHeartbeatMonitor,
    promoteAttemptLog,
    validateWorkerStats
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    shouldTransferAttemptLog
} = require("../../scripts/e2e-parallel/distributed/server.js");

describe("distributed orchestrator logs", function () {
    it("transfers attempt logs only for failures", function () {
        expect(shouldTransferAttemptLog({ code: 0 })).to.equal(false);
        expect(shouldTransferAttemptLog({ code: 1 })).to.equal(true);
        expect(
            shouldTransferAttemptLog({
                code: 0,
                infrastructureFailure: "output spool failed"
            })
        ).to.equal(true);
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
            peakOccupiedGb: 7,
            avgPerTestGb: 1.5,
            memBoundGb: 14
        });
        expect(aggregateWorkerStats([{ memoryGb: 9 }]).memBoundGb).to.equal(9);
        expect(() => validateWorkerStats({ peakCpu: "not-a-number" })).to.throw(
            "invalid resource statistics"
        );
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
                getAttemptLogPath(root, logName, "693")
            ];
            for (const filePath of paths) {
                expect(
                    Buffer.byteLength(path.basename(filePath))
                ).to.be.at.most(255);
                fs.closeSync(fs.openSync(filePath, "wx"));
            }
            expect(path.basename(paths[1])).to.match(/^error_/);
            expect(path.basename(paths[2])).to.match(/\.attempt-693\.ansi$/);
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
