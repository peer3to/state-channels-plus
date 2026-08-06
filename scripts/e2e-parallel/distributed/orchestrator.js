const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { derivePoolKeys, authenticateClient } = require("./authentication");
const {
    DISTRIBUTED_PROTOCOL_VERSION,
    ProtocolPeer,
    waitForMessage
} = require("./protocol");
const { DISCOVERY_REFRESH_MS, createPool } = require("./poolTransport");
const { sendBundle } = require("./artifactTransfer");
const { TaskCoordinator } = require("../shared/taskCoordinator");
const { toWireTask } = require("./taskWire");
const { OrchestratorLogStore } = require("./orchestratorLogStore");
const logging = require("../shared/logging");

const RESET = "\x1b[0m";
const WORKER_COLORS = [
    "\x1b[38;5;117m",
    "\x1b[38;5;213m",
    "\x1b[38;5;120m",
    "\x1b[38;5;221m",
    "\x1b[38;5;141m",
    "\x1b[38;5;87m",
    "\x1b[38;5;208m"
];

function workerName(worker) {
    return `${worker.color}${worker.label}${RESET}`;
}

function workerResultName(worker, result) {
    const starveCount = result.parsed?.starveCount || 0;
    const oomCount = result.parsed?.oomCount || 0;
    const restore =
        result.code === 0
            ? "\x1b[32m"
            : result.assignment.task.repeatedStarvation ||
                (oomCount === 0 && starveCount > 0)
              ? "\x1b[33m"
              : "\x1b[31m";
    return `${worker.color}${worker.label}${restore}`;
}

function workerStatus(worker, status, target = process.stdout) {
    if (worker.lastStatus === status) return;
    worker.lastStatus = status;
    target.write(`${worker.color}[${worker.label}] ${status}${RESET}\n`);
}

function formatBusyStatus(status) {
    const progress = status.totalTasks
        ? `; progress ${status.completedTasks}/${status.totalTasks}`
        : "";
    const estimate = Number.isFinite(status.estimatedWaitMs)
        ? `; estimated wait ${Math.max(1, Math.ceil(status.estimatedWaitMs / 1000))}s`
        : "";
    return `Busy (${status.status || status.state}; queue position ${status.position}${progress}${estimate})`;
}

function isRoutineDiscoveryFailure(error) {
    return /^(Connection closed|Timed out) waiting for AUTH_(HELLO|CHALLENGE|PROOF|OK)$/.test(
        error?.message || ""
    );
}

function promoteAttemptLog(logDir, assignment, worker, code) {
    const attemptPath =
        worker?.attemptPaths.get(assignment.attemptId) ||
        logging.getAttemptLogPath(
            logDir,
            assignment.task.logName,
            assignment.attemptId
        );
    const canonical = logging.getLogPath(logDir, assignment.task.logName);
    if (fs.existsSync(attemptPath)) fs.renameSync(attemptPath, canonical);
    if (code !== 0) logging.markLogAsError(logDir, assignment.task.logName);
}

function createHeartbeatMonitor(peer, timeoutMs, onTimeout) {
    let lastReceivedAt = Date.now();
    const timer = setInterval(
        () => {
            if (Date.now() - lastReceivedAt > timeoutMs) onTimeout();
            else peer.send("HEARTBEAT").catch(onTimeout);
        },
        Math.max(10, timeoutMs / 3)
    );
    return {
        received() {
            lastReceivedAt = Date.now();
        },
        stop() {
            clearInterval(timer);
        }
    };
}

function validateWorkerStats(stats) {
    const fields = [
        "peakCpu",
        "avgCpu",
        "cpuSampleCount",
        "peakOccupiedGb",
        "avgPerTestGb",
        "memorySampleCount",
        "memBoundGb"
    ];
    if (
        !stats ||
        fields.some(
            (field) =>
                !Number.isFinite(stats[field]) || Number(stats[field]) < 0
        )
    ) {
        throw new Error("Worker returned invalid resource statistics");
    }
    return stats;
}

function aggregateWorkerStats(workers) {
    const stats = workers.map((worker) => worker.stats).filter(Boolean);
    const cpuSamples = stats.reduce(
        (sum, entry) => sum + entry.cpuSampleCount,
        0
    );
    const memorySamples = stats.reduce(
        (sum, entry) => sum + entry.memorySampleCount,
        0
    );
    return {
        peakCpu: Math.max(0, ...stats.map((entry) => entry.peakCpu)),
        avgCpu: cpuSamples
            ? stats.reduce(
                  (sum, entry) => sum + entry.avgCpu * entry.cpuSampleCount,
                  0
              ) / cpuSamples
            : 0,
        peakOccupiedGb: stats.reduce(
            (sum, entry) => sum + entry.peakOccupiedGb,
            0
        ),
        avgPerTestGb: memorySamples
            ? stats.reduce(
                  (sum, entry) =>
                      sum + entry.avgPerTestGb * entry.memorySampleCount,
                  0
              ) / memorySamples
            : 0,
        memBoundGb: workers.reduce(
            (sum, worker) =>
                sum + (worker.stats?.memBoundGb ?? worker.memoryGb ?? 0),
            0
        )
    };
}

async function runDistributed(options) {
    const keys = derivePoolKeys(options.poolSecret);
    console.log(
        `Discovering workers on topic ${keys.workerTopic.toString("hex").slice(0, 12)}`
    );
    const pool = await createPool({
        announceTopics: [keys.orchestratorTopic],
        lookupTopics: [keys.workerTopic],
        dht: options.dht,
        keyPair: options.keyPair,
        refreshIntervalMs: options.discoveryRefreshMs || DISCOVERY_REFRESH_MS
    });
    console.log(
        `Orchestrator identity ${pool.publicKey.toString("hex").slice(0, 12)}${options.keyPair ? " (persistent)" : ""}`
    );
    const sessionId = crypto.randomUUID();
    const workers = new Map();
    const connectingWorkers = new Set();
    const workerLabelById = new Map();
    // Completed-task counts and a lease registry keyed by worker id. Both
    // survive a worker drop so the final summary describes every worker that
    // served the run, not only those still connected at the end.
    const completedByWorker = new Map();
    const leasedWorkers = new Map();
    const ignoredWorkers = new Set();
    const logStore = new OrchestratorLogStore(options.logDir);
    const committedOutput = new Map();
    let discoveryStartedAt = Date.now();
    const discoveryProgress = setInterval(() => {
        if (workers.size) return;
        const seconds = Math.round((Date.now() - discoveryStartedAt) / 1000);
        console.log(
            `Still discovering workers on topic ${keys.workerTopic.toString("hex").slice(0, 12)} (${seconds}s)`
        );
    }, DISCOVERY_REFRESH_MS);
    let resolveFirst;
    const firstWorker = new Promise((resolve) => (resolveFirst = resolve));
    let completedResolve;
    let completedReject;
    let rediscoveryTimeout;
    const completed = new Promise((resolve, reject) => {
        completedResolve = resolve;
        completedReject = reject;
    });

    function clearRediscoveryTimeout() {
        if (rediscoveryTimeout) clearTimeout(rediscoveryTimeout);
        rediscoveryTimeout = null;
    }

    function armRediscoveryTimeout() {
        clearRediscoveryTimeout();
        rediscoveryTimeout = setTimeout(
            () =>
                completedReject(
                    new Error(
                        `Lost all distributed workers; none reconnected within ${options.discoveryTimeoutMs}ms`
                    )
                ),
            options.discoveryTimeoutMs
        );
    }
    for (const publicKey of options.peerPublicKeys || []) {
        pool.swarm.joinPeer(publicKey);
    }

    const coordinator = new TaskCoordinator(options.tasks, {
        speculative: true,
        onWorkAvailable(workerId) {
            const worker = workers.get(workerId);
            worker?.peer
                .send("WORK_AVAILABLE")
                .catch((error) => dropWorker(worker, error));
        },
        onResult(result) {
            const { assignment, attempt, code, parsed } = result;
            const worker = workers.get(assignment.workerId);
            if (result.disposition === "complete") {
                completedByWorker.set(
                    assignment.workerId,
                    (completedByWorker.get(assignment.workerId) || 0) + 1
                );
                promoteAttemptLog(options.logDir, assignment, worker, code);
                logging.result({
                    completed: coordinator.completed,
                    total: options.tasks.length,
                    code,
                    label: attempt.label,
                    durationMs: attempt.durationMs,
                    oomCount: parsed?.oomCount || 0,
                    starveCount: parsed?.starveCount || 0,
                    timing: parsed?.timing || logging.parseTimings(""),
                    repeatedStarvation: assignment.task.repeatedStarvation,
                    worker: worker
                        ? workerResultName(worker, result)
                        : workerLabelById.get(assignment.workerId) ||
                          assignment.workerId
                });
            }
            if (coordinator.finish().done) {
                queueMicrotask(() => finishRun().catch(completedReject));
            }
        }
    });

    let finishing = false;

    async function cancelRun() {
        if (finishing) return;
        finishing = true;
        const leased = [...workers.values()].filter((worker) => worker.leased);
        if (!leased.length) {
            completedResolve();
            return;
        }
        await Promise.all(
            leased.map((worker) => worker.peer.send("CANCEL").catch(() => {}))
        );
        settleCleanup();
    }

    const cancel = () => cancelRun().catch(completedReject);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();

    pool.onConnection(async (stream, info) => {
        const peer = new ProtocolPeer(stream);
        const workerId =
            info?.publicKey?.toString("hex") || crypto.randomUUID();
        // Hyperswarm deduplicates simultaneous dual-topic dials by Noise key.
        // Keep this guard so a duplicate event cannot create a second lease.
        if (workers.has(workerId) || connectingWorkers.has(workerId))
            return peer.close();
        connectingWorkers.add(workerId);
        try {
            await authenticateClient(
                peer,
                keys.authKey,
                { local: pool.publicKey },
                10000
            );
            const ready = await waitForMessage(peer, "SERVER_READY", 10000);
            if (
                ready.header.capabilities.distributedProtocol !==
                DISTRIBUTED_PROTOCOL_VERSION
            ) {
                if (!ignoredWorkers.has(workerId)) {
                    ignoredWorkers.add(workerId);
                    console.warn(
                        `Ignoring worker ${ready.header.name}: restart it with the current code`
                    );
                }
                const heartbeat = setInterval(
                    () => peer.send("HEARTBEAT").catch(() => {}),
                    5000
                );
                peer.on("message", () => {});
                peer.once("close", () => clearInterval(heartbeat));
                return;
            }
            const worker = {
                id: workerId,
                peer,
                label: ready.header.name,
                color: WORKER_COLORS[workers.size % WORKER_COLORS.length],
                lastStatus: null,
                attemptPaths: new Map(),
                clean: false,
                leased: false,
                failure: null,
                memoryGb: ready.header.capabilities.memoryGb,
                capabilities: ready.header.capabilities,
                heartbeatTimeoutMs:
                    ready.header.capabilities.heartbeatTimeoutMs || 15000,
                heartbeat: null
            };
            worker.heartbeat = createHeartbeatMonitor(
                peer,
                worker.heartbeatTimeoutMs,
                () => {
                    worker.failure = new Error(
                        `Worker ${worker.label} heartbeat timed out`
                    );
                    peer.close();
                }
            );
            workers.set(workerId, worker);
            clearRediscoveryTimeout();
            workerLabelById.set(workerId, worker.label);
            console.log(
                `Connected to worker ${workerName(worker)}; requesting lease`
            );
            coordinator.registerWorker(workerId);
            peer.on("message", (message) => {
                worker.heartbeat.received();
                handleMessage(worker, message).catch((error) =>
                    dropWorker(worker, error)
                );
            });
            peer.once("close", () => {
                worker.heartbeat.stop();
                for (const attemptId of worker.attemptPaths.keys()) {
                    logStore.abort(`${workerId}:${attemptId}`);
                }
                coordinator.disconnectWorker(workerId);
                workers.delete(workerId);
                if (!workers.size && coordinator.finish().pending) {
                    discoveryStartedAt = Date.now();
                    armRediscoveryTimeout();
                    console.log(
                        "No workers connected; waiting for a worker to become available"
                    );
                }
                settleCleanup();
            });
            await peer.send("LEASE_REQUEST", { sessionId });
            resolveFirst();
        } catch (error) {
            if (!isRoutineDiscoveryFailure(error)) {
                console.warn(
                    `Rejected worker connection: ${error.message || error}`
                );
            }
            peer.close();
        } finally {
            connectingWorkers.delete(workerId);
        }
    });

    async function handleMessage(worker, message) {
        if (message.kind === "LEASE_GRANTED") {
            worker.leased = true;
            leasedWorkers.set(worker.id, worker);
            if (finishing) {
                await worker.peer.send("RELEASE");
                return;
            }
            console.log(
                `Lease granted by ${workerName(worker)}; checking cached workspace`
            );
            await sendBundle(
                worker.peer,
                options.archivePath,
                options.manifest,
                undefined,
                (need) => {
                    const archiveMb = (need.archiveBytes / 1024 / 1024).toFixed(
                        2
                    );
                    console.log(
                        need.changed.length || need.deleted.length
                            ? `Syncing ${need.changed.length} changed and ${need.deleted.length} deleted file(s) to ${workerName(worker)} (${archiveMb} MB)`
                            : `Workspace on ${workerName(worker)} is current; reusing cached files and dependencies`
                    );
                }
            );
            console.log(
                `${workerName(worker)} prepared the workspace; starting test worker`
            );
            await worker.peer.send("RUN_CONFIG", {
                baseEnv: options.baseEnv,
                taskCount: options.tasks.length
            });
        } else if (message.kind === "BUSY") {
            workerStatus(worker, formatBusyStatus(message.header));
        } else if (message.kind === "WORKER_READY") {
            workerStatus(worker, "Ready");
        } else if (message.kind === "TASK_REQUEST") {
            const assignment = coordinator.requestTask(worker.id);
            if (!assignment) {
                await worker.peer.send("NO_TASK_AVAILABLE", {
                    requestId: message.header.requestId
                });
                return;
            }
            const wireAssignment = {
                ...assignment,
                task: toWireTask(assignment.task, options.projectRoot)
            };
            const attemptPath = logging.getAttemptLogPath(
                options.logDir,
                assignment.task.logName,
                assignment.attemptId
            );
            worker.attemptPaths.set(assignment.attemptId, attemptPath);
            logStore.begin(`${worker.id}:${assignment.attemptId}`, attemptPath);
            await worker.peer.send("TASK_ASSIGNMENT", {
                requestId: message.header.requestId,
                assignment: wireAssignment
            });
        } else if (message.kind === "LOG_CHUNK") {
            logStore.append(
                `${worker.id}:${message.header.attemptId}`,
                message.header.sequence,
                message.body,
                message.header.stream
            );
        } else if (message.kind === "LOG_END") {
            const output = logStore.commit(
                `${worker.id}:${message.header.attemptId}`,
                message.header
            );
            committedOutput.set(message.header.attemptId, output);
            await worker.peer.send("LOG_COMMITTED", {
                requestId: message.header.requestId,
                attemptId: message.header.attemptId
            });
        } else if (message.kind === "ATTEMPT_RESULT") {
            const output = committedOutput.get(
                message.header.assignment.attemptId
            );
            if (!output)
                throw new Error(
                    "Attempt result arrived before its log was committed"
                );
            committedOutput.delete(message.header.assignment.attemptId);
            coordinator.completeAttempt(worker.id, {
                ...message.header.result,
                stdout: output.stdout,
                stderr: output.stderr,
                attemptId: message.header.assignment.attemptId
            });
            await Promise.all(
                [...workers.values()]
                    .filter((entry) => entry.leased)
                    .map((entry) =>
                        entry.peer
                            .send("RUN_PROGRESS", {
                                completedTasks: coordinator.completed,
                                totalTasks: options.tasks.length
                            })
                            .catch((error) => dropWorker(entry, error))
                    )
            );
        } else if (message.kind === "INFRA_LOG") {
            const filePath = logStore.infrastructurePath(
                worker.id,
                worker.label
            );
            fs.appendFileSync(filePath, message.body);
        } else if (message.kind === "WORKER_STATUS") {
            workerStatus(worker, message.header.status);
        } else if (message.kind === "WORKER_STATS") {
            worker.stats = validateWorkerStats(message.header.stats);
        } else if (message.kind === "PREPARATION_ERROR") {
            const error = new Error(
                `Worker ${workerName(worker)} could not prepare the workspace: ${message.header.message}`
            );
            worker.failure = error;
            fs.appendFileSync(
                logStore.infrastructurePath(worker.id, worker.label),
                `${error.message}\n`
            );
            workerStatus(
                worker,
                `Preparation failed: ${message.header.message}`,
                process.stderr
            );
            completedReject(error);
            worker.peer.close();
        } else if (message.kind === "WORKER_ERROR") {
            const error = new Error(
                `Worker ${workerName(worker)} failed: ${message.header.message}`
            );
            worker.failure = error;
            fs.appendFileSync(
                logStore.infrastructurePath(worker.id, worker.label),
                `Worker ${worker.label} failed: ${message.header.message}\n`
            );
            workerStatus(
                worker,
                `Failed: ${message.header.message}`,
                process.stderr
            );
            worker.peer.close();
        } else if (message.kind === "LEASE_CLEAN") {
            worker.clean = true;
            workerStatus(worker, "Lease cleaned; ready for another run");
            settleCleanup();
        }
    }

    function dropWorker(worker, error) {
        worker.failure ||= error;
        worker.peer.close();
    }

    function settleCleanup() {
        if (
            finishing &&
            [...workers.values()]
                .filter((entry) => entry.leased)
                .every((entry) => entry.clean)
        ) {
            completedResolve();
        }
    }

    async function finishRun() {
        if (finishing) return;
        finishing = true;
        const used = [...workers.values()].filter((worker) => worker.leased);
        if (!used.length)
            return completedReject(new Error("Run completed without a worker"));
        await Promise.all(
            used.map((worker) =>
                worker.peer
                    .send("RUN_COMPLETE")
                    .catch((error) => dropWorker(worker, error))
            )
        );
        settleCleanup();
    }

    let rejectDiscoveryTimeout;
    const timeout = new Promise((_, reject) => {
        rejectDiscoveryTimeout = reject;
    });
    const discoveryTimeout = setTimeout(
        () =>
            rejectDiscoveryTimeout(
                new Error("No distributed workers discovered")
            ),
        options.discoveryTimeoutMs
    );
    let workerLabels = [];
    let usedWorkers = [];
    try {
        await Promise.race([firstWorker, timeout, completed]);
        clearTimeout(discoveryTimeout);
        clearRediscoveryTimeout();
        await completed;
        usedWorkers = [...leasedWorkers.values()];
        workerLabels = usedWorkers.map(
            (worker) =>
                `${workerName(worker)} (${worker.capabilities.slots} slots, ${worker.capabilities.workers} workers, ${worker.capabilities.memoryGb}GB) · ${completedByWorker.get(worker.id) || 0} tests`
        );
    } finally {
        clearTimeout(discoveryTimeout);
        clearInterval(discoveryProgress);
        options.signal?.removeEventListener("abort", cancel);
        for (const worker of workers.values()) worker.heartbeat.stop();
        await pool.close();
    }
    const state = coordinator.finish();
    const resourceStats = aggregateWorkerStats(usedWorkers);
    return {
        failed: state.failed,
        completed: state.completed,
        sumDurationMs: state.sumDurationMs,
        ...resourceStats,
        workers: workerLabels
    };
}

module.exports = {
    aggregateWorkerStats,
    createHeartbeatMonitor,
    formatBusyStatus,
    isRoutineDiscoveryFailure,
    promoteAttemptLog,
    runDistributed,
    validateWorkerStats
};
