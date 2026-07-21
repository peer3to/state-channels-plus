/* eslint-disable no-console */
// Host probes and scheduling policy: available memory, core-scaled concurrency,
// slot picking, per-tick admission.
const fs = require("fs");
const os = require("os");
const { HW_THREADS_PER_TEST } = require("./constants");

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

// Concurrent-test cap from core count: ~HW_THREADS_PER_TEST threads per test,
// clamped to [2, maxCap]. The load and memory gates throttle below this.
function resolveDefaultWorkers(cores, maxCap) {
    const c = Number.isFinite(cores) && cores > 0 ? cores : 2;
    const byCores = Math.floor(c / HW_THREADS_PER_TEST);
    return Math.max(2, Math.min(maxCap, byCores));
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
    resolveDefaultWorkers,
    pickLeastLoadedSlot,
    evaluateAdmission
};
