const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    DISCOVERY_AUTH_TIMEOUT_MS,
    derivePoolKeys,
    authenticateClient,
    isDiscoveryAuthenticationFailure
} = require("./authentication");
const {
    DISTRIBUTED_PROTOCOL_VERSION,
    MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL,
    ProtocolPeer,
    minimumProtocolForTask,
    runnersForDistributedProtocol,
    workerCanRunTask,
    waitForMessage
} = require("./protocol");
const { DISCOVERY_REFRESH_MS, createPool } = require("./poolTransport");
const {
    closeStream,
    connectionHash,
    selectLowerHash,
    shortConnectionHash
} = require("./connectionLifecycle");
const { sendBundle } = require("./artifactTransfer");
const { manifestForDistributedProtocol } = require("./runtimeBundle");
const { normalizeTaskRunner } = require("../shared/taskRunners");
const { TaskCoordinator } = require("../shared/taskCoordinator");
const { toWireTask } = require("./taskWire");
const { OrchestratorLogStore } = require("./orchestratorLogStore");
const logging = require("../shared/logging");

const RESET = "\x1b[0m";
const ERROR_RED = "\x1b[31m";
const WORKER_COLORS = [
    "\x1b[38;5;117m",
    "\x1b[38;5;213m",
    "\x1b[38;5;120m",
    "\x1b[38;5;141m",
    "\x1b[38;5;87m",
    "\x1b[38;5;75m",
    "\x1b[38;5;111m",
    "\x1b[38;5;177m",
    "\x1b[38;5;159m",
    "\x1b[38;5;183m",
    "\x1b[38;5;123m",
    "\x1b[38;5;219m"
];

function createWorkerColorRegistry(colors = WORKER_COLORS) {
    const byId = new Map();
    const byName = new Map();
    let next = 0;
    return {
        colorFor(id, name) {
            const color =
                byId.get(id) ||
                byName.get(name) ||
                colors[next++ % colors.length];
            byId.set(id, color);
            byName.set(name, color);
            return color;
        }
    };
}

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

function workerFaultStatus(worker, status, target = process.stderr) {
    target.write(`${ERROR_RED}[${worker.label}] ${status}${RESET}\n`);
}

function ingestAttemptLogMessage(logStore, key, message) {
    if (message.kind === "LOG_CHUNK") {
        logStore.append(
            key,
            message.header.sequence,
            message.body,
            message.header.stream
        );
        return null;
    }
    if (message.kind === "LOG_END") {
        return logStore.commit(key, message.header);
    }
    throw new Error(`Unsupported attempt log message: ${message.kind}`);
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
    return isDiscoveryAuthenticationFailure(error);
}

/** The runners the worker host can execute; throws for an unleasable host. */
function assertCompatibleWorkerProtocol(capabilities) {
    const runners = runnersForDistributedProtocol(
        capabilities?.distributedProtocol
    );
    if (runners) return runners;
    throw new Error(
        `Distributed worker protocol mismatch: orchestrator accepts ${MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL}-${DISTRIBUTED_PROTOCOL_VERSION}, worker host provides ${capabilities?.distributedProtocol ?? "none"}. Update and restart the worker host or rebase this branch.`
    );
}

/**
 * The warning for tasks no connected worker could run. They are left out of
 * the run rather than failing it; the lines name each task and the protocol a
 * worker host needs to run it.
 */
function formatSkippedTasksNotice(tasks) {
    const groups = new Map();
    for (const task of tasks) {
        const runner = normalizeTaskRunner(task.runner);
        const needs = task.requires ?? [];
        const key = [runner, ...needs].join("+");
        if (!groups.has(key)) groups.set(key, { runner, needs, tasks: [] });
        groups.get(key).tasks.push(task);
    }
    const lines = [];
    for (const { runner, needs, tasks: skipped } of groups.values()) {
        const required = minimumProtocolForTask(skipped[0]);
        const missing = needs.length ? needs.join(", ") : runner;
        lines.push(
            `Skipping ${skipped.length} ${runner} task(s)` +
                (needs.length ? ` that need ${missing}` : "") +
                `: no connected worker supports the ${missing} runner` +
                (required
                    ? `; a worker host on distributed protocol ${required} or newer runs them.`
                    : ".")
        );
        for (const task of skipped) lines.push(`  - ${task.label}`);
    }
    return lines;
}

/** Print the skip notice, and add it to the GitHub job summary when there is one. */
function reportSkippedTasks(tasks, env = process.env) {
    const lines = formatSkippedTasksNotice(tasks);
    for (const line of lines) console.warn(`WARNING: ${line}`);
    if (env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(
            env.GITHUB_STEP_SUMMARY,
            `> [!WARNING]\n${lines.map((line) => `> ${line}`).join("\n")}\n\n`
        );
    }
    return lines;
}

/** Report the tasks that failed because their only capable worker was lost. */
function reportLostTasks(tasks, logDir) {
    for (const task of tasks) {
        const reason = task.infrastructureDiagnostics.at(-1);
        console.error(`FAIL ${task.label}: ${reason}`);
        fs.appendFileSync(
            logging.getErrorLogPath(logDir, task.logName),
            `##PARALLEL_RUNNER## ${reason}\n`
        );
    }
}

function promoteAttemptLog(logDir, assignment, worker, code, attempt = {}) {
    const attemptPath =
        worker?.attemptPaths.get(assignment.attemptId) ||
        logging.getAttemptLogPath(
            logDir,
            assignment.task.logName,
            assignment.attemptId
        );
    const canonical = logging.getLogPath(logDir, assignment.task.logName);
    if (fs.existsSync(attemptPath)) {
        if (code !== 0)
            logging.appendRunnerFailureMarker(
                attemptPath,
                attempt.failureReason
            );
        fs.renameSync(attemptPath, canonical);
    }
    if (code !== 0) logging.markLogAsError(logDir, assignment.task.logName);
}

function promoteStarvationAttemptLog(logDir, assignment, worker) {
    const attemptPath =
        worker?.attemptPaths.get(assignment.attemptId) ||
        logging.getAttemptLogPath(
            logDir,
            assignment.task.logName,
            assignment.attemptId
        );
    const starvationPath = logging.getStarvationLogPath(
        logDir,
        assignment.task.logName
    );
    if (fs.existsSync(attemptPath)) fs.renameSync(attemptPath, starvationPath);
}

function coordinatorResultActions(disposition) {
    const completesTask = disposition === "complete";
    return {
        countCompletion: completesTask,
        report: completesTask || disposition === "late-failure"
    };
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
    const concurrencyFields = [
        "meanConcurrency",
        "peakConcurrency",
        "concurrencyWallMs"
    ];
    if (
        concurrencyFields.some(
            (field) =>
                Object.hasOwn(stats, field) &&
                (!Number.isFinite(stats[field]) || stats[field] < 0)
        ) ||
        (Object.hasOwn(stats, "peakConcurrency") &&
            !Number.isInteger(stats.peakConcurrency)) ||
        (Object.hasOwn(stats, "holdCounts") &&
            (!stats.holdCounts ||
                ["cap", "memory", "cpu"].some(
                    (field) =>
                        !Number.isInteger(stats.holdCounts[field]) ||
                        stats.holdCounts[field] < 0
                )))
    ) {
        throw new Error("Worker returned invalid admission statistics");
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
    const pressureSamples = stats.reduce(
        (sum, entry) => sum + (entry.cpuPressureSampleCount || 0),
        0
    );
    const withPressure = stats.filter((entry) =>
        Number.isFinite(entry.avgCpuPressure)
    );
    const withThrottle = stats.filter((entry) =>
        Number.isFinite(entry.throttledMs)
    );
    return {
        ...(withPressure.length
            ? {
                  peakCpuPressure: Math.max(
                      0,
                      ...withPressure.map((entry) => entry.peakCpuPressure)
                  ),
                  avgCpuPressure: pressureSamples
                      ? withPressure.reduce(
                            (sum, entry) =>
                                sum +
                                entry.avgCpuPressure *
                                    (entry.cpuPressureSampleCount || 0),
                            0
                        ) / pressureSamples
                      : 0
              }
            : {}),
        ...(withThrottle.length
            ? {
                  cpuDetail: {
                      throttledMs: withThrottle.reduce(
                          (sum, entry) => sum + entry.throttledMs,
                          0
                      ),
                      nrThrottled: withThrottle.reduce(
                          (sum, entry) => sum + (entry.nrThrottled || 0),
                          0
                      ),
                      peakHostSteal: Math.max(
                          0,
                          ...stats.map((entry) => entry.peakHostSteal || 0)
                      )
                  }
              }
            : {}),
        peakCpu: Math.max(0, ...stats.map((entry) => entry.peakCpu)),
        avgCpu: cpuSamples
            ? stats.reduce(
                  (sum, entry) => sum + entry.avgCpu * entry.cpuSampleCount,
                  0
              ) / cpuSamples
            : 0,
        sumPeakOccupiedGb: stats.reduce(
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

function recordWorkerFailure(workerStates, workerId, details = {}, limit = 2) {
    const state = workerStates.get(workerId) || {
        label: details.label || workerId,
        failureKind: null,
        failures: 0,
        firstReason: null,
        latestReason: null,
        lastDisposition: null,
        quarantined: false,
        quarantineReported: false
    };
    state.label = details.label || state.label;
    state.failureKind = details.kind || "worker-failure";
    state.failures += 1;
    state.firstReason ||= details.reason || state.failureKind;
    state.latestReason = details.reason || state.failureKind;
    state.lastDisposition = state.failureKind;
    state.quarantined ||= state.failures >= limit;
    workerStates.set(workerId, state);
    return state;
}

// A host that fails workspace setup the same way this often will not succeed on
// a redial; it is retired for the run instead of re-leased indefinitely.
const MAX_IDENTICAL_SETUP_FAILURES = 3;

/** Counts and byte sizes vary between attempts of the same failure. */
function normalizeFailureReason(reason) {
    return String(reason || "unknown failure")
        .replace(/\b[0-9a-f]{8,}\b/gi, "#")
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Record a failure before the worker was admitted a task. Consecutive failures
 * with the same normalized reason count towards the cap; a different reason
 * starts a new count. At the cap the host is quarantined for the run, which the
 * reconnect check already enforces.
 */
function recordSetupFailure(
    workerStates,
    workerId,
    details = {},
    limit = MAX_IDENTICAL_SETUP_FAILURES
) {
    const state = recordWorkerRetirement(workerStates, workerId, {
        label: details.label,
        kind: "setup failure",
        reason: details.reason
    });
    const reason = normalizeFailureReason(details.reason);
    state.setupFailures =
        state.setupFailureReason === reason
            ? (state.setupFailures || 0) + 1
            : 1;
    state.setupFailureReason = reason;
    state.setupFailureMessage = details.reason || reason;
    if (state.setupFailures >= limit) {
        state.quarantined = true;
        state.setupCapped = true;
    }
    // Quarantined before running a task, by this cap or by another limit.
    state.setupQuarantined ||= state.quarantined;
    return state;
}

/** A worker admitted a task: its setup evidently works now. */
function resetSetupFailures(workerStates, workerId) {
    const state = workerStates.get(workerId);
    if (!state) return;
    state.setupFailures = 0;
    state.setupFailureReason = null;
    state.setupFailureMessage = null;
}

/**
 * When every host this run discovered was quarantined before running a task,
 * by the setup cap or another failure limit, retrying cannot help: the message
 * to fail the run with, or null.
 */
function allWorkersSetupCapped(
    workerStates,
    limit = MAX_IDENTICAL_SETUP_FAILURES
) {
    const states = [...workerStates.values()];
    if (!states.length || !states.every((state) => state.setupQuarantined))
        return null;
    if (!states.every((state) => state.setupCapped)) {
        return `All distributed workers were quarantined before running a task: ${states
            .map((state) => `${state.label}: ${state.latestReason}`)
            .join("; ")}`;
    }
    const reasons = new Set(states.map((state) => state.setupFailureReason));
    return reasons.size === 1
        ? `All distributed workers failed the same way ${limit} times: ${states[0].setupFailureMessage}`
        : `All distributed workers were retired after ${limit} identical setup failures: ${states
              .map((state) => `${state.label}: ${state.setupFailureMessage}`)
              .join("; ")}`;
}

function recordWorkerRetirement(workerStates, workerId, details = {}) {
    const state = workerStates.get(workerId) || {
        label: details.label || workerId,
        failureKind: null,
        failures: 0,
        firstReason: null,
        latestReason: null,
        lastDisposition: null,
        quarantined: false,
        quarantineReported: false
    };
    state.label = details.label || state.label;
    state.failureKind = details.kind || state.failureKind || "disconnected";
    state.firstReason ||= details.reason || state.failureKind;
    state.latestReason =
        details.reason || state.latestReason || state.failureKind;
    state.lastDisposition = details.disposition || state.failureKind;
    workerStates.set(workerId, state);
    return state;
}

function formatWorkerDispositions(workerStates) {
    if (!workerStates.size) return "no worker disposition was recorded";
    return [...workerStates.values()]
        .sort((left, right) => left.label.localeCompare(right.label))
        .map(
            (state) =>
                `${state.label}: ${state.lastDisposition || "unknown"} — ${state.latestReason || "no reason reported"}${state.quarantined ? " (quarantined)" : ""}`
        )
        .join("; ");
}

function formatWorkerSummary(worker, completed) {
    const profile = worker.executionProfile || {};
    const slots = profile.slots ?? worker.capabilities.slots;
    const workers = profile.workers ?? worker.capabilities.workers;
    const memoryGb =
        profile.memoryBytes === undefined
            ? worker.capabilities.memoryGb
            : profile.memoryBytes / 1024 ** 3;
    const capacity =
        `${slots} slots, ${workers} workers ` +
        `(max ${worker.capabilities.workers}), ${memoryGb}GB`;
    if (!worker.stats) {
        return `${workerName(worker)} (${capacity}) · ${completed} tests · resource stats unavailable`;
    }
    const stats = worker.stats;
    return (
        `${workerName(worker)} (${capacity}) · ${completed} tests · ` +
        `cpu avg ${(stats.avgCpu * 100).toFixed(0)}% / peak ${(stats.peakCpu * 100).toFixed(0)}%${logging.formatCpuPressure(stats.avgCpuPressure, stats.peakCpuPressure)}${logging.formatCpuDetail(stats)} · ` +
        `mem peak ${stats.peakOccupiedGb.toFixed(1)}GB / bound ${stats.memBoundGb.toFixed(1)}GB, avg/process ${stats.avgPerTestGb.toFixed(2)}GB`
    );
}

async function runDistributed(options) {
    options = { schedule: "fifo", ...options };
    const startedAt = Date.now();
    const { CostCache } = require("../shared/costCache");
    const costCache = new CostCache({
        projectRoot: options.projectRoot,
        cachePath: options.costCachePath,
        overridesPath: options.costOverridesPath
    });
    const keys = derivePoolKeys(options.poolSecret);
    console.log(
        `Discovering workers on topic ${keys.workerTopic.toString("hex").slice(0, 12)}`
    );
    const pool = await createPool({
        announceTopics: [keys.orchestratorTopic],
        lookupTopics: [keys.workerTopic],
        dht: options.dht,
        keyPair: options.keyPair,
        refreshIntervalMs: options.discoveryRefreshMs || DISCOVERY_REFRESH_MS,
        onDialActivity: (line) => console.log(`[dial] ${line}`)
    });
    console.log(
        `Orchestrator identity ${pool.publicKey.toString("hex").slice(0, 12)}${options.keyPair ? " (persistent)" : ""}`
    );
    const sessionId = crypto.randomUUID();
    const workers = new Map();
    const workerLabelById = new Map();
    const workerColors = createWorkerColorRegistry();
    // Completed-task counts and a lease registry keyed by worker id. Both
    // survive a worker drop so the final summary describes every worker that
    // served the run, not only those still connected at the end.
    const completedByWorker = new Map();
    const leasedWorkers = new Map();
    // Stable transport identity -> compatibility/failure disposition for
    // this run, so reconnecting the same host cannot reset its failure budget.
    const warnedIncompatibleWorkers = new Set();
    const workerStates = new Map();
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
                        `Lost all distributed workers; none reconnected within ${options.discoveryTimeoutMs}ms. Last dispositions: ${formatWorkerDispositions(workerStates)}`
                    )
                ),
            options.discoveryTimeoutMs
        );
    }
    for (const publicKey of options.peerPublicKeys || []) {
        pool.swarm.joinPeer(publicKey);
    }

    const coordinator = new TaskCoordinator(options.tasks, {
        schedule: options.schedule,
        costCache,
        workerLabel: (id) => workerLabelById.get(id) || id,
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
            const actions = coordinatorResultActions(result.disposition);
            if (actions.countCompletion) {
                completedByWorker.set(
                    assignment.workerId,
                    (completedByWorker.get(assignment.workerId) || 0) + 1
                );
            }
            if (actions.report) {
                promoteAttemptLog(
                    options.logDir,
                    assignment,
                    worker,
                    code,
                    attempt
                );
                logging.result({
                    completed: coordinator.completed,
                    total: options.tasks.length,
                    code,
                    failureReason: attempt.failureReason,
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
            settleRun();
        }
    });

    let finishing = false;
    let unservableTimer = null;

    // Drops what no connected worker can run once nothing else is left and no
    // capable worker connected within the discovery window, then finishes the
    // run if that was the last work.
    function settleRun() {
        if (finishing) return;
        clearTimeout(unservableTimer);
        unservableTimer = null;
        const { skipped, failed, waitMs } = coordinator.settleUnservable(
            Date.now(),
            options.discoveryTimeoutMs
        );
        if (skipped.length) reportSkippedTasks(skipped);
        if (failed.length) reportLostTasks(failed, options.logDir);
        if (waitMs !== null) unservableTimer = setTimeout(settleRun, waitMs);
        if (coordinator.finish().done) {
            queueMicrotask(() => finishRun().catch(completedReject));
        }
    }

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
        if (finishing) {
            closeStream(stream, "orchestrator run is finishing");
            return;
        }
        const workerId =
            info?.publicKey?.toString("hex") || crypto.randomUUID();
        const peer = new ProtocolPeer(stream);
        let protocolFailure = null;
        peer.on("protocolError", (error) => {
            protocolFailure = error;
            console.log(
                `[dial] protocol error from ${workerId.slice(0, 12)}: ${error.message}`
            );
        });
        try {
            await authenticateClient(
                peer,
                keys.authKey,
                { local: pool.publicKey, remote: info?.publicKey },
                DISCOVERY_AUTH_TIMEOUT_MS
            );
            const ready = await waitForMessage(
                peer,
                "SERVER_READY",
                DISCOVERY_AUTH_TIMEOUT_MS
            );
            if (finishing) {
                peer.close("orchestrator run finished during authentication");
                return;
            }
            const priorState = workerStates.get(workerId);
            if (priorState?.quarantined) {
                peer.close(
                    `worker is quarantined for this run: ${priorState.latestReason}`
                );
                return;
            }
            let runners;
            try {
                runners = assertCompatibleWorkerProtocol(
                    ready.header.capabilities
                );
            } catch (error) {
                info.ban(true);
                if (!warnedIncompatibleWorkers.has(workerId)) {
                    warnedIncompatibleWorkers.add(workerId);
                    console.warn(
                        `Ignoring worker ${ready.header.name}: ${error.message}`
                    );
                }
                peer.close(error.message);
                return;
            }
            const worker = {
                id: workerId,
                peer,
                label: ready.header.name,
                color: workerColors.colorFor(workerId, ready.header.name),
                lastStatus: null,
                attemptPaths: new Map(),
                clean: false,
                leased: false,
                failure: null,
                memoryGb: ready.header.capabilities.memoryGb,
                capabilities: ready.header.capabilities,
                distributedProtocol:
                    ready.header.capabilities.distributedProtocol,
                runners,
                heartbeatTimeoutMs:
                    ready.header.capabilities.heartbeatTimeoutMs || 15000,
                heartbeat: null,
                connectionHash: connectionHash(stream),
                // Set once a task is assigned: failures before that are setup failures.
                admitted: false,
                retired: false
            };
            recordWorkerRetirement(workerStates, workerId, {
                label: worker.label,
                kind: "connected",
                reason: "authenticated connection accepted",
                disposition: "connected"
            });
            worker.heartbeat = createHeartbeatMonitor(
                peer,
                worker.heartbeatTimeoutMs,
                () => {
                    worker.failure = new Error(
                        `Worker ${worker.label} heartbeat timed out`
                    );
                    retireWorker(
                        worker,
                        `worker heartbeat timed out after ${worker.heartbeatTimeoutMs}ms`,
                        {
                            kind: "heartbeat timeout",
                            reason: worker.failure.message
                        }
                    );
                }
            );
            const existing = workers.get(workerId);
            if (existing) {
                const winner = selectLowerHash(existing, worker);
                const loser = winner === existing ? worker : existing;
                console.log(
                    `[dedup] authenticated duplicate from ${workerId.slice(0, 12)}: ` +
                        `keeping lower stream ${shortConnectionHash(winner.connectionHash)}, ` +
                        `closing ${shortConnectionHash(loser.connectionHash)}`
                );
                if (winner === existing) {
                    worker.heartbeat.stop();
                    peer.close(
                        `protocol deduplication kept lower authenticated stream ${shortConnectionHash(existing.connectionHash)}`
                    );
                    return;
                }
                workers.set(workerId, worker);
                retireWorker(
                    existing,
                    `protocol deduplication selected lower authenticated stream ${shortConnectionHash(worker.connectionHash)}`,
                    { setupFailure: false }
                );
            } else {
                workers.set(workerId, worker);
            }
            clearRediscoveryTimeout();
            workerLabelById.set(workerId, worker.label);
            console.log(
                `Connected to worker ${workerName(worker)} (protocol ${worker.distributedProtocol}: ${[...runners].join(", ")}); requesting lease`
            );
            coordinator.registerWorker(workerId, {
                canRun: (task) => workerCanRunTask(runners, task)
            });
            peer.on("message", (message) => {
                worker.heartbeat.received();
                handleMessage(worker, message).catch((error) =>
                    dropWorker(worker, error)
                );
            });
            peer.once("close", () =>
                retireWorker(
                    worker,
                    null,
                    protocolFailure
                        ? {
                              kind: "protocol failure",
                              reason: protocolFailure.message
                          }
                        : {}
                )
            );
            const leaseHeader = { sessionId };
            if (
                ready.header.capabilities.extensions?.resourceAllocationDetails
            ) {
                leaseHeader.extensions = { resourceAllocationDetails: true };
            }
            if (
                ready.header.capabilities.extensions?.executionProfile &&
                options.executionProfile
            ) {
                leaseHeader.executionProfile = options.executionProfile;
            }
            worker.executionProfile = leaseHeader.executionProfile || {};
            await peer.send("LEASE_REQUEST", leaseHeader);
            resolveFirst();
        } catch (error) {
            await pool.yieldFailedOutgoingDial(stream, info, error);
            if (!isRoutineDiscoveryFailure(error)) {
                console.warn(
                    `Rejected worker connection: ${error.message || error}`
                );
            }
            peer.close(
                `authentication or worker setup failed: ${error.message}`
            );
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
                manifestForDistributedProtocol(
                    options.manifest,
                    worker.distributedProtocol
                ),
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
            const runExtensions = {};
            if (worker.capabilities.extensions?.resourceLimitDetails) {
                runExtensions.resourceLimitDetails = true;
            }
            if (worker.capabilities.extensions?.isolatedRuntimeMetadata) {
                runExtensions.isolatedRuntimeMetadata = true;
            }
            await worker.peer.send("RUN_CONFIG", {
                baseEnv: options.baseEnv,
                taskCount: options.tasks.length,
                extensions: Object.keys(runExtensions).length
                    ? runExtensions
                    : undefined
            });
        } else if (message.kind === "BUSY") {
            workerStatus(worker, formatBusyStatus(message.header));
        } else if (message.kind === "FAULTED") {
            const error = new Error(
                `Worker ${worker.label} is faulted: ${message.header.message}`
            );
            worker.failure = error;
            fs.appendFileSync(
                logStore.infrastructurePath(worker.id, worker.label),
                `${error.message}\n`
            );
            workerFaultStatus(worker, `FAULTED: ${message.header.message}`);
            const state = recordWorkerFailure(
                workerStates,
                worker.id,
                {
                    label: worker.label,
                    kind: "faulted",
                    reason: error.message
                },
                1
            );
            reportQuarantine(worker, state);
            retireWorker(
                worker,
                "worker server requires administrator restart",
                { kind: "faulted", reason: error.message }
            );
        } else if (message.kind === "WORKER_READY") {
            workerStatus(worker, "Ready");
        } else if (message.kind === "TASK_REQUEST") {
            const assignment = coordinator.requestTask(worker.id);
            if (!assignment) {
                await worker.peer.send("NO_TASK_AVAILABLE", {
                    requestId: message.header.requestId
                });
                settleRun();
                return;
            }
            if (!worker.admitted) {
                worker.admitted = true;
                resetSetupFailures(workerStates, worker.id);
            }
            const wireAssignment = {
                ...assignment,
                task: toWireTask(assignment.task, options.projectRoot, {
                    schedule: options.schedule,
                    distributedProtocol: worker.distributedProtocol
                })
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
            ingestAttemptLogMessage(
                logStore,
                `${worker.id}:${message.header.attemptId}`,
                message
            );
        } else if (message.kind === "LOG_END") {
            const output = ingestAttemptLogMessage(
                logStore,
                `${worker.id}:${message.header.attemptId}`,
                message
            );
            committedOutput.set(message.header.attemptId, output);
            await worker.peer.send("LOG_COMMITTED", {
                requestId: message.header.requestId,
                attemptId: message.header.attemptId
            });
        } else if (message.kind === "ATTEMPT_RESULT") {
            const attemptId = message.header.assignment.attemptId;
            const output = committedOutput.get(attemptId);
            if (message.header.logTransferred && !output)
                throw new Error(
                    "Attempt result arrived before its log was committed"
                );
            if (!message.header.logTransferred) {
                const key = `${worker.id}:${attemptId}`;
                logStore.abort(key);
                const attemptPath = worker.attemptPaths.get(attemptId);
                if (attemptPath) fs.rmSync(attemptPath, { force: true });
            }
            committedOutput.delete(attemptId);
            const completion = coordinator.completeAttempt(worker.id, {
                ...message.header.result,
                stdout: output?.stdout || "",
                stderr: output?.stderr || "",
                attemptId
            });
            if (completion.disposition === "retry-starvation") {
                promoteStarvationAttemptLog(
                    options.logDir,
                    message.header.assignment,
                    worker
                );
                logging.starvationRetry({
                    seq: message.header.assignment.seq,
                    total: options.tasks.length,
                    label: message.header.result.label,
                    starveCount: completion.parsed.starveCount,
                    worker: workerName(worker)
                });
            } else if (completion.disposition === "retry-infrastructure") {
                logging.infrastructureRetry({
                    seq: message.header.assignment.seq,
                    total: options.tasks.length,
                    label: message.header.result.label,
                    reason: completion.failureReason,
                    worker: workerName(worker)
                });
            }
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
        } else if (message.kind === "INFRA_PROCESS_LOG") {
            logStore.writeInfrastructureProcessChunk(
                worker.id,
                worker.label,
                message.header.processKind,
                message.header.slotId,
                message.header.trigger,
                message.header.processFailure,
                message.header.uploadId,
                message.header.sequence,
                message.header.chunkCount,
                message.body
            );
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
            const failure = recordWorkerFailure(workerStates, worker.id, {
                label: worker.label,
                kind: "workspace preparation failure",
                reason: error.message
            });
            if (failure.quarantined) {
                reportQuarantine(worker, failure);
            }
            retireWorker(worker, "workspace preparation failed", {
                kind: "workspace preparation failure",
                reason: error.message
            });
        } else if (message.kind === "RESOURCE_ALLOCATION_REJECTED") {
            const error = new Error(
                `Worker ${workerName(worker)} refused ${message.header.resource}: ${message.header.message}`
            );
            worker.failure = error;
            fs.appendFileSync(
                logStore.infrastructurePath(worker.id, worker.label),
                `${error.message}\n`
            );
            workerStatus(worker, error.message, process.stderr);
            retireWorker(worker, "resource allocation rejected", {
                kind: "resource allocation rejected",
                reason: error.message
            });
        } else if (message.kind === "RESOURCE_LIMIT_EXCEEDED") {
            const error = new Error(
                `Worker ${workerName(worker)} exceeded ${message.header.resource} limit ${message.header.limit} during ${message.header.phase || "execution"}`
            );
            worker.failure = error;
            fs.appendFileSync(
                logStore.infrastructurePath(worker.id, worker.label),
                `${error.message}\n`
            );
            workerFaultStatus(worker, error.message);
            retireWorker(
                worker,
                "isolated environment resource limit exceeded",
                { kind: "resource limit exceeded", reason: error.message }
            );
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
            const failure = recordWorkerFailure(workerStates, worker.id, {
                label: worker.label,
                kind: "fatal worker failure",
                reason: error.message
            });
            if (failure.quarantined) {
                reportQuarantine(worker, failure);
            }
            retireWorker(worker, "test worker reported a fatal error", {
                kind: "fatal worker failure",
                reason: error.message
            });
        } else if (message.kind === "LEASE_CLEAN") {
            worker.clean = true;
            workerStatus(worker, "Lease cleaned; ready for another run");
            settleCleanup();
        }
    }

    function dropWorker(worker, error) {
        worker.failure ||= error;
        retireWorker(worker, `worker protocol failed: ${error.message}`, {
            kind: "protocol failure",
            reason: error.message
        });
    }

    function reportQuarantine(worker, state) {
        if (state.quarantineReported) return;
        state.quarantineReported = true;
        workerStatus(
            worker,
            `Quarantined after ${state.failures} failure(s): ${state.latestReason}. Infrastructure log: ${logStore.infrastructurePath(worker.id, worker.label)}`,
            process.stderr
        );
    }

    function retireWorker(worker, closeReason = null, retirement = {}) {
        if (worker.retired) return;
        worker.retired = true;
        const reason =
            retirement.reason ||
            worker.failure?.message ||
            closeReason ||
            "connection closed";
        // Every way a host leaves before it is given a task counts towards the
        // setup cap, whether the orchestrator, the host or the transport ended it.
        const setupState =
            !worker.admitted && !finishing && retirement.setupFailure !== false
                ? recordSetupFailure(workerStates, worker.id, {
                      label: worker.label,
                      reason
                  })
                : null;
        if (setupState?.setupCapped) {
            console.warn(
                `Retiring worker ${workerName(worker)} for this run after ${setupState.setupFailures} identical setup failures: ${reason}`
            );
        }
        recordWorkerRetirement(workerStates, worker.id, {
            label: worker.label,
            kind: retirement.kind || "connection closed",
            reason,
            disposition: retirement.disposition
        });
        worker.heartbeat?.stop();
        for (const attemptId of worker.attemptPaths.keys()) {
            logStore.abort(`${worker.id}:${attemptId}`);
        }
        coordinator.disconnectWorker(worker.id);
        const wasCurrent = workers.get(worker.id) === worker;
        if (wasCurrent) workers.delete(worker.id);
        if (closeReason) worker.peer.close(closeReason);
        const allCapped =
            setupState?.setupQuarantined && !finishing && !workers.size
                ? allWorkersSetupCapped(workerStates)
                : null;
        if (allCapped) {
            clearRediscoveryTimeout();
            completedReject(new Error(allCapped));
            return;
        }
        // The worker that could run the remaining tasks may be the one gone.
        settleRun();
        if (
            !finishing &&
            wasCurrent &&
            !workers.size &&
            coordinator.finish().pending
        ) {
            discoveryStartedAt = Date.now();
            armRediscoveryTimeout();
            console.log(
                "No workers connected; waiting for a worker to become available"
            );
        }
        settleCleanup();
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
                    .send("RUN_COMPLETE", {
                        collectInfraLogs:
                            options.keepInfraLogs === true ||
                            coordinator.failed.length > 0
                    })
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
        workerLabels = usedWorkers.map((worker) =>
            formatWorkerSummary(worker, completedByWorker.get(worker.id) || 0)
        );
    } finally {
        clearTimeout(discoveryTimeout);
        clearTimeout(unservableTimer);
        clearInterval(discoveryProgress);
        options.signal?.removeEventListener("abort", cancel);
        for (const worker of workers.values()) worker.heartbeat.stop();
        await pool.close();
    }
    const state = coordinator.finish();
    const resourceStats = aggregateWorkerStats(usedWorkers);
    const metrics = logging.buildRunMetrics({
        tasks: options.tasks,
        workers: usedWorkers.map((worker) => ({
            id: worker.id,
            label: worker.label,
            stats: worker.stats,
            legacyAdmission:
                options.schedule !== "cost" || worker.distributedProtocol < 15
        })),
        makespanMs: Date.now() - startedAt,
        sumDurationMs: state.sumDurationMs,
        workerLabel: (id) => workerLabelById.get(id) || id
    });
    logging.writeRunMetrics(options.logDir, metrics);
    costCache.commit({ interrupted: options.signal?.aborted || !state.done });
    return {
        failed: state.failed,
        completed: state.completed,
        skipped: state.skipped,
        sumDurationMs: state.sumDurationMs,
        ...resourceStats,
        workers: workerLabels,
        workerLabel: (id) => workerLabelById.get(id) || id
    };
}

module.exports = {
    MAX_IDENTICAL_SETUP_FAILURES,
    WORKER_COLORS,
    allWorkersSetupCapped,
    normalizeFailureReason,
    recordSetupFailure,
    resetSetupFailures,
    aggregateWorkerStats,
    assertCompatibleWorkerProtocol,
    coordinatorResultActions,
    createWorkerColorRegistry,
    createHeartbeatMonitor,
    formatBusyStatus,
    formatSkippedTasksNotice,
    formatWorkerDispositions,
    formatWorkerSummary,
    ingestAttemptLogMessage,
    isRoutineDiscoveryFailure,
    promoteAttemptLog,
    promoteStarvationAttemptLog,
    recordWorkerFailure,
    recordWorkerRetirement,
    reportLostTasks,
    reportSkippedTasks,
    runDistributed,
    validateWorkerStats,
    workerFaultStatus
};
