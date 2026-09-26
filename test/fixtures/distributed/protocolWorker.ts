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
    runners: string[];
    labels: string[];
};

/**
 * A worker host on the local DHT that declares `distributedProtocol` and
 * speaks the lease, workspace and task protocol just far enough for the real
 * orchestrator to schedule on it: every assigned task passes at once. It
 * records the protocol its workspace offer declared and every task it ran.
 */
export async function startProtocolWorker(options: {
    name: string;
    distributedProtocol: number;
    keys: PoolKeys;
    dht: unknown;
}) {
    const record: ProtocolWorkerRecord = {
        name: options.name,
        offeredProtocol: null,
        runners: [],
        labels: []
    };
    const pool = await createPool({
        announceTopics: [options.keys.workerTopic],
        lookupTopics: [options.keys.orchestratorTopic],
        dht: options.dht,
        refreshIntervalMs: 25
    });
    pool.onConnection(async (stream: unknown, info: { publicKey?: Buffer }) => {
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
                await peer.send("ATTEMPT_RESULT", {
                    requestId: id,
                    assignment,
                    result: {
                        code: 0,
                        label: assignment.task.label,
                        durationMs: 1
                    },
                    logTransferred: false
                });
            }
            await waitForMessage(peer, "RUN_COMPLETE", 60_000);
            await peer.send("LEASE_CLEAN");
        } catch {
            // The orchestrator closing the stream ends this worker's part.
        }
    });
    return { record, close: () => pool.close() };
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
 * Run the real orchestrator over MIXED_TIER_TASKS against worker hosts that
 * declare the given protocols, on a local DHT. Returns what each worker was
 * offered and ran, the run result or failure, the console warnings, and what
 * the run appended to a GitHub step summary.
 */
export async function runAgainstProtocolWorkers(
    workers: Array<{ name: string; distributedProtocol: number }>,
    options: { discoveryTimeoutMs?: number } = {}
) {
    const { createLocalDhtNetwork } = require("./testTransport");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const network = await createLocalDhtNetwork();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "distributed-mixed-"));
    const summaryPath = path.join(root, "step-summary.md");
    fs.writeFileSync(summaryPath, "");
    const poolSecret = `mixed-${process.pid}-${Date.now()}`;
    const keys = derivePoolKeys(poolSecret);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalSummary = process.env.GITHUB_STEP_SUMMARY;
    const started = [];
    try {
        for (const worker of workers) {
            started.push(
                await startProtocolWorker({
                    ...worker,
                    keys,
                    dht: network.createNode()
                })
            );
        }
        console.warn = (...data: unknown[]) => {
            warnings.push(data.map(String).join(" "));
        };
        process.env.GITHUB_STEP_SUMMARY = summaryPath;
        let result: any = null;
        let failure: Error | null = null;
        try {
            result = await runDistributed({
                tasks: MIXED_TIER_TASKS.map((task) => ({ ...task })),
                projectRoot: root,
                archivePath: path.join(root, "source.tgz"),
                manifest: {
                    version: 3,
                    packageManager: "pnpm",
                    distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
                    workspaceId: "a".repeat(64),
                    sourceDigest: "b".repeat(64),
                    rootProjectPath: "project",
                    runnerEntry:
                        "project/scripts/e2e-parallel/distributed/worker.js",
                    repositories: [],
                    files: [],
                    fileCount: 0,
                    expandedBytes: 0,
                    localWorkspaceRoot: root
                },
                logDir: root,
                poolSecret,
                discoveryTimeoutMs: options.discoveryTimeoutMs ?? 10_000,
                discoveryRefreshMs: 25,
                baseEnv: {},
                dht: network.createNode()
            });
        } catch (error) {
            failure = error as Error;
        }
        return {
            result,
            failure,
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
