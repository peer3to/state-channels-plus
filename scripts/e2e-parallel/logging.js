/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { DEFAULT_LOG_DIR } = require("./constants");

function formatDurationMs(durationMs) {
    return `${(durationMs / 1000).toFixed(2)}s`;
}

const COLORS = {
    blue: "\x1b[34m",
    orange: "\x1b[38;5;208m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    purple: "\x1b[35m",
    reset: "\x1b[0m"
};

function colorize(color, text) {
    return `${COLORS[color] || ""}${text}${COLORS.reset}`;
}

// Out-of-memory signatures. Worker threads carry a heap cap (resourceLimits),
// so each blown cap prints the worker line once; a main/process heap OOM prints
// a single FATAL line. countOomEvents tallies both so the summary can flag the
// tests whose process/threads hit the cap.
const OOM_WORKER_RE = /Worker terminated due to reaching memory limit/g;
const OOM_PROCESS_RE =
    /FATAL ERROR:[^\n]*JavaScript heap out of memory|Reached heap limit Allocation failed/;

function countOomEvents(text) {
    if (!text) return 0;
    const workerHits = (text.match(OOM_WORKER_RE) || []).length;
    const processHit = OOM_PROCESS_RE.test(text) ? 1 : 0;
    return workerHits + processHit;
}

// Event-loop starvation lines (the harness sets a 1s threshold). Counted for
// every test, pass or fail, so passing-but-starved tests are still surfaced.
const STARVATION_RE =
    /Event loop delay [\d.]+ms exceeded configured threshold/g;

function countStarvation(text) {
    if (!text) return 0;
    return (text.match(STARVATION_RE) || []).length;
}

// Per-setup timing markers the harness writes to stdout. Summed across all
// setup calls in a test process. `found` is false when none were emitted (e.g.
// the test crashed before setup completed).
const TIMING_RE = /##E2E_TIMING##\s*(\{[^\n}]*\})/g;

function parseTimings(text) {
    let startupMs = 0;
    let deployMs = 0;
    let workerBootMs = 0;
    // Peak event-loop delay per thread role (main + the peers' sdk/vm workers).
    const el = { main: 0, sdk: 0, vm: 0 };
    let found = false;
    if (text) {
        let m;
        while ((m = TIMING_RE.exec(text)) !== null) {
            try {
                const o = JSON.parse(m[1]);
                if (Number.isFinite(o.startupMs)) startupMs += o.startupMs;
                if (Number.isFinite(o.deployMs)) deployMs += o.deployMs;
                if (Number.isFinite(o.workerBootMs))
                    workerBootMs += o.workerBootMs;
                // Event-loop delay is a peak; keep the max per thread role.
                if (Number.isFinite(o.maxEventLoopDelayMs)) {
                    const role = o.elThread || "main";
                    if (role in el)
                        el[role] = Math.max(el[role], o.maxEventLoopDelayMs);
                }
                // worker/eventloop-only markers don't count as the setup timing.
                if (Number.isFinite(o.startupMs) || Number.isFinite(o.deployMs))
                    found = true;
            } catch {
                // Malformed marker — ignore.
            }
        }
    }
    const maxEventLoopDelayMs = Math.max(el.main, el.sdk, el.vm);
    return {
        startupMs,
        deployMs,
        workerBootMs,
        el,
        maxEventLoopDelayMs,
        found
    };
}

function safeEmptyDir(dirPath, allowLogdirPurge) {
    const resolved = path.resolve(dirPath);
    const expected = path.resolve(DEFAULT_LOG_DIR);

    // Safety: only auto-purge the default ./logs directory unless explicitly allowed.
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping purge of ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    fs.mkdirSync(resolved, { recursive: true });
    for (const entry of fs.readdirSync(resolved)) {
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

function cleanupNonErrorLogs(logDir, allowLogdirPurge) {
    const resolved = path.resolve(logDir);
    const expected = path.resolve(DEFAULT_LOG_DIR);
    const canAutoPurge = resolved === expected;
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping end-of-run cleanup in ${resolved}. Set ALLOW_LOGDIR_PURGE=1 to allow.`
        );
        return;
    }

    if (!fs.existsSync(resolved)) return;
    for (const entry of fs.readdirSync(resolved)) {
        if (entry.startsWith("error_")) continue;
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Run output (all the structured/colored console output lives here)
// ---------------------------------------------------------------------------

function runHeader({
    taskCount,
    grep,
    slotCount,
    threadModes,
    targetLoad,
    memBoundGb,
    concurrencyCap
}) {
    console.log(
        `Running ${taskCount} E2E task(s)${grep ? ` matching --grep ${JSON.stringify(grep)}` : ""}`
    );
    console.log(
        `  slots=${slotCount} vmThread=${threadModes.vmThread} sdkThread=${threadModes.sdkThread} targetLoad/core=${targetLoad} memBound=${memBoundGb.toFixed(1)}GB concurrencyCap=${concurrencyCap}`
    );
}

function dryRun({
    taskCount,
    slotCount,
    threadModes,
    targetLoad,
    memBoundGb,
    totalGb,
    concurrencyCap,
    tickMs
}) {
    console.log(`\nDry-run (${taskCount} task(s)):`);
    console.log(`  slots            : ${slotCount}`);
    console.log(`  vmThread         : ${threadModes.vmThread}`);
    console.log(`  sdkThread        : ${threadModes.sdkThread}`);
    console.log(`  targetLoad/core  : ${targetLoad}`);
    console.log(
        `  memBound         : ${memBoundGb.toFixed(1)}GB of ${totalGb.toFixed(1)}GB (${((memBoundGb / totalGb) * 100).toFixed(0)}%)`
    );
    console.log(`  concurrencyCap   : ${concurrencyCap}`);
    console.log(`  scheduler        : one admission per ${tickMs}ms tick`);
}

// Blue: a test is being admitted/launched.
function admission({
    seq,
    total,
    where,
    running,
    concurrencyCap,
    acct,
    cpuUtil,
    targetLoad,
    occupiedGb,
    memBoundGb
}) {
    const cpuStr = `${(cpuUtil * 100).toFixed(0)}%<${(targetLoad * 100).toFixed(0)}%`;
    const memStr = `${occupiedGb.toFixed(1)}/${memBoundGb.toFixed(1)}GB`;
    console.log(
        colorize(
            "blue",
            `[${seq}/${total}] ${where} · running ${running}/${concurrencyCap} · acct ${acct} · cpu ${cpuStr} · mem ${memStr}`
        )
    );
}

// Orange: scheduler declined to admit this tick.
function hold({ seq, total, reason }) {
    console.log(colorize("orange", `[${seq}/${total}] holding — ${reason}`));
}

// Green PASS / red FAIL, with timing + starvation annotations.
function result({
    completed,
    total,
    code,
    label,
    durationMs,
    oomCount,
    starveCount,
    timing
}) {
    const tag = `[${completed}/${total}]`;
    const duration = formatDurationMs(durationMs);
    const timingStr = timing.found
        ? ` · startup ${formatDurationMs(timing.startupMs)} · deploy ${formatDurationMs(timing.deployMs)}`
        : " · timing n/a";
    const elMaxStr = timing.maxEventLoopDelayMs
        ? ` · elMax harness/main:${timing.el.main}ms [peer:{sdk:${timing.el.sdk}ms,vm:${timing.el.vm}ms}]`
        : "";
    const starveStr = starveCount > 0 ? ` · starved x${starveCount}` : "";
    if (code === 0) {
        console.log(
            colorize(
                "green",
                `${tag} PASS (${duration})${timingStr}${elMaxStr}${starveStr}`
            )
        );
    } else {
        // A failure caused purely by event-loop starvation is yellow (likely
        // load-induced/flaky), not red (a real bug).
        const starvedFail = oomCount === 0 && starveCount > 0;
        const reason =
            oomCount > 0
                ? `OOM x${oomCount}`
                : starvedFail
                  ? "starved"
                  : `exit ${code}`;
        console.log(
            colorize(
                starvedFail ? "yellow" : "red",
                `${tag} FAIL [${reason}] [${label}]${timingStr}${elMaxStr}${starveStr}`
            )
        );
    }
}

// Purple: a slot node mined a block that beat its prior gas peak.
function gasPeakLine(slotId, { used, limit, pct, block }) {
    console.log(
        colorize(
            "purple",
            `slot ${slotId} · block #${block} gas ${used.toLocaleString()}/${limit.toLocaleString()} (${pct.toFixed(1)}%) ↑ new peak`
        )
    );
}

function summary({
    tasks,
    failed,
    wallMs,
    sumDurationMs,
    peakCpu,
    avgCpu,
    peakOccupiedGb,
    avgPerTestGb,
    memBoundGb,
    targetLoad,
    gasPeak
}) {
    const totalFailing = failed.length;
    const totalPassing = tasks.length - totalFailing;
    const speedup = wallMs > 0 ? sumDurationMs / wallMs : 0;
    const oomTasks = tasks.filter((t) => (t.oomCount || 0) > 0);
    const starvedTasks = tasks.filter((t) => (t.starveCount || 0) > 0);
    const totalStartupMs = tasks.reduce((s, t) => s + (t.startupMs || 0), 0);
    const totalDeployMs = tasks.reduce((s, t) => s + (t.deployMs || 0), 0);
    const totalWorkerBootMs = tasks.reduce(
        (s, t) => s + (t.workerBootMs || 0),
        0
    );

    console.log("\n");
    if (totalPassing > 0) {
        console.log(
            colorize(
                "green",
                `  ${totalPassing} passing (wall ${formatDurationMs(wallMs)})`
            )
        );
    }
    if (totalFailing > 0) {
        console.log(colorize("red", `  ${totalFailing} failing`));
    }
    if (oomTasks.length > 0) {
        const totalOom = oomTasks.reduce((s, t) => s + t.oomCount, 0);
        console.log(
            colorize(
                "yellow",
                `  ${oomTasks.length} test(s) hit the memory cap (${totalOom} process/thread OOM(s) total):`
            )
        );
        for (const t of oomTasks) {
            console.log(`    - ${t.label}: ${t.oomCount} OOM`);
        }
        console.log(
            `  Raise SCP_WORKER_MAX_OLD_SPACE_MB / NODE_OPTIONS=--max-old-space-size, lower --slots, or lower --target-load.`
        );
    }
    if (starvedTasks.length > 0) {
        const totalStarve = starvedTasks.reduce((s, t) => s + t.starveCount, 0);
        console.log(
            colorize(
                "yellow",
                `  ${starvedTasks.length} test(s) hit event-loop starvation (>1s, ${totalStarve} event(s) total):`
            )
        );
        for (const t of starvedTasks) {
            console.log(`    - ${t.label}: starved x${t.starveCount}`);
        }
    }
    console.log(
        `  wall ${formatDurationMs(wallMs)} · sum ${formatDurationMs(sumDurationMs)} · ${speedup.toFixed(1)}x speedup`
    );
    console.log(
        `  startup sum ${formatDurationMs(totalStartupMs)} (worker-boot ${formatDurationMs(totalWorkerBootMs)}) · deploy sum ${formatDurationMs(totalDeployMs)}`
    );
    console.log(
        `  mem: peak owned ${peakOccupiedGb.toFixed(1)}GB, avg/process ${avgPerTestGb.toFixed(2)}GB (bound ${memBoundGb.toFixed(1)}GB)`
    );
    console.log(
        `  cpu: avg ${(avgCpu * 100).toFixed(0)}% · peak ${(peakCpu * 100).toFixed(0)}% (target ${(targetLoad * 100).toFixed(0)}%)`
    );
    const elPeak = tasks.reduce(
        (best, t) =>
            (t.maxEventLoopDelayMs || 0) > (best?.maxEventLoopDelayMs || 0)
                ? t
                : best,
        null
    );
    if (elPeak && elPeak.maxEventLoopDelayMs) {
        const e = elPeak.el || {};
        const role =
            elPeak.maxEventLoopDelayMs === e.sdk
                ? "peer/sdk"
                : elPeak.maxEventLoopDelayMs === e.vm
                  ? "peer/vm"
                  : "harness/main";
        console.log(
            `  event-loop delay: peak ${elPeak.maxEventLoopDelayMs}ms on ${role} (${elPeak.label})`
        );
    }
    if (gasPeak.size > 0) {
        console.log(colorize("purple", `  peak block gas per slot:`));
        for (const [id, g] of [...gasPeak.entries()].sort(
            (a, b) => a[0] - b[0]
        )) {
            console.log(
                colorize(
                    "purple",
                    `    - slot ${id}: ${g.used.toLocaleString()}/${g.limit.toLocaleString()} (${g.pct.toFixed(1)}%) @ block #${g.block}`
                )
            );
        }
    }
}

function getLogPath(logDir, logName) {
    return path.resolve(path.join(logDir, `${logName}.ansi`));
}

function markLogAsError(logDir, logName) {
    const src = getLogPath(logDir, logName);
    const dst = path.resolve(path.join(logDir, `error_${logName}.ansi`));
    if (!fs.existsSync(src)) return;
    try {
        fs.renameSync(src, dst);
    } catch (err) {
        console.error(`Failed to rename log file ${src} -> ${dst}:`, err);
    }
}

module.exports = {
    formatDurationMs,
    colorize,
    countOomEvents,
    countStarvation,
    parseTimings,
    safeEmptyDir,
    cleanupNonErrorLogs,
    getLogPath,
    markLogAsError,
    runHeader,
    dryRun,
    admission,
    hold,
    result,
    gasPeakLine,
    summary
};
