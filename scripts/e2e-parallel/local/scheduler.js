/* eslint-disable no-console */
const { HARDHAT_CLI, SCHEDULER_TICK_MS } = require("../shared/constants");
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("../shared/accountPartitionPool");
const {
    cpuTimes,
    rssGbForPids,
    ResourceGate
} = require("../shared/resourceGate");
const { liveTaskChildren, runTask } = require("../shared/runTask");
const { TaskCoordinator } = require("../shared/taskCoordinator");
const { WorkerScheduler } = require("../shared/workerScheduler");
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
    tickMs = SCHEDULER_TICK_MS
}) {
    let sequence = 0;
    const accountPartitions = new AccountPartitionPool();
    const resources = new ResourceGate({
        testPids: () =>
            [...liveTaskChildren]
                .filter((child) => !child.killed && child.pid)
                .map((child) => child.pid),
        infraPids,
        targetLoad,
        memBoundGb
    });

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
            const allowed = resources.allows(running, concurrencyCap);
            if (!allowed && coordinator.finish().pending) {
                const { cpuUtil, occupiedGb, avgPerTestGb } = resources;
                const next = coordinator.queue[0];
                const reason =
                    running >= concurrencyCap
                        ? `cap (running ${running}/${concurrencyCap})`
                        : occupiedGb + avgPerTestGb >= memBoundGb
                          ? `memory (owned ${occupiedGb.toFixed(1)}+${avgPerTestGb.toFixed(1)}≥${memBoundGb.toFixed(1)}GB)`
                          : `cpu ${(cpuUtil * 100).toFixed(0)}%>=${(targetLoad * 100).toFixed(0)}%`;
                logging.hold({
                    seq: next?.seq || tasks.length,
                    total: tasks.length,
                    reason
                });
            }
            return allowed;
        },
        requestTask: async () => coordinator.requestTask("local"),
        runTask: async (assignment) => {
            sequence++;
            const account = accountPartitions.acquire();
            const slot =
                slotCount > 0 ? slots[(sequence - 1) % slotCount] : null;
            const infraEnv = slot
                ? {
                      PROVIDER_URL: slot.nodeUrl,
                      HARDHAT_NODE_URL: slot.nodeUrl,
                      LOCAL_DISCOVERY_REGISTRY_URL: slot.discoveryUrl,
                      E2E_MANAGER_CACHE_DIR: slot.cacheDir,
                      E2E_INTERVAL_MINING: undefined
                  }
                : {
                      PROVIDER_URL: undefined,
                      HARDHAT_NODE_URL: undefined,
                      LOCAL_DISCOVERY_REGISTRY_URL: undefined,
                      E2E_MANAGER_CACHE_DIR: undefined,
                      E2E_INTERVAL_MINING: undefined
                  };
            logging.admission({
                seq: assignment.seq,
                total: tasks.length,
                where: slot ? `slot ${slot.id}/${slotCount}` : "in-process",
                running: scheduler.running,
                concurrencyCap,
                acct: account,
                cpuUtil: resources.cpuUtil,
                targetLoad,
                occupiedGb: resources.occupiedGb,
                memBoundGb
            });
            let attempt;
            try {
                attempt = await runTask(
                    process.execPath,
                    [HARDHAT_CLI, ...assignment.task.args],
                    {
                        ...baseEnv,
                        ...infraEnv,
                        E2E_SLOT_INDEX: String(
                            accountPartitionFor(slot, account)
                        )
                    },
                    assignment.task.label,
                    logging.getLogPath(logDir, assignment.task.logName)
                );
            } finally {
                accountPartitions.release(account);
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
        scheduler.options.onError = (error) => {
            clearInterval(monitor);
            scheduler.stop();
            reject(error);
        };
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
