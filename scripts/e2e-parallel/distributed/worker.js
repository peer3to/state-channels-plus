/* eslint-disable no-console */
const path = require("path");
const { WorkerScheduler } = require("../shared/workerScheduler");
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("../shared/accountPartitionPool");
const { WorkerAttemptSpool } = require("./workerAttemptSpool");
const { fromWireTask } = require("./taskWire");
const { liveTaskChildren, runTask } = require("../shared/runTask");
const { ResourceGate } = require("../shared/resourceGate");
const { HARDHAT_CLI } = require("../shared/constants");
const { buildSlotEnv, holdReason } = require("../shared/scheduling");
const logging = require("../shared/logging");
const {
    provisionSlots,
    teardownInfra
} = require("../../../test/utils/nodeInfra");

let scheduler;
let infra = { nodes: [], discoveries: [] };
let slots = [];
let configuration;
let resources;
let completionExitCode;
let requestId = 1;
const pending = new Map();
const cancellation = new AbortController();

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
    let slotSequence = 0;
    const accountPartitions = new AccountPartitionPool();
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
            const accountPartition = accountPartitions.acquire();
            const slot = slots.length
                ? slots[slotSequence++ % slots.length]
                : null;
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
                where: slot ? `slot ${slot.id}/${slots.length}` : "in-process",
                running: scheduler.running,
                concurrencyCap: config.concurrencyCap,
                acct: accountPartition,
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
                    {
                        ...config.baseEnv,
                        ...buildSlotEnv(
                            slot,
                            accountPartitionFor(slot, accountPartition)
                        )
                    },
                    task.label,
                    spool,
                    cancellation.signal,
                    { captureOutput: false }
                );
            } finally {
                accountPartitions.release(accountPartition);
            }
            const { stdout: _stdout, stderr: _stderr, ...wireResult } = result;
            await request("ATTEMPT_READY", {
                assignment: { ...assignment, task },
                result: wireResult,
                spoolPath
            });
            spool.remove();
        },
        onError(error) {
            process.send({ kind: "WORKER_ERROR", message: error.message });
        }
    });
    process.send({ kind: "WORKER_READY" });
    scheduler.start();
}

async function stop(exitCode = 0, reportStats = false) {
    scheduler?.stop();
    cancellation.abort();
    rejectPending(new Error("Distributed worker stopped"));
    if (reportStats && process.connected) {
        completionExitCode = exitCode;
        process.send({ kind: "WORKER_COMPLETE", stats: resources?.stats() });
        return;
    }
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
    else if (message.kind === "RUN_COMPLETE") stop(0, true);
    else if (message.kind === "CANCEL") stop();
});
process.on("disconnect", () => stop());
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

function stopWithError(error) {
    console.error(error.stack || error);
    process.send?.({ kind: "WORKER_ERROR", message: error.message });
    stop(1);
}

module.exports = { rejectPending, request, start };
