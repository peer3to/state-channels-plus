// @spec-test-coverage-ignore: repository-local runner scheduling and diagnostics
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { TestIsolatedRuntimeBackend } from "./isolatedRuntimeBackend";
import { LeasePoolHarness } from "./leasePool";
import { waitFor } from "../../utils/waitFor";
import { cacheTask, CacheTask } from "./durationCache";
const {
    WorkerScheduler
} = require("../../../scripts/e2e-parallel/shared/workerScheduler");
const {
    reduceAttemptOutput
} = require("../../../scripts/e2e-parallel/shared/taskCoordinator");
const {
    runDistributed
} = require("../../../scripts/e2e-parallel/distributed/orchestrator");
const {
    DISTRIBUTED_PROTOCOL_VERSION
} = require("../../../scripts/e2e-parallel/distributed/protocol");

type Assignment = {
    attemptId: string;
    taskId: string;
    seq: number;
    task: { label: string; logName: string; args: unknown[] };
};
type ResultChoice = { code: number; starved?: boolean };
type ParticipantFrame = {
    kind: string;
    payload: {
        requestId?: number;
        message?: {
            kind: string;
            requestId?: number;
            value?: Assignment | null;
        };
    };
};

export class TaskParticipant {
    readonly assignments: Assignment[] = [];
    readonly started: Assignment[] = [];
    readonly responses: Array<Assignment | null> = [];
    readonly errors: Error[] = [];
    readonly scheduler;
    capacity = 1;
    disconnect: () => Promise<void> = async () => {};
    private nextRequestId = 1;
    // Request IDs identify protocol replies; attempt IDs identify completion gates.
    private readonly pending = new Map<
        number,
        (value: Assignment | null) => void
    >();
    private readonly releases = new Map<
        string,
        (value: ResultChoice) => void
    >();
    constructor(readonly backend: TestIsolatedRuntimeBackend) {
        this.scheduler = new WorkerScheduler({
            prefetch: true,
            retryMs: 10,
            canRun: async (running: number) => running < this.capacity,
            requestTask: async () => {
                const result = await this.request({ kind: "TASK_REQUEST" });
                this.responses.push(result);
                if (result) this.assignments.push(result);
                return result;
            },
            runTask: async (assignment: Assignment) => {
                this.started.push(assignment);
                const choice = await new Promise<ResultChoice>((resolve) =>
                    this.releases.set(assignment.attemptId, resolve)
                );
                this.releases.delete(assignment.attemptId);
                if (this.scheduler.stopped) return;
                const evidence = Buffer.from(
                    choice.starved
                        ? "starved task fixture\n"
                        : "task fixture failed\n"
                );
                const reduced = {
                    ...reduceAttemptOutput(),
                    starveCount: choice.starved ? 1 : 0
                };
                this.backend.artifactChunks = [
                    { name: "stdout", body: evidence },
                    { name: "stderr", body: Buffer.alloc(0) }
                ];
                const manifest =
                    choice.code !== 0 || choice.starved
                        ? [
                              {
                                  name: "stdout",
                                  bytes: evidence.length,
                                  sha256: crypto
                                      .createHash("sha256")
                                      .update(evidence)
                                      .digest("hex")
                              }
                          ]
                        : [];
                await this.request(
                    {
                        kind: "ATTEMPT_READY",
                        assignment,
                        result: {
                            label: assignment.task.label,
                            code: choice.code,
                            durationMs: 30,
                            reduced
                        }
                    },
                    manifest
                );
            },
            onError: (error: Error) => this.errors.push(error)
        });
        backend.frames.on("frame", (frame: ParticipantFrame) => {
            // The guest acknowledges artifact completion even when no logs transfer.
            if (
                frame.kind === "ARTIFACT_COMMITTED" &&
                frame.payload.requestId !== undefined
            ) {
                const resolve = this.pending.get(frame.payload.requestId);
                this.pending.delete(frame.payload.requestId);
                resolve?.(null);
            }
            if (frame.kind === "RUN_CONFIG")
                queueMicrotask(() => this.scheduler.start());
            if (frame.kind !== "WORKER_MESSAGE") return;
            const message = frame.payload.message;
            if (
                message?.kind === "RESPONSE" &&
                message.requestId !== undefined
            ) {
                const resolve = this.pending.get(message.requestId);
                this.pending.delete(message.requestId);
                resolve?.(message.value || null);
            }
            if (message?.kind === "WORK_AVAILABLE")
                this.scheduler.workAvailable();
            if (
                ["RUN_COMPLETE", "CANCEL", "RELEASE"].includes(
                    message?.kind || ""
                )
            )
                this.stop();
        });
    }
    private request(
        message: Record<string, unknown>,
        manifest: unknown[] = []
    ) {
        const requestId = this.nextRequestId++;
        return new Promise<Assignment | null>((resolve) => {
            this.pending.set(requestId, resolve);
            this.backend.emitWorkerEvent({ ...message, requestId }, manifest);
        });
    }
    release(assignment: Assignment, choice: ResultChoice = { code: 0 }) {
        this.releases.get(assignment.attemptId)?.(choice);
    }
    stop() {
        this.scheduler.stop();
        for (const release of this.releases.values()) release({ code: 0 });
        for (const resolve of this.pending.values()) resolve(null);
        this.pending.clear();
    }
}

export class TaskRunFixture {
    readonly root = fs.mkdtempSync(
        path.join(os.tmpdir(), "duration-task-run-")
    );
    readonly cancellation = new AbortController();
    readonly participants: TaskParticipant[] = [];
    private running?: Promise<{
        completed: number;
        failed: CacheTask[];
        labelFor: (worker: string) => string;
    }>;
    private constructor(readonly pool: LeasePoolHarness) {}
    static async create() {
        return new TaskRunFixture(await LeasePoolHarness.create());
    }
    async addServer(name: string) {
        const participant = new TaskParticipant(
            new TestIsolatedRuntimeBackend()
        );
        this.participants.push(participant);
        const server = await this.pool.startServer(name, {
            environmentBackend: participant.backend
        });
        participant.disconnect = () => server.shutdown();
        return participant;
    }
    run(tasks: CacheTask[], frontStarvationRetry = false) {
        const source = Buffer.from("source");
        fs.writeFileSync(path.join(this.root, "source.txt"), source);
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
            workspaceId: "a".repeat(64),
            sourceDigest: crypto
                .createHash("sha256")
                .update(source)
                .digest("hex"),
            rootProjectPath: ".",
            repositories: [],
            files: [
                {
                    path: "source.txt",
                    bytes: source.length,
                    sha256: crypto
                        .createHash("sha256")
                        .update(source)
                        .digest("hex"),
                    mode: 0o644
                }
            ],
            fileCount: 1,
            expandedBytes: source.length
        };
        Object.defineProperty(manifest, "localWorkspaceRoot", {
            value: this.root,
            enumerable: false
        });
        this.running = runDistributed({
            tasks,
            frontStarvationRetry,
            projectRoot: this.root,
            archivePath: path.join(this.root, "bundle.tgz"),
            manifest,
            logDir: path.join(this.root, "logs"),
            poolSecret: this.pool.poolSecret,
            discoveryTimeoutMs: 10000,
            discoveryRefreshMs: 25,
            baseEnv: {},
            signal: this.cancellation.signal,
            dht: this.pool.createOrchestratorDht()
        });
        return this.running!;
    }
    async close() {
        this.cancellation.abort();
        for (const participant of this.participants) participant.stop();
        await this.running?.catch(() => undefined);
        await this.pool.close();
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}

export async function runOrderedTasks(labels: string[]) {
    const fixture = await TaskRunFixture.create();
    try {
        const p = await fixture.addServer("duration-worker");
        const tasks = labels.map(cacheTask);
        const run = fixture.run(tasks);
        for (let i = 0; i < tasks.length; i++) {
            await waitFor(() => p.started.length > i);
            p.release(p.started[i]);
        }
        const result = await run;
        return {
            labels: p.assignments.map((a) => a.task.label),
            tasks,
            result,
            errors: p.errors
        };
    } finally {
        await fixture.close();
    }
}
