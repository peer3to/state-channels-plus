/* eslint-disable no-console */
const { execFileSync } = require("child_process");
const os = require("os");
const {
    HARDHAT_CLI,
    SCHEDULER_TICK_MS,
    MAX_SLOTS_FROM_POOL,
    PER_TEST_MEM_GB
} = require("./constants");
const { liveTaskChildren, runTask } = require("./runTask");
const logging = require("./logging");

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
    targetLoad,
    memBoundGb,
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

    const launch = (task, seq) => {
        running++;
        const acct = freeAccounts.shift();
        const slot =
            task.isE2E && slotCount > 0 ? slots[(seq - 1) % slotCount] : null;
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
            sumDurationMs += durationMs;

            const combined = stdout + stderr;
            task.oomCount = logging.countOomEvents(combined);
            task.starveCount = logging.countStarvation(combined);
            const timing = logging.parseTimings(combined);
            task.startupMs = timing.startupMs;
            task.deployMs = timing.deployMs;
            task.workerBootMs = timing.workerBootMs;
            task.maxEventLoopDelayMs = timing.maxEventLoopDelayMs;
            task.el = timing.el;
            task.timingFound = timing.found;

            completed++;
            if (code !== 0) {
                failed.push(task);
                logging.markLogAsError(logDir, task.logName);
            }
            logging.result({
                completed,
                total: tasks.length,
                code,
                label,
                durationMs,
                oomCount: task.oomCount,
                starveCount: task.starveCount,
                timing
            });
        });
    };

    await new Promise((resolve) => {
        const tick = () => {
            sampleCpu();
            sampleMemory();

            if (idx >= tasks.length && running === 0) {
                clearInterval(timer);
                resolve();
                return;
            }
            if (idx >= tasks.length) return; // draining

            const countOk = running < concurrencyCap;
            const cpuOk = cpuUtil < targetLoad;
            const memOk = occupiedGb + avgPerTestGb < memBoundGb;

            // Always keep one test in flight (avoids stalling when the gates start
            // closed); otherwise admit one only when all gates are open.
            if (running === 0 || (countOk && cpuOk && memOk)) {
                idx++;
                launch(tasks[idx - 1], idx);
            } else {
                const reason = !countOk
                    ? `cap (running ${running}/${concurrencyCap})`
                    : !memOk
                      ? `memory (owned ${occupiedGb.toFixed(1)}+${avgPerTestGb.toFixed(1)}≥${memBoundGb.toFixed(1)}GB)`
                      : `cpu ${(cpuUtil * 100).toFixed(0)}%>=${(targetLoad * 100).toFixed(0)}%`;
                logging.hold({ seq: idx + 1, total: tasks.length, reason });
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
        avgPerTestGb
    };
}

module.exports = { resolveThreadModes, cpuTimes, rssGbForPids, runScheduler };
