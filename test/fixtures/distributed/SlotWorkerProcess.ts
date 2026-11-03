// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { repoRoot } from "@test/utils/repoRoot";
import { type ChildProcess, execFileSync, fork } from "child_process";
import { once } from "events";
import fs from "fs";
import os from "os";
import path from "path";

const WORKER_ENTRY = path.join(
    repoRoot(),
    "scripts/e2e-parallel/distributed/worker.js"
);
/** How long the worker may take to start its slot or to report its failure. */
const WAIT_MS = 60_000;

/** A message the worker sent over IPC. */
export type WorkerMessage = { kind: string } & Record<string, unknown>;

/**
 * The distributed worker as its guest forks it, over one real slot (chain
 * node, discovery and storage diff service). It answers each request with no
 * task, so the worker idles on its slot.
 */
export class SlotWorkerProcess {
    readonly messages: WorkerMessage[] = [];
    private readonly child: ChildProcess;
    private readonly root: string;
    private readonly exited: Promise<unknown>;

    private constructor(child: ChildProcess, root: string) {
        this.child = child;
        this.root = root;
        this.exited = once(child, "exit");
        child.on("message", (message: WorkerMessage) => {
            this.messages.push(message);
            if (typeof message.requestId === "number")
                child.send({
                    kind: "RESPONSE",
                    requestId: message.requestId,
                    value: null
                });
        });
    }

    static async start(): Promise<SlotWorkerProcess> {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "slot-worker-"));
        const child = fork(WORKER_ENTRY, [], {
            cwd: repoRoot(),
            stdio: ["ignore", "ignore", "ignore", "ipc"]
        });
        const worker = new SlotWorkerProcess(child, root);
        try {
            child.send({
                kind: "START",
                config: {
                    slotCount: 1,
                    concurrencyCap: 1,
                    schedulerTickMs: 100,
                    cpuLimit: os.cpus().length,
                    targetLoad: 0.8,
                    memBoundGb: 4,
                    maxAttemptSpoolBytes: 1024 * 1024,
                    heartbeatTimeoutMs: 15_000,
                    taskCount: 0,
                    baseEnv: {},
                    projectRoot: repoRoot(),
                    infraLogDir: path.join(root, "infra"),
                    spoolRoot: path.join(root, "spool")
                }
            });
            await worker.waitFor((message) => message.kind === "WORKER_READY");
        } catch (error) {
            await worker.close();
            throw error;
        }
        return worker;
    }

    /** The pid of the slot's storage diff service, a child of the worker. */
    servicePid(): number {
        const pids = execFileSync("pgrep", [
            "-P",
            String(this.child.pid),
            "-f",
            "storage-diff-service.js"
        ])
            .toString()
            .trim()
            .split("\n");
        if (pids.length !== 1)
            throw new Error(`Expected one slot service, found ${pids.length}`);
        return Number(pids[0]);
    }

    /** The first message `predicate` accepts, waiting for it if none has. */
    async waitFor(
        predicate: (message: WorkerMessage) => boolean
    ): Promise<WorkerMessage> {
        const deadline = Date.now() + WAIT_MS;
        for (;;) {
            const found = this.messages.find(predicate);
            if (found) return found;
            if (this.child.exitCode !== null)
                throw new Error("The worker exited before the message");
            if (Date.now() > deadline)
                throw new Error("The worker did not send the message");
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    /** Sends `message` to the worker. */
    send(message: WorkerMessage): void {
        this.child.send(message);
    }

    /** The infrastructure log the worker uploaded for `processKind`. */
    uploadedLog(processKind: string): string {
        return this.messages
            .filter(
                (message) =>
                    message.kind === "INFRA_PROCESS_DIAGNOSTIC" &&
                    message.processKind === processKind
            )
            .map((message) =>
                Buffer.from(String(message.logChunk), "base64").toString()
            )
            .join("");
    }

    /** Cancels the worker, which tears its slot down, and removes its files. */
    async close(): Promise<void> {
        if (this.child.exitCode === null && this.child.signalCode === null) {
            if (this.child.connected) this.child.send({ kind: "CANCEL" });
            await this.exited;
        }
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}
