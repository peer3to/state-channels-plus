/* eslint-disable no-console */
// Host probes and scheduling policy: available memory, core-scaled concurrency,
// slot picking, per-tick admission.
const fs = require("fs");
const os = require("os");
const {
    ADAPTIVE_MIN_CAP,
    HEALTHY_EL_DELAY_MS,
    GROW_AFTER_HEALTHY
} = require("./constants");

const GIB = 1024 ** 3;

// OS-available memory in GiB, counting every process on the box, not just ours.
// Linux: MemAvailable (free + reclaimable cache). Elsewhere: os.freemem().
function availableMemGb() {
    if (process.platform === "linux") {
        try {
            const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
            const m = meminfo.match(/^MemAvailable:\s+(\d+)\s*kB/m);
            if (m) return Number(m[1]) / 1024 / 1024;
        } catch {
            // fall through to os.freemem()
        }
    }
    return os.freemem() / GIB;
}

// Next ceiling to probe: double while nothing has starved yet, then bisect between
// the highest healthy level and the lowest starved one. Adjacent bounds mean the
// limit is known, so the ceiling stops moving.
function probeTarget(goodCap, badCap, maxCap) {
    if (!Number.isFinite(badCap)) return Math.min(maxCap, goodCap * 2);
    if (goodCap + 1 >= badCap) return goodCap;
    return Math.min(maxCap, Math.floor((goodCap + badCap) / 2));
}

// Next concurrency ceiling from one finished test. A starved test lowers the bad
// bound immediately; a level is only promoted to good after GROW_AFTER_HEALTHY
// healthy finishes, so it backs off fast and climbs deliberately. Tests with no
// timing markers carry no signal and change nothing.
function nextAdaptiveCap({
    current,
    starved,
    elDelayMs,
    hasTiming,
    healthyStreak = 0,
    goodCap = ADAPTIVE_MIN_CAP,
    badCap = Infinity,
    healthyElMs = HEALTHY_EL_DELAY_MS,
    growAfter = GROW_AFTER_HEALTHY,
    minCap = ADAPTIVE_MIN_CAP,
    maxCap
}) {
    if (starved) {
        const bad = Math.min(badCap, current);
        const good = Math.max(minCap, Math.min(goodCap, bad - 1));
        return {
            cap: Math.max(minCap, probeTarget(good, bad, maxCap)),
            healthyStreak: 0,
            goodCap: good,
            badCap: bad
        };
    }
    if (!hasTiming || elDelayMs > healthyElMs) {
        return { cap: current, healthyStreak, goodCap, badCap };
    }

    const streak = healthyStreak + 1;
    if (streak < growAfter) {
        return { cap: current, healthyStreak: streak, goodCap, badCap };
    }
    const good = Math.max(goodCap, current);
    return {
        cap: Math.max(minCap, probeTarget(good, badCap, maxCap)),
        healthyStreak: 0,
        goodCap: good,
        badCap
    };
}

// Idle slot if there is one, else the least loaded. Never blocks: slots are a
// timing-isolation pool, not a concurrency limit.
function pickLeastLoadedSlot(slotLoad) {
    let best = 0;
    for (let i = 1; i < slotLoad.length; i++) {
        if (slotLoad[i] < slotLoad[best]) best = i;
    }
    return best;
}

// Admission decision for one tick. running === 0 always admits so the suite
// never stalls.
function evaluateAdmission({
    running,
    concurrencyCap,
    cpuUtil,
    targetLoad,
    occupiedGb,
    avgPerTestGb,
    memBoundGb,
    availGb,
    memFloorGb
}) {
    const countOk = running < concurrencyCap;
    const cpuOk = cpuUtil < targetLoad;
    const memOwnedOk = occupiedGb + avgPerTestGb < memBoundGb;
    const memSysOk = availGb - avgPerTestGb >= memFloorGb;

    const admit = running === 0 || (countOk && cpuOk && memOwnedOk && memSysOk);

    let reason = null;
    if (!admit) {
        reason = !countOk
            ? `cap (running ${running}/${concurrencyCap})`
            : !memSysOk
              ? `system memory (avail ${availGb.toFixed(1)}−${avgPerTestGb.toFixed(1)}<${memFloorGb.toFixed(1)}GB free)`
              : !memOwnedOk
                ? `memory (owned ${occupiedGb.toFixed(1)}+${avgPerTestGb.toFixed(1)}≥${memBoundGb.toFixed(1)}GB)`
                : `cpu ${(cpuUtil * 100).toFixed(0)}%>=${(targetLoad * 100).toFixed(0)}%`;
    }
    return { admit, reason };
}

module.exports = {
    availableMemGb,
    nextAdaptiveCap,
    pickLeastLoadedSlot,
    evaluateAdmission
};
