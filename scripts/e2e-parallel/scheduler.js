/* eslint-disable no-console */
const { execFileSync } = require("child_process");
const os = require("os");
const {
    HARDHAT_CLI,
    SCHEDULER_TICK_MS,
    MAX_SLOTS_FROM_POOL,
    PER_TEST_MEM_GB,
    LOAD_RETRY_EL_DELAY_MS,
    ADAPTIVE_START_CAP,
    ADAPTIVE_MIN_CAP
} = require("./constants");
const { liveTaskChildren, runTask } = require("./runTask");
const logging = require("./logging");
const {
    availableMemGb,
    nextAdaptiveCap,
    pickLeastLoadedSlot,
    evaluateAdmission
} = require("./adaptiveScheduling");

// Resolve a thread-mode boolean with precedence: CLI flag > inherited env > default.
// (Env value "false" disables; any other set value enables; unset → fallback.)
function resolveMode(flag, envVar, fallback) {
    if (flag !== undefined) return flag;
    if (process.env[envVar] !== undefined)
        return process.env[envVar] !== "false";
    return fallback;
}

// Thread modes are uniform across the whole run — set once at the CLI (or env)
// and passed to every test. Both worker-thread modes default on.
function resolveThreadModes(cli) {
    return {
        sdkThread: resolveMode(cli.sdkThread, "RUN_SDK_IN_THREAD", true),
        vmThread: resolveMode(cli.vmThread, "VM_DEDICATED_THREAD", true)
    };
}

// Cumulative CPU tick counters across all cores. Diffing two snapshots gives the
// actual busy fraction over the interval — unlike os.loadavg(), which is a
// lagging 1-minute run-queue average that under-reports a freshly-pegged CPU.
function cpuTimes() {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
        for (const v of Object.values(c.times)) total += v;
        idle += c.times.idle;
    }
    return { idle, total };
}

// Sum the RSS (in GiB) of the given pids via `ps`. Best-effort: dead pids are
// omitted by ps; any failure returns 0 so the memory gate fails open.
function rssGbForPids(pids) {
    if (!pids.length) return 0;
    try {
        const out = execFileSync("ps", ["-o", "rss=", "-p", pids.join(",")], {
            encoding: "utf8"
        });
        const kb = out
            .split("\n")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter(Number.isFinite)
            .reduce((a, b) => a + b, 0);
        return kb / 1024 / 1024;
    } catch {
        return 0;
    }
}

// A failed task whose event loop was starved gets one retry. starveCount is the
// watchdog signal; maxEventLoopDelayMs catches stalls under its threshold.
function getStarvationDisposition(
    starveCount,
    starvationRetryCount,
    { code = 0, maxEventLoopDelayMs = 0 } = {}
) {
    if (starveCount > 0) {
        return starvationRetryCount === 0 ? "retry" : "fail";
    }
    if (
        code !== 0 &&
        starvationRetryCount === 0 &&
        maxEventLoopDelayMs >= LOAD_RETRY_EL_DELAY_MS
    ) {
        return "retry";
    }
    return "complete";
}

/**
 * Run all tasks with one admission per tick, gated by latest CPU utilization,
 * live memory, and a concurrency cap. Slots are assigned round-robin; account
 * partitions (E2E_SLOT_INDEX) are acquired per running test so concurrent tests
 * never collide even when they share a slot's node.
 *
 * Mutates each task with its result fields (oomCount/starveCount/timing) and
 * returns aggregate run stats for the summary.
 */
async function runScheduler({
    tasks,
    slots,
    slotCount,
    concurrencyCap,
    adaptiveWorkers = true,
    targetLoad,
    memBoundGb,
    memFloorGb,
    baseEnv,
    logDir,
    infraPids,
    tickMs = SCHEDULER_TICK_MS
}) {
    let idx = 0;
    let running = 0;
    let completed = 0;
    let sumDurationMs = 0;
    const failed = [];
    // Starved tasks go behind every first attempt so their retry runs after the
    // original admission burst, when the suite is more likely to have capacity.
    const retryQueue = [];

    // Latest CPU utilization (busy fraction over the last tick interval).
    let lastCpu = cpuTimes();
    let cpuUtil = 0;
    let peakCpu = 0;
    const cpuSamples = [];
    const sampleCpu = () => {
        const now = cpuTimes();
        const idleD = now.idle - lastCpu.idle;
        const totalD = now.total - lastCpu.total;
        lastCpu = now;
        if (totalD > 0) {
            cpuUtil = Math.max(0, Math.min(1, 1 - idleD / totalD));
        }
        if (cpuUtil > peakCpu) peakCpu = cpuUtil;
        cpuSamples.push(cpuUtil);
    };

    // Free-list of account partitions; size matches the concurrency cap.
    const freeAccounts = Array.from(
        { length: MAX_SLOTS_FROM_POOL },
        (_, i) => i
    );

    // In-flight test count per slot, for idle-first assignment.
    const slotLoad = new Array(Math.max(slotCount, 0)).fill(0);

    // Measured concurrency ceiling, bounded by --workers / the account pool.
    // goodCap/badCap bracket the machine's real limit; the probe bisects between
    // them and stops once they are adjacent. An explicit --workers is a fixed
    // value, not a starting point: the probe never runs and the cap never moves.
    let adaptiveCap = adaptiveWorkers
        ? Math.min(ADAPTIVE_START_CAP, concurrencyCap)
        : concurrencyCap;
    let healthyStreak = 0;
    let goodCap = ADAPTIVE_MIN_CAP;
    let badCap = Infinity;
    let peakAdaptiveCap = adaptiveCap;

    // Live memory: RSS of our own processes (infra + live test children), with a
    // running per-test average used to project whether one more test fits.
    let avgPerTestGb = PER_TEST_MEM_GB; // conservative seed until measured
    let memSampleSum = 0;
    let memSampleN = 0;
    let occupiedGb = rssGbForPids(infraPids());
    let peakOccupiedGb = occupiedGb;
    const sampleMemory = () => {
        const testPids = [...liveTaskChildren]
            .filter((c) => !c.killed && c.pid)
            .map((c) => c.pid);
        const testGb = rssGbForPids(testPids);
        occupiedGb = testGb + rssGbForPids(infraPids());
        if (occupiedGb > peakOccupiedGb) peakOccupiedGb = occupiedGb;
        if (testPids.length > 0) {
            memSampleSum += testGb / testPids.length;
            memSampleN++;
            avgPerTestGb = Math.max(0.25, memSampleSum / memSampleN);
        }
    };

    // System-available memory, resampled each tick: counts other processes, so we
    // back off before the box swaps.
    let availGb = availableMemGb();
    const sampleSystem = () => {
        availGb = availableMemGb();
    };

    const launch = (task, seq) => {
        running++;
        const acct = freeAccounts.shift();
        const slotIdx =
            task.isE2E && slotCount > 0 ? pickLeastLoadedSlot(slotLoad) : -1;
        if (slotIdx >= 0) slotLoad[slotIdx]++;
        const slot = slotIdx >= 0 ? slots[slotIdx] : null;
        const where = slot ? `slot ${slot.id}/${slotCount}` : "in-process";

        let taskArgs = task.args;
        let infraEnv;
        if (slot) {
            taskArgs = [
                task.args[0],
                "--network",
                "localhost",
                ...task.args.slice(1)
            ];
            infraEnv = {
                PROVIDER_URL: slot.nodeUrl,
                HARDHAT_NODE_URL: slot.nodeUrl,
                LOCAL_DISCOVERY_REGISTRY_URL: slot.discoveryUrl,
                E2E_MANAGER_CACHE_DIR: slot.cacheDir,
                E2E_INTERVAL_MINING: "1"
            };
        } else {
            // Plain in-process Hardhat tests rely on automining: their setup
            // helpers return deployed contracts for immediate use. Harness
            // tests self-provision an interval-mined node when they need one.
            infraEnv = {
                PROVIDER_URL: undefined,
                HARDHAT_NODE_URL: undefined,
                LOCAL_DISCOVERY_REGISTRY_URL: undefined,
                E2E_MANAGER_CACHE_DIR: undefined,
                E2E_INTERVAL_MINING: undefined
            };
        }

        logging.admission({
            seq,
            total: tasks.length,
            where,
            running,
            concurrencyCap,
            acct,
            cpuUtil,
            targetLoad,
            occupiedGb,
            memBoundGb
        });

        runTask(
            process.execPath,
            [HARDHAT_CLI, ...taskArgs],
            { ...baseEnv, ...infraEnv, E2E_SLOT_INDEX: String(acct) },
            task.label,
            logging.getLogPath(logDir, task.logName)
        ).then(({ code, label, stdout, stderr, durationMs }) => {
            running--;
            freeAccounts.push(acct);
            if (slotIdx >= 0) slotLoad[slotIdx]--;
            sumDurationMs += durationMs;

            const combined = stdout + stderr;
            const attemptOomCount = logging.countOomEvents(combined);
            const attemptStarveCount = logging.countStarvation(combined);
            task.oomCount = (task.oomCount || 0) + attemptOomCount;
            task.starveCount = (task.starveCount || 0) + attemptStarveCount;
            const timing = logging.parseTimings(combined);
            task.startupMs = (task.startupMs || 0) + timing.startupMs;
            task.deployMs = (task.deployMs || 0) + timing.deployMs;
            task.workerBootMs = (task.workerBootMs || 0) + timing.workerBootMs;
            task.maxEventLoopDelayMs = Math.max(
                task.maxEventLoopDelayMs || 0,
                timing.maxEventLoopDelayMs
            );
            task.el = Object.fromEntries(
                Object.keys(timing.el).map((role) => [
                    role,
                    Math.max(task.el?.[role] || 0, timing.el[role])
                ])
            );
            task.timingFound = task.timingFound || timing.found;

            // Feed this run's event loop back into the ceiling. Skipped entirely
            // when --workers pins a fixed value.
            const starvedSignal =
                attemptStarveCount > 0 ||
                timing.maxEventLoopDelayMs >= LOAD_RETRY_EL_DELAY_MS;
            if (adaptiveWorkers) {
                const next = nextAdaptiveCap({
                    current: adaptiveCap,
                    starved: starvedSignal,
                    elDelayMs: timing.maxEventLoopDelayMs,
                    hasTiming: timing.found,
                    healthyStreak,
                    goodCap,
                    badCap,
                    maxCap: concurrencyCap
                });
                if (next.cap !== adaptiveCap) {
                    logging.adaptiveCap({
                        from: adaptiveCap,
                        to: next.cap,
                        elDelayMs: timing.maxEventLoopDelayMs,
                        starved: starvedSignal,
                        settled: next.goodCap + 1 >= next.badCap
                    });
                }
                adaptiveCap = next.cap;
                healthyStreak = next.healthyStreak;
                goodCap = next.goodCap;
                badCap = next.badCap;
                if (adaptiveCap > peakAdaptiveCap)
                    peakAdaptiveCap = adaptiveCap;
            }

            const starvationDisposition = getStarvationDisposition(
                attemptStarveCount,
                task.starvationRetryCount || 0,
                { code, maxEventLoopDelayMs: timing.maxEventLoopDelayMs }
            );
            if (starvationDisposition === "retry") {
                task.starvationRetryCount = 1;
                retryQueue.push({ task, seq });
                logging.starvationRetry({
                    seq,
                    total: tasks.length,
                    label,
                    starveCount: attemptStarveCount,
                    elDelayMs: timing.maxEventLoopDelayMs
                });
                return;
            }

            // A second watchdog hit is a failed task even if the test process
            // happened to exit cleanly after emitting the starvation marker.
            const repeatedStarvation = starvationDisposition === "fail";
            const finalCode = repeatedStarvation && code === 0 ? 1 : code;
            task.repeatedStarvation = repeatedStarvation;
            task.starvationRetrySucceeded =
                task.starvationRetryCount === 1 &&
                !repeatedStarvation &&
                finalCode === 0;

            completed++;
            if (finalCode !== 0) {
                failed.push(task);
                logging.markLogAsError(logDir, task.logName);
            }
            logging.result({
                completed,
                total: tasks.length,
                code: finalCode,
                label,
                durationMs,
                oomCount: attemptOomCount,
                starveCount: attemptStarveCount,
                timing,
                repeatedStarvation
            });
        });
    };

    await new Promise((resolve) => {
        const tick = () => {
            sampleCpu();
            sampleMemory();
            sampleSystem();

            if (
                idx >= tasks.length &&
                retryQueue.length === 0 &&
                running === 0
            ) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (idx >= tasks.length && retryQueue.length === 0) return; // draining

            // Admit one per tick when the gates allow; running === 0 always admits.
            const decision = evaluateAdmission({
                running,
                concurrencyCap: adaptiveCap,
                cpuUtil,
                targetLoad,
                occupiedGb,
                avgPerTestGb,
                memBoundGb,
                availGb,
                memFloorGb
            });

            if (decision.admit) {
                if (idx < tasks.length) {
                    idx++;
                    launch(tasks[idx - 1], idx);
                } else {
                    const retry = retryQueue.shift();
                    launch(retry.task, retry.seq);
                }
            } else {
                const nextSeq =
                    idx < tasks.length ? idx + 1 : retryQueue[0].seq;
                logging.hold({
                    seq: nextSeq,
                    total: tasks.length,
                    reason: decision.reason
                });
            }
        };
        const timer = setInterval(tick, tickMs);
        tick(); // immediate first admission
    });

    const avgCpu = cpuSamples.length
        ? cpuSamples.reduce((s, v) => s + v, 0) / cpuSamples.length
        : 0;

    return {
        failed,
        completed,
        sumDurationMs,
        peakCpu,
        avgCpu,
        peakOccupiedGb,
        avgPerTestGb,
        peakAdaptiveCap
    };
}

module.exports = {
    resolveThreadModes,
    cpuTimes,
    rssGbForPids,
    getStarvationDisposition,
    runScheduler
};
