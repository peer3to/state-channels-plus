/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { WorkerScheduler } = require("../shared/workerScheduler");
const { TaskResourcePool } = require("../shared/taskResources");
const { WorkerAttemptSpool } = require("./workerAttemptSpool");
const { fromWireTask } = require("./taskWire");
const { liveTaskChildren, runTask } = require("../shared/runTask");
const { ResourceGate } = require("../shared/resourceGate");
const { HARDHAT_CLI } = require("../shared/constants");
const { holdReason } = require("../shared/scheduling");
const logging = require("../shared/logging");
const { reduceAttemptOutput } = require("../shared/taskCoordinator");
const {
    provisionSlots,
    teardownInfra
} = require("../../../test/utils/nodeInfra");
const {
    createInfrastructureProcessLogChunks
} = require("./infrastructureLogTransfer");

let scheduler;
let infra = { nodes: [], discoveries: [] };
let slots = [];
let configuration;
let resources;
let completionExitCode;
let requestId = 1;
let infrastructureUploadId = 1;
let infrastructureFailed = false;
const pending = new Map();
const cancellation = new AbortController();

function processFailureReason(label, code, signal) {
    return `${label} exited (${code === null ? `signal ${signal || "unknown"}` : `code ${code}`})`;
}

function workerErrorMessage(message) {
    return { kind: "WORKER_ERROR", message, stats: resources?.stats() };
}

function sendToServer(message) {
    return new Promise((resolve, reject) => {
        if (!process.connected) {
            reject(new Error("Distributed worker IPC is disconnected"));
            return;
        }
        process.send(message, (error) => (error ? reject(error) : resolve()));
    });
}

async function reportInfrastructureProcessLog(
    processKind,
    processHandle,
    trigger,
    processFailure
) {
    let log = Buffer.alloc(0);
    try {
        log = processHandle.logPath
            ? fs.readFileSync(processHandle.logPath)
            : Buffer.alloc(0);
    } catch (error) {
        log = Buffer.from(
            `Could not read ${processKind} log: ${error.message}\n`
        );
    }
    const uploadId = `${process.pid}-${infrastructureUploadId++}`;
    for (const chunk of createInfrastructureProcessLogChunks(log)) {
        await request("INFRA_PROCESS_DIAGNOSTIC", {
            uploadId,
            processKind,
            slotId: processHandle.slotId,
            trigger,
            processFailure,
            ...chunk
        });
    }
}

async function reportInfrastructureLogs() {
    const results = await Promise.allSettled([
        ...infra.nodes.map((node) =>
            reportInfrastructureProcessLog(
                "hardhat",
                node,
                "run completed; collecting infrastructure logs",
                ""
            )
        ),
        ...infra.discoveries.map((discovery) =>
            reportInfrastructureProcessLog(
                "discovery",
                discovery,
                "run completed; collecting infrastructure logs",
                ""
            )
        )
    ]);
    for (const result of results) {
        if (result.status === "rejected") {
            console.error(
                `Could not collect infrastructure log: ${result.reason?.message || result.reason}`
            );
        }
    }
}

function monitorInfrastructureProcess(processKind, processHandle) {
    processHandle.exited.then(async ({ code, signal }) => {
        if (cancellation.signal.aborted) return;
        const reason = processFailureReason(processHandle.label, code, signal);
        infrastructureFailed = true;
        scheduler?.stop();
        cancellation.abort();
        await processHandle.logClosed;
        try {
            await reportInfrastructureProcessLog(
                processKind,
                processHandle,
                `${processKind} process exited`,
                reason
            );
        } catch (error) {
            console.error(
                `Could not report ${processKind} process failure: ${error.message}`
            );
        }
        try {
            await sendToServer(workerErrorMessage(reason));
        } catch (error) {
            console.error(`Could not report worker failure: ${error.message}`);
        }
    });
}

function request(kind, payload = {}) {
    return new Promise((resolve, reject) => {
        const id = requestId++;
        const timeoutMs = Math.max(
            1000,
            (configuration?.heartbeatTimeoutMs || 15000) * 2
        );
        const timeout = setTimeout(() => {
            if (!pending.delete(id)) return;
            reject(new Error(`${kind} request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref();
        pending.set(id, { resolve, reject, timeout });
        process.send({ kind, requestId: id, ...payload }, (error) => {
            if (!error) return;
            const waiter = pending.get(id);
            if (!waiter) return;
            pending.delete(id);
            clearTimeout(waiter.timeout);
            reject(error);
        });
    });
}

function rejectPending(error) {
    for (const waiter of pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(error);
    }
    pending.clear();
}

async function start(config) {
    configuration = config;
    const provisioned = await provisionSlots(
        config.slotCount,
        config.infraLogDir
    );
    infra = provisioned.infra;
    slots = provisioned.slots;
    for (const discovery of infra.discoveries) {
        monitorInfrastructureProcess("discovery", discovery);
    }
    for (const node of infra.nodes) {
        monitorInfrastructureProcess("hardhat", node);
    }
    const taskResources = new TaskResourcePool({
        baseEnv: config.baseEnv,
        slots
    });
    resources = new ResourceGate({
        testPids: () =>
            [...liveTaskChildren]
                .filter((child) => !child.killed && child.pid)
                .map((child) => child.pid),
        infraPids: () =>
            [
                process.pid,
                ...infra.nodes.map((node) => node.proc.pid),
                ...infra.discoveries.map((entry) => entry.child.pid)
            ].filter(Boolean),
        targetLoad: config.targetLoad,
        memBoundGb: config.memBoundGb
    });
    scheduler = new WorkerScheduler({
        concurrencyCap: config.concurrencyCap,
        retryMs: config.schedulerTickMs,
        prefetch: true,
        canRun: async (running) => {
            const allowed = await resources.allows(
                running,
                config.concurrencyCap
            );
            if (!allowed) {
                const reason = holdReason({
                    running,
                    concurrencyCap: config.concurrencyCap,
                    resourceGate: resources,
                    memBoundGb: config.memBoundGb,
                    targetLoad: config.targetLoad
                });
                logging.hold({
                    seq: scheduler?.bufferedAssignment?.seq || 1,
                    total: config.taskCount,
                    reason,
                    buffered: scheduler.bufferedCount
                });
            }
            return allowed;
        },
        requestTask: async () => request("TASK_REQUEST"),
        runTask: async (assignment) => {
            const task = fromWireTask(assignment.task, config.projectRoot);
            // Forge brings its own EVM: no warm slot, no funded partition.
            const execution = taskResources.acquire(task);
            const { needsChain, accountPartition, slot } = execution;
            const spoolPath = path.join(
                config.spoolRoot,
                `${assignment.attemptId}.spool`
            );
            const spool = new WorkerAttemptSpool(
                spoolPath,
                config.maxAttemptSpoolBytes
            );
            logging.admission({
                seq: assignment.seq,
                total: config.taskCount,
                where: slot
                    ? `slot ${slot.id}/${slots.length}`
                    : needsChain
                      ? "in-process"
                      : "forge",
                running: scheduler.running,
                concurrencyCap: config.concurrencyCap,
                acct: needsChain ? accountPartition : "-",
                cpuUtil: resources.cpuUtil,
                targetLoad: config.targetLoad,
                occupiedGb: resources.occupiedGb,
                memBoundGb: config.memBoundGb,
                buffered: scheduler.bufferedCount
            });
            let result;
            try {
                result = await runTask(
                    process.execPath,
                    [HARDHAT_CLI, ...task.args],
                    execution.env,
                    task.label,
                    spool,
                    cancellation.signal,
                    { captureOutput: false }
                );
            } finally {
                execution.release();
            }
            const { stdout: _stdout, stderr: _stderr, ...wireResult } = result;
            const output = spool.readOutput();
            if (infrastructureFailed) {
                spool.remove();
                return;
            }
            await request("ATTEMPT_READY", {
                assignment: { ...assignment, task },
                result: {
                    ...wireResult,
                    reduced: reduceAttemptOutput(output.stdout, output.stderr)
                },
                spoolPath
            });
            spool.remove();
        },
        onError(error) {
            process.send(workerErrorMessage(error.message));
        }
    });
    process.send({ kind: "WORKER_READY" });
    scheduler.start();
}

async function stop(
    exitCode = 0,
    reportStats = false,
    collectInfraLogs = false
) {
    scheduler?.stop();
    cancellation.abort();
    if (reportStats && process.connected) {
        if (collectInfraLogs) {
            await reportInfrastructureLogs();
        }
        rejectPending(new Error("Distributed worker stopped"));
        completionExitCode = exitCode;
        process.send({ kind: "WORKER_COMPLETE", stats: resources?.stats() });
        return;
    }
    rejectPending(new Error("Distributed worker stopped"));
    finishStop(exitCode);
}

function finishStop(exitCode) {
    teardownInfra(infra);
    process.exit(exitCode);
}

process.on("message", (message) => {
    if (message.kind === "START")
        start(message.config).catch((error) => stopWithError(error));
    else if (message.kind === "RESPONSE") {
        const waiter = pending.get(message.requestId);
        if (!waiter) return;
        pending.delete(message.requestId);
        clearTimeout(waiter.timeout);
        if (message.error) waiter.reject(new Error(message.error));
        else waiter.resolve(message.value);
    } else if (message.kind === "WORK_AVAILABLE") scheduler?.workAvailable();
    else if (message.kind === "WORKER_COMPLETE_ACK")
        finishStop(completionExitCode ?? 0);
    else if (message.kind === "RUN_COMPLETE")
        stop(0, true, message.collectInfraLogs === true);
    else if (message.kind === "CANCEL") stop();
});
process.on("disconnect", () => stop());
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

function stopWithError(error) {
    console.error(error.stack || error);
    process.send?.(workerErrorMessage(error.message));
    stop(1);
}

module.exports = { rejectPending, request, start };
