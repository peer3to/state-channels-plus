/* eslint-disable no-console */
const { HARDHAT_CLI, SCHEDULER_TICK_MS } = require("../shared/constants");
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("../shared/accountPartitionPool");
const { TaskResourcePool } = require("../shared/taskResources");
const {
    cpuTimes,
    rssGbForPids,
    ResourceGate
} = require("../shared/resourceGate");
const { liveTaskChildren, runTask } = require("../shared/runTask");
const { TaskCoordinator } = require("../shared/taskCoordinator");
const { WorkerScheduler } = require("../shared/workerScheduler");
const { holdReason } = require("../shared/scheduling");
const logging = require("../shared/logging");

function resolveMode(flag, envVar, fallback) {
    if (flag !== undefined) return flag;
    if (process.env[envVar] !== undefined)
        return process.env[envVar] !== "false";
    return fallback;
}

function resolveThreadModes(cli) {
    return {
        sdkThread: resolveMode(cli.sdkThread, "RUN_SDK_IN_THREAD", true),
        vmThread: resolveMode(cli.vmThread, "VM_DEDICATED_THREAD", true)
    };
}

async function runScheduler({
    tasks,
    slots,
    slotCount,
    concurrencyCap,
    targetLoad,
    memBoundGb,
    baseEnv,
    logDir,
    infraPids,
    tickMs = SCHEDULER_TICK_MS,
    runTaskImpl = runTask,
    accountPartitions = new AccountPartitionPool(),
    resourceGate
}) {
    const taskResources = new TaskResourcePool({
        baseEnv,
        slots,
        accountPartitions
    });
    const resources =
        resourceGate ||
        new ResourceGate({
            testPids: () =>
                [...liveTaskChildren]
                    .filter((child) => !child.killed && child.pid)
                    .map((child) => child.pid),
            infraPids,
            targetLoad,
            memBoundGb
        });
    let rejectRun;

    let scheduler;
    const coordinator = new TaskCoordinator(tasks, {
        onWorkAvailable: () => scheduler?.workAvailable(),
        onResult: ({ assignment, attempt, code, parsed }) => {
            if (code !== 0)
                logging.markLogAsError(logDir, assignment.task.logName);
            logging.result({
                completed: coordinator.completed,
                total: tasks.length,
                code,
                label: attempt.label,
                durationMs: attempt.durationMs,
                oomCount: parsed?.oomCount || 0,
                starveCount: parsed?.starveCount || 0,
                timing: parsed?.timing || logging.parseTimings(""),
                repeatedStarvation: assignment.task.repeatedStarvation
            });
        }
    });
    coordinator.registerWorker("local");

    scheduler = new WorkerScheduler({
        concurrencyCap,
        retryMs: tickMs,
        canRun: async (running) => {
            if (coordinator.queue.length === 0) return false;
            const allowed = await resources.allows(running, concurrencyCap);
            if (!allowed && coordinator.finish().pending) {
                const next = coordinator.queue[0];
                const reason = holdReason({
                    running,
                    concurrencyCap,
                    resourceGate: resources,
                    memBoundGb,
                    targetLoad
                });
                logging.hold({
                    seq: next?.seq || tasks.length,
                    total: tasks.length,
                    reason
                });
            }
            return allowed;
        },
        requestTask: async () => coordinator.requestTask("local"),
        onError: (error) => rejectRun?.(error),
        runTask: async (assignment) => {
            // Forge brings its own EVM: no warm slot, no funded partition.
            const execution = taskResources.acquire(assignment.task);
            const { needsChain, accountPartition: account, slot } = execution;
            logging.admission({
                seq: assignment.seq,
                total: tasks.length,
                where: slot
                    ? `slot ${slot.id}/${slotCount}`
                    : needsChain
                      ? "in-process"
                      : "forge",
                running: scheduler.running,
                concurrencyCap,
                acct: needsChain ? account : "-",
                cpuUtil: resources.cpuUtil,
                targetLoad,
                occupiedGb: resources.occupiedGb,
                memBoundGb
            });
            let attempt;
            try {
                attempt = await runTaskImpl(
                    process.execPath,
                    [HARDHAT_CLI, ...assignment.task.args],
                    execution.env,
                    assignment.task.label,
                    logging.getLogPath(logDir, assignment.task.logName)
                );
            } finally {
                execution.release();
            }
            const result = coordinator.completeAttempt("local", {
                ...attempt,
                attemptId: assignment.attemptId
            });
            if (result.disposition === "retry-starvation") {
                logging.starvationRetry({
                    seq: assignment.seq,
                    total: tasks.length,
                    label: attempt.label,
                    starveCount: result.parsed.starveCount
                });
            }
        }
    });

    await new Promise((resolve, reject) => {
        rejectRun = (error) => {
            clearInterval(monitor);
            scheduler.stop();
            reject(error);
        };
        const monitor = setInterval(
            () => {
                if (coordinator.finish().done) {
                    clearInterval(monitor);
                    scheduler.stop();
                    resolve();
                }
            },
            Math.min(tickMs, 100)
        );
        scheduler.start();
    });

    const resourceStats = resources.stats();
    return {
        failed: coordinator.failed,
        completed: coordinator.completed,
        sumDurationMs: coordinator.sumDurationMs,
        ...resourceStats
    };
}

module.exports = {
    resolveThreadModes,
    cpuTimes,
    rssGbForPids,
    accountPartitionFor,
    runScheduler
};
