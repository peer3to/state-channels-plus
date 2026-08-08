/* eslint-disable no-console */
const crypto = require("crypto");
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
    lightGreen: "\x1b[92m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    darkYellow: "\x1b[33m",
    lightYellow: "\x1b[93m",
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

// A watchdog error is often propagated through several peers and the harness,
// which repeats the exact message in the combined log. Treat one distinct
// delay/threshold pair as one starvation event rather than counting each copy.
const STARVATION_RE =
    /Event loop delay ([\d.]+)ms exceeded configured threshold ([\d.]+)ms/g;

function parseStarvation(text) {
    const events = new Map();
    if (text) {
        for (const match of text.matchAll(STARVATION_RE)) {
            const delayMs = Number(match[1]);
            const thresholdMs = Number(match[2]);
            if (!Number.isFinite(delayMs) || !Number.isFinite(thresholdMs))
                continue;
            events.set(`${delayMs}:${thresholdMs}`, {
                delayMs,
                thresholdMs
            });
        }
    }
    return {
        count: events.size,
        maxDelayMs: Math.max(
            0,
            ...[...events.values()].map((event) => event.delayMs)
        )
    };
}

function countStarvation(text) {
    return parseStarvation(text).count;
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
    const el = { main: 0, sdk: 0, vm: 0, watchdog: 0 };
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
        // The fatal watchdog error may be serialized without its preceding
        // timing marker. Keep its real delay in the peak without guessing
        // which thread produced it.
        el.watchdog = Math.round(parseStarvation(text).maxDelayMs);
    }
    const maxEventLoopDelayMs = Math.max(el.main, el.sdk, el.vm, el.watchdog);
    return {
        startupMs,
        deployMs,
        workerBootMs,
        el,
        maxEventLoopDelayMs,
        found
    };
}

// Resolve, following symlinks where the path (or its nearest ancestor) exists,
// so a symlinked ./logs is compared by its real target on both sides.
function realpathOrResolve(p) {
    const resolved = path.resolve(p);
    try {
        return fs.realpathSync(resolved);
    } catch {
        return resolved;
    }
}

// Never auto-purge (nor purge with the flag) the CWD/repo root or the fs root -
// a mis-resolved log dir must not wipe the working tree. Checks BOTH the lexical
// resolved path AND its real (symlink-followed) target, since fs.rmSync operates
// through symlinks: `--logDir ./logs` where `./logs` links to the repo root
// resolves lexically to `<repo>/logs` but really targets `<repo>`.
function isDangerousPurgeTarget(resolved) {
    const cwd = process.cwd();
    const cwdReal = realpathOrResolve(cwd);
    for (const p of [resolved, realpathOrResolve(resolved)]) {
        if (p === cwd || p === cwdReal || p === path.parse(p).root) return true;
    }
    return false;
}

// The default ./logs dir and anything under it (run-N dirs) are safe to
// purge/clean without the explicit allow flag. Compare real paths so a
// symlinked ./logs can't smuggle a purge of its target past the gate; and if
// the default log dir itself resolves somewhere dangerous (e.g. a symlink to the
// repo root), nothing is "safely within" it.
function isWithinDefaultLogDir(resolved) {
    const expected = realpathOrResolve(DEFAULT_LOG_DIR);
    if (isDangerousPurgeTarget(expected)) return false;
    const real = realpathOrResolve(resolved);
    return real === expected || real.startsWith(expected + path.sep);
}

/**
 * Allocate the next run-N directory under baseDir. Runs accumulate
 * (./logs/run-0, ./logs/run-1, ...) so error logs from earlier runs
 * survive for cross-run comparison.
 */
function nextRunDir(baseDir) {
    const base = path.resolve(baseDir);
    // Refuse BEFORE any mkdir/readdir: run allocation must not write through a
    // symlinked base whose real target is the repo root / fs root (e.g. a
    // `./logs -> .` symlink would otherwise scatter run-N dirs at the repo root
    // before the later purge guard even runs).
    if (isDangerousPurgeTarget(base)) {
        throw new Error(
            `Refusing to allocate run dirs under ${base}: it resolves to the repo root / fs root.`
        );
    }
    fs.mkdirSync(base, { recursive: true });

    let next = 0;
    for (const entry of fs.readdirSync(base)) {
        const match = /^run-(\d+)$/.exec(entry);
        if (match) next = Math.max(next, Number(match[1]) + 1);
    }
    // mkdir non-recursive so a concurrent run can't silently share a dir.
    for (;;) {
        const dir = path.join(base, `run-${next}`);
        try {
            fs.mkdirSync(dir);
            return dir;
        } catch (err) {
            if (err.code !== "EEXIST") throw err;
            next++;
        }
    }
}

function safeEmptyDir(dirPath, allowLogdirPurge) {
    const resolved = path.resolve(dirPath);

    // Never purge the repo root / fs root, even with the flag.
    if (isDangerousPurgeTarget(resolved)) {
        console.warn(`Refusing to purge ${resolved} (repo root / fs root).`);
        return;
    }

    // Safety: only auto-purge dirs under the default ./logs unless explicitly allowed.
    const canAutoPurge = isWithinDefaultLogDir(resolved);
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping purge of ${resolved}. Pass --allow-logdir-purge to allow.`
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

    if (isDangerousPurgeTarget(resolved)) {
        console.warn(`Refusing to clean ${resolved} (repo root / fs root).`);
        return;
    }

    const canAutoPurge = isWithinDefaultLogDir(resolved);
    const allowUnsafe = allowLogdirPurge === true;

    if (!canAutoPurge && !allowUnsafe) {
        console.warn(
            `Skipping end-of-run cleanup in ${resolved}. Pass --allow-logdir-purge to allow.`
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
    e2eOnly,
    slotCount,
    threadModes,
    targetLoad,
    tickMs,
    memBoundGb,
    concurrencyCap
}) {
    console.log(
        `Running ${taskCount} ${e2eOnly ? "E2E" : "Mocha"} task(s)${grep ? ` matching --grep ${JSON.stringify(grep)}` : ""}`
    );
    console.log(
        `  slots=${slotCount} vmThread=${threadModes.vmThread} sdkThread=${threadModes.sdkThread} targetLoad/core=${targetLoad} schedulerTickMs=${tickMs} memBound=${memBoundGb.toFixed(1)}GB concurrencyCap=${concurrencyCap}`
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
    memBoundGb,
    worker,
    buffered
}) {
    const cpuStr = `${(cpuUtil * 100).toFixed(0)}%<${(targetLoad * 100).toFixed(0)}%`;
    const memStr = `${occupiedGb.toFixed(1)}/${memBoundGb.toFixed(1)}GB`;
    console.log(
        colorize(
            "blue",
            `[${seq}/${total}]${worker ? ` ${worker} ·` : ""} ${where} · running ${running}/${concurrencyCap}${buffered === undefined ? "" : ` · buffer ${buffered}`} · acct ${acct} · cpu ${cpuStr} · mem ${memStr}`
        )
    );
}

// Orange: scheduler declined to admit this tick.
function hold({ seq, total, reason, buffered }) {
    console.log(
        colorize(
            "orange",
            `[${seq}/${total}] holding — ${reason}${buffered === undefined ? "" : ` · buffer ${buffered}`}`
        )
    );
}

// Light yellow: a starved task gets its single clean retry.
function starvationRetry({ seq, total, label, starveCount }) {
    console.log(
        colorize(
            "lightYellow",
            `[${seq}/${total}] STARVED x${starveCount} — rescheduling once [${label}]`
        )
    );
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
    timing,
    repeatedStarvation = false,
    worker
}) {
    const tag = `[${completed}/${total}]${worker ? ` ${worker} ·` : ""}`;
    const duration = formatDurationMs(durationMs);
    const timingStr = timing.found
        ? ` · startup ${formatDurationMs(timing.startupMs)} · deploy ${formatDurationMs(timing.deployMs)}`
        : " · timing n/a";
    const elMaxStr = timing.maxEventLoopDelayMs
        ? ` · elMax harness/main:${timing.el.main}ms [peer:{sdk:${timing.el.sdk}ms,vm:${timing.el.vm}ms},watchdog:${timing.el.watchdog}ms]`
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
                : repeatedStarvation
                  ? "starved twice"
                  : starvedFail
                    ? "starved"
                    : `exit ${code}`;
        console.log(
            colorize(
                repeatedStarvation
                    ? "darkYellow"
                    : starvedFail
                      ? "yellow"
                      : "red",
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

function getStarvationSummary(tasks) {
    return {
        recovered: tasks.filter((task) => task.starvationRetrySucceeded),
        repeated: tasks.filter((task) => task.repeatedStarvation)
    };
}

function summaryCounts(total, failed, completed = total) {
    const boundedCompleted = Math.max(0, Math.min(total, completed));
    const boundedFailed = Math.max(0, Math.min(boundedCompleted, failed));
    return {
        passing: boundedCompleted - boundedFailed,
        failing: boundedFailed,
        notRun: total - boundedCompleted
    };
}

function summary({
    tasks,
    failed,
    completed = tasks.length,
    wallMs,
    sumDurationMs,
    peakCpu,
    avgCpu,
    peakOccupiedGb,
    avgPerTestGb,
    memBoundGb,
    targetLoad,
    gasPeak = new Map(),
    workers = []
}) {
    const counts = summaryCounts(tasks.length, failed.length, completed);
    const totalFailing = counts.failing;
    const totalPassing = counts.passing;
    const speedup = wallMs > 0 ? sumDurationMs / wallMs : 0;
    const oomTasks = tasks.filter((t) => (t.oomCount || 0) > 0);
    const starvation = getStarvationSummary(tasks);
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
    if (counts.notRun > 0) {
        console.log(colorize("yellow", `  ${counts.notRun} not run`));
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
    if (starvation.recovered.length > 0) {
        console.log(
            colorize(
                "lightGreen",
                `  ${starvation.recovered.length} test(s) recovered from starvation on their second run`
            )
        );
        for (const task of starvation.recovered) {
            console.log(`    - ${task.label}: starved x${task.starveCount}`);
        }
    }
    if (starvation.repeated.length > 0) {
        const totalStarve = starvation.repeated.reduce(
            (sum, task) => sum + task.starveCount,
            0
        );
        console.log(
            colorize(
                "yellow",
                `  ${starvation.repeated.length} test(s) hit event-loop starvation on both runs (>1s, ${totalStarve} event(s) total):`
            )
        );
        for (const t of starvation.repeated) {
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
        `  cpu: avg ${(avgCpu * 100).toFixed(0)}% · peak ${(peakCpu * 100).toFixed(0)}%${targetLoad === undefined ? "" : ` (target ${(targetLoad * 100).toFixed(0)}%)`}`
    );
    for (const worker of workers) console.log(`  worker: ${worker}`);
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
            elPeak.maxEventLoopDelayMs === e.watchdog
                ? "watchdog/unattributed"
                : elPeak.maxEventLoopDelayMs === e.sdk
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

function boundedLogFileName(logName, prefix = "", suffix = "") {
    const extension = ".ansi";
    const fileName = `${prefix}${logName}${suffix}${extension}`;
    if (Buffer.byteLength(fileName) <= 255) return fileName;
    const hash = crypto
        .createHash("sha256")
        .update(logName)
        .digest("hex")
        .slice(0, 8);
    const decorationBytes = Buffer.byteLength(
        `${prefix}_${hash}${suffix}${extension}`
    );
    const availableBytes = 255 - decorationBytes;
    if (availableBytes < 1) {
        throw new Error("Log filename decorations exceed the filesystem limit");
    }
    const boundedName = Buffer.from(logName)
        .subarray(0, availableBytes)
        .toString("utf8")
        .replace(/[^\x00-\x7F]+$/u, "");
    return `${prefix}${boundedName}_${hash}${suffix}${extension}`;
}

function getDecoratedLogPath(logDir, logName, prefix = "", suffix = "") {
    return path.resolve(
        path.join(logDir, boundedLogFileName(logName, prefix, suffix))
    );
}

function getLogPath(logDir, logName) {
    return getDecoratedLogPath(logDir, logName);
}

function getAttemptLogPath(logDir, logName, attemptId) {
    return getDecoratedLogPath(logDir, logName, "", `.attempt-${attemptId}`);
}

function getErrorLogPath(logDir, logName) {
    return getDecoratedLogPath(logDir, logName, "error_");
}

function markLogAsError(logDir, logName) {
    const src = getLogPath(logDir, logName);
    const dst = getErrorLogPath(logDir, logName);
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
    // Exported for unit tests of the destructive-tooling guards.
    isDangerousPurgeTarget,
    isWithinDefaultLogDir,
    safeEmptyDir,
    cleanupNonErrorLogs,
    nextRunDir,
    boundedLogFileName,
    getLogPath,
    getAttemptLogPath,
    getErrorLogPath,
    markLogAsError,
    runHeader,
    dryRun,
    admission,
    hold,
    starvationRetry,
    result,
    gasPeakLine,
    getStarvationSummary,
    summaryCounts,
    summary
};
