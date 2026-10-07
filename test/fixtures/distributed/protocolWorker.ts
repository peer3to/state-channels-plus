// @spec-test-coverage-ignore: shared distributed-worker fixture exercised by developer tooling tests
import { TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS } from "./testTransport";

const {
    authenticateServer
} = require("../../../scripts/e2e-parallel/distributed/authentication.js");
const {
    derivePoolKeys
} = require("../../../scripts/e2e-parallel/distributed/authentication.js");
const {
    runDistributed
} = require("../../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    createPool
} = require("../../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    ProtocolPeer,
    waitForMessage
} = require("../../../scripts/e2e-parallel/distributed/protocol.js");

type Message = { kind: string; header: Record<string, any> };

/** The next message of any of `kinds`, pending or arriving. */
function waitForEither(
    peer: {
        takePending: (kind: string) => Message | null;
        on: (event: string, listener: (message: Message) => void) => void;
        off: (event: string, listener: (message: Message) => void) => void;
    },
    kinds: string[]
): Promise<Message> {
    for (const kind of kinds) {
        const pending = peer.takePending(kind);
        if (pending) return Promise.resolve(pending);
    }
    return new Promise((resolve) => {
        const onMessage = (message: Message) => {
            if (!kinds.includes(message.kind)) return;
            peer.off("message", onMessage);
            resolve(message);
        };
        peer.on("message", onMessage);
    });
}

type PoolKeys = {
    authKey: Buffer;
    workerTopic: Buffer;
    orchestratorTopic: Buffer;
};

/** What one worker host was offered and handed during a run. */
export type ProtocolWorkerRecord = {
    name: string;
    offeredProtocol: number | null;
    // The manifest header of the last workspace offer, as it crossed the wire.
    offeredManifest: Record<string, unknown> | null;
    runners: string[];
    labels: string[];
    // The cost each assignment carried on the wire, absent under fifo.
    costs: unknown[];
    workspaceOffers: number;
};

type HoldFirstResultUntil = {
    worker: string;
    workspaceOffers?: number;
    labels?: number;
};

/**
 * How a host answers the workspace offer of one lease: a need naming a file the
 * manifest does not offer, a need that is not a diff, a normal lease that
 * closes the connection after running one task, a lease that leaves the pool
 * for good on its first task without reporting a result, a host that refuses
 * the lease's resources, or a host that closes the connection unannounced.
 */
export type ProtocolWorkerLeaseStep =
    | "outside-manifest"
    | "invalid-diff"
    | "one-task-then-close"
    | "leave-on-first-task"
    | "reject-allocation"
    | "close-after-offer";

/**
 * A worker host on the local DHT that declares `distributedProtocol` and
 * speaks the lease, workspace and task protocol just far enough for the real
 * orchestrator to schedule on it: every assigned task passes at once. It
 * records the protocol its workspace offer declared and every task it ran.
 */
async function startProtocolWorker(options: {
    name: string;
    distributedProtocol: number;
    keys: PoolKeys;
    dht: unknown;
    // One step per lease in order; leases past the end behave normally.
    leaseSteps?: ProtocolWorkerLeaseStep[];
    // Hold the first result until another host has had this many workspace
    // offers and been handed this many tasks, so a run cannot finish before
    // that host's setup failures land, or before it has run a task.
    holdFirstResultUntil?: HoldFirstResultUntil;
    // Join the DHT only once another host has run this many tasks.
    joinAfter?: { worker: string; labels: number };
    // The records of every host in the run, for holdFirstResultUntil and joinAfter.
    records?: () => ProtocolWorkerRecord[];
    // Fields merged into every attempt result, e.g. measurements.
    attemptResult?: Record<string, unknown>;
    // Statistics reported after the run completes, before the lease is clean.
    workerStats?: Record<string, unknown>;
    // Called when the orchestrator announces the run is complete.
    afterRunComplete?: () => void;
}) {
    const record: ProtocolWorkerRecord = {
        name: options.name,
        offeredProtocol: null,
        offeredManifest: null,
        runners: [],
        labels: [],
        costs: [],
        workspaceOffers: 0
    };
    let closed = false;
    let pool: any = null;
    const join = async () => {
        pool = await createPool({
            announceTopics: [options.keys.workerTopic],
            lookupTopics: [options.keys.orchestratorTopic],
            dht: options.dht,
            refreshIntervalMs: 25
        });
        // The run ended while this host was still joining.
        if (closed) return pool.close();
        pool.onConnection(serve);
    };
    const close = async () => {
        if (closed) return;
        closed = true;
        await pool?.close();
    };
    const serve = async (stream: unknown, info: { publicKey?: Buffer }) => {
        const peer = new ProtocolPeer(stream);
        peer.on("protocolError", () => {});
        try {
            await authenticateServer(
                peer,
                options.keys.authKey,
                { local: pool.publicKey, remote: info.publicKey },
                TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
            );
            await peer.send("SERVER_READY", {
                name: options.name,
                capabilities: {
                    distributedProtocol: options.distributedProtocol,
                    memoryGb: 1,
                    heartbeatTimeoutMs: 60_000
                }
            });
            await waitForMessage(peer, "LEASE_REQUEST");
            await peer.send("LEASE_GRANTED", { capabilities: {} });
            const offer = await waitForMessage(peer, "WORKSPACE_OFFER");
            record.offeredProtocol =
                offer.header.manifest.distributedProtocol ?? null;
            record.offeredManifest = offer.header.manifest;
            const step = options.leaseSteps?.[record.workspaceOffers];
            record.workspaceOffers += 1;
            if (step === "reject-allocation") {
                // The orchestrator retires the host on this message.
                await peer.send("RESOURCE_ALLOCATION_REJECTED", {
                    resource: "memory",
                    requested: 2,
                    permitted: 1,
                    message: "fixture host permits 1 GB"
                });
                return;
            }
            if (step === "close-after-offer") {
                peer.close("fixture host drops the lease");
                return;
            }
            if (step === "outside-manifest" || step === "invalid-diff") {
                // The orchestrator rejects this need and closes the stream.
                const need =
                    step === "outside-manifest"
                        ? { changed: ["not-offered.js"], deleted: [] }
                        : { changed: "not-a-list", deleted: [] };
                await peer.send(
                    "WORKSPACE_NEED",
                    {},
                    Buffer.from(JSON.stringify(need))
                );
                return;
            }
            await peer.send(
                "WORKSPACE_NEED",
                {},
                Buffer.from(JSON.stringify({ changed: [], deleted: [] }))
            );
            await waitForMessage(peer, "BUNDLE_END");
            await peer.send("PREPARED");
            await waitForMessage(peer, "RUN_CONFIG");
            let requestId = 0;
            for (;;) {
                const id = `${options.name}-${++requestId}`;
                await peer.send("TASK_REQUEST", { requestId: id });
                const reply = await waitForEither(peer, [
                    "TASK_ASSIGNMENT",
                    "NO_TASK_AVAILABLE"
                ]);
                if (reply.kind === "NO_TASK_AVAILABLE") break;
                const { assignment } = reply.header;
                record.runners.push(assignment.task.runner);
                record.labels.push(assignment.task.label);
                record.costs.push(assignment.task.cost);
                if (step === "leave-on-first-task") {
                    // Gone mid-attempt, and not coming back to redial.
                    peer.close("fixture host leaves mid-attempt");
                    await close();
                    return;
                }
                const hold = options.holdFirstResultUntil;
                if (hold && record.labels.length === 1) {
                    const deadline = Date.now() + 30_000;
                    const reached = () => {
                        const other = options
                            .records?.()
                            .find((entry) => entry.name === hold.worker);
                        return (
                            (other?.workspaceOffers ?? 0) >=
                                (hold.workspaceOffers ?? 0) &&
                            (other?.labels.length ?? 0) >= (hold.labels ?? 0)
                        );
                    };
                    while (!reached() && Date.now() < deadline) {
                        await new Promise((resolve) => setTimeout(resolve, 25));
                    }
                    // Let the orchestrator register the drop that follows the offer.
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
                await peer.send("ATTEMPT_RESULT", {
                    requestId: id,
                    assignment,
                    result: {
                        code: 0,
                        label: assignment.task.label,
                        durationMs: 1,
                        ...options.attemptResult
                    },
                    logTransferred: false
                });
                if (step === "one-task-then-close") {
                    peer.close("fixture host leaves after one task");
                    return;
                }
            }
            await waitForMessage(peer, "RUN_COMPLETE", 60_000);
            options.afterRunComplete?.();
            if (options.workerStats)
                await peer.send("WORKER_STATS", { stats: options.workerStats });
            await peer.send("LEASE_CLEAN");
        } catch {
            // The orchestrator closing the stream ends this worker's part.
        }
    };
    const joinAfter = options.joinAfter;
    if (!joinAfter) {
        await join();
    } else {
        void (async () => {
            const deadline = Date.now() + 30_000;
            const ran = () =>
                options
                    .records?.()
                    .find((entry) => entry.name === joinAfter.worker)?.labels
                    .length ?? 0;
            while (
                !closed &&
                ran() < joinAfter.labels &&
                Date.now() < deadline
            ) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (!closed) await join();
        })();
    }
    return { record, close };
}

const {
    DISTRIBUTED_PROTOCOL_VERSION
} = require("../../../scripts/e2e-parallel/distributed/protocol.js");

/** Two hardhat, one forge and two browser tasks, as a real run discovers them. */
export const MIXED_TIER_TASKS = [
    { label: "hardhat one", logName: "hardhat-one", args: [] },
    { label: "hardhat two", logName: "hardhat-two", args: [] },
    { label: "forge one", logName: "forge-one", runner: "forge", args: [] },
    {
        label: "browser gate one",
        logName: "browser-one",
        runner: "browser",
        args: []
    },
    {
        label: "browser gate two",
        logName: "browser-two",
        runner: "browser",
        args: []
    }
];

/**
 * Hardhat tasks from a file marked `// @distributed-requires: browser`, as
 * discovery emits them: Mocha tests that launch Chromium.
 */
export const CHROMIUM_MOCHA_TASKS = [1, 2, 3].map((index) => ({
    label: `chromium mocha ${index}`,
    logName: `chromium-mocha-${index}`,
    args: [],
    requires: ["browser"]
}));

/**
 * Run the real orchestrator over `tasks` (MIXED_TIER_TASKS by default) against worker hosts that
 * declare the given protocols, on a local DHT. Returns what each worker was
 * offered and ran, the run result or failure, the console warnings, and what
 * the run appended to a GitHub step summary.
 */
export async function runAgainstProtocolWorkers(
    workers: Array<{
        name: string;
        distributedProtocol: number;
        leaseSteps?: ProtocolWorkerLeaseStep[];
        holdFirstResultUntil?: HoldFirstResultUntil;
        joinAfter?: { worker: string; labels: number };
        attemptResult?: Record<string, unknown>;
        workerStats?: Record<string, unknown>;
        afterRunComplete?: () => void;
    }>,
    options: {
        discoveryTimeoutMs?: number;
        tasks?: Array<Record<string, unknown>>;
        // Extra runDistributed options, e.g. schedule or costCachePath.
        run?: Record<string, unknown>;
        // Files to place in the project root before the run, by relative path.
        files?: Record<string, string>;
    } = {}
) {
    const { createLocalDhtNetwork } = require("./testTransport");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const network = await createLocalDhtNetwork();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "distributed-mixed-"));
    const summaryPath = path.join(root, "step-summary.md");
    fs.writeFileSync(summaryPath, "");
    for (const [file, content] of Object.entries(options.files ?? {}))
        fs.writeFileSync(path.join(root, file), content);
    const poolSecret = `mixed-${process.pid}-${Date.now()}`;
    const keys = derivePoolKeys(poolSecret);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalSummary = process.env.GITHUB_STEP_SUMMARY;
    const started: Array<{
        record: ProtocolWorkerRecord;
        close: () => Promise<void>;
    }> = [];
    try {
        for (const worker of workers) {
            started.push(
                await startProtocolWorker({
                    ...worker,
                    keys,
                    dht: network.createNode(),
                    records: () => started.map((entry) => entry.record)
                })
            );
        }
        console.warn = (...data: unknown[]) => {
            warnings.push(data.map(String).join(" "));
        };
        process.env.GITHUB_STEP_SUMMARY = summaryPath;
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
            workspaceId: "a".repeat(64),
            sourceDigest: "b".repeat(64),
            rootProjectPath: "project",
            runnerEntry: "project/scripts/e2e-parallel/distributed/worker.js",
            repositories: [],
            files: [],
            fileCount: 0,
            expandedBytes: 0
        };
        // As buildRuntimeManifest attaches it: off the wire, so a spread drops it.
        Object.defineProperty(manifest, "localWorkspaceRoot", {
            value: root,
            enumerable: false
        });
        let result: any = null;
        let failure: Error | null = null;
        try {
            result = await runDistributed({
                tasks: (options.tasks ?? MIXED_TIER_TASKS).map((task) => ({
                    ...task
                })),
                projectRoot: root,
                archivePath: path.join(root, "source.tgz"),
                manifest,
                logDir: root,
                poolSecret,
                discoveryTimeoutMs: options.discoveryTimeoutMs ?? 10_000,
                discoveryRefreshMs: 25,
                baseEnv: {},
                dht: network.createNode(),
                ...options.run
            });
        } catch (error) {
            failure = error as Error;
        }
        const metricsPath = path.join(root, "run-metrics.json");
        return {
            root: root as string,
            result,
            failure,
            // What the run wrote to run-metrics.json, or null.
            metrics: fs.existsSync(metricsPath)
                ? JSON.parse(fs.readFileSync(metricsPath, "utf8"))
                : null,
            warnings,
            summary: fs.readFileSync(summaryPath, "utf8") as string,
            workers: started.map((worker) => worker.record)
        };
    } finally {
        console.warn = originalWarn;
        if (originalSummary === undefined)
            delete process.env.GITHUB_STEP_SUMMARY;
        else process.env.GITHUB_STEP_SUMMARY = originalSummary;
        for (const worker of started) await worker.close();
        fs.rmSync(root, { recursive: true, force: true });
        await network.close();
    }
}

export const sortedLabels = (values: string[]) => [...values].sort();

export const workerNamed = (workers: ProtocolWorkerRecord[], name: string) =>
    workers.find((worker) => worker.name === name)!;
