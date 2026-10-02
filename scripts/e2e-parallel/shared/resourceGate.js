const { execFile } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { promisify } = require("util");
const {
    PER_TEST_MEM_GB,
    PROC_CLOCK_TICKS_PER_SECOND,
    COST_CPU_BUDGET,
    COST_CPU_VALVE
} = require("./constants");
const { cpuDelta, osTimes, readCpuSnapshot } = require("./cpuAccounting");
const { costBudgetShortfall } = require("./scheduling");

const execFileAsync = promisify(execFile);
let warnedAboutPs = false;
// lean: one process-wide scan meter; per-gate meters if a process ever hosts several workers
const processScans = { count: 0, ms: 0 };

function cpuTimes() {
    return osTimes();
}

function systemOccupiedGb() {
    return (os.totalmem() - os.freemem()) / 1024 ** 3;
}

async function rssByPid(pids, options = {}) {
    const unique = [...new Set(pids.filter(Boolean))];
    if (!unique.length) return new Map();
    try {
        const run = options.execFile || execFileAsync;
        const result = await run("ps", [
            "-o",
            "pid=,rss=",
            "-p",
            unique.join(",")
        ]);
        const output = typeof result === "string" ? result : result.stdout;
        return new Map(
            output
                .split("\n")
                .map((line) => line.trim().split(/\s+/).map(Number))
                .filter(
                    ([pid, rss]) =>
                        Number.isInteger(pid) && Number.isFinite(rss)
                )
                .map(([pid, rss]) => [pid, rss / 1024 / 1024])
        );
    } catch (error) {
        if (!warnedAboutPs) {
            warnedAboutPs = true;
            (options.warn || console.warn)(
                `Unable to sample process RSS with ps; using system memory: ${error.message}`
            );
        }
        return null;
    }
}

async function readProcProcesses({ procRoot = "/proc" } = {}) {
    const processes = [];
    for (const name of await fs.promises.readdir(procRoot)) {
        if (!/^\d+$/.test(name)) continue;
        try {
            const stat = await fs.promises.readFile(
                path.join(procRoot, name, "stat"),
                "utf8"
            );
            const status = await fs.promises.readFile(
                path.join(procRoot, name, "status"),
                "utf8"
            );
            const fields = stat
                .slice(stat.lastIndexOf(")") + 2)
                .trim()
                .split(/\s+/);
            const ppid = Number(fields[1]);
            const cpuSeconds =
                (Number(fields[11]) + Number(fields[12])) /
                PROC_CLOCK_TICKS_PER_SECOND;
            const start = Number(fields[19]);
            // Kernel threads, zombies and exiting processes have no VmRSS:
            // they hold no user memory, so they count as zero.
            const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
            if (
                stat.lastIndexOf(")") < 0 ||
                !Number.isInteger(ppid) ||
                ppid < 0 ||
                !Number.isFinite(cpuSeconds) ||
                cpuSeconds < 0 ||
                !Number.isFinite(start) ||
                start < 0
            ) {
                throw new Error(`Invalid process data for ${name}`);
            }
            processes.push({
                pid: Number(name),
                ppid,
                identity: `${name}:${start}`,
                rssGb: rss ? Number(rss[1]) / 1024 / 1024 : 0,
                cpuSeconds
            });
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    return processes;
}

function psCpuSeconds(text) {
    const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(
        text || ""
    );
    if (!match) throw new Error("Invalid ps CPU time");
    return (
        Number(match[1] || 0) * 86400 +
        Number(match[2] || 0) * 3600 +
        Number(match[3]) * 60 +
        Number(match[4])
    );
}

async function readPsProcesses(options) {
    const run = options.execFile || execFileAsync;
    const result = await run("ps", ["-axo", "pid=,ppid=,rss=,time=,lstart="]);
    const output = typeof result === "string" ? result : result.stdout;
    if (!output.trim()) throw new Error("Empty process table");
    return output
        .trim()
        .split("\n")
        .map((line) => {
            const [pidText, ppidText, rssText, time, ...start] = line
                .trim()
                .split(/\s+/);
            const [pid, ppid, rss] = [pidText, ppidText, rssText].map(Number);
            if (
                !Number.isInteger(pid) ||
                !Number.isInteger(ppid) ||
                !Number.isFinite(rss) ||
                rss < 0
            )
                throw new Error("Invalid ps process data");
            return {
                pid,
                ppid,
                rssGb: rss / 1024 / 1024,
                cpuSeconds: time === undefined ? null : psCpuSeconds(time),
                identity: `${pid}:${start.join(" ")}`
            };
        });
}

async function collectProcessTrees(rootPids, options = {}) {
    const roots = [...new Set(rootPids.filter(Boolean))];
    if (!roots.length) return new Map();
    const platform =
        options.platform ?? (options.execFile ? "ps" : process.platform);
    const scanStartedAt = performance.now();
    try {
        const processes =
            platform === "linux"
                ? await readProcProcesses(options)
                : await readPsProcesses(options);
        processScans.count++;
        processScans.ms += performance.now() - scanStartedAt;
        const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
        const rootSet = new Set(roots);
        const trees = new Map(roots.map((root) => [root, []]));
        for (const entry of processes) {
            let current = entry.pid;
            const seen = new Set();
            while (!rootSet.has(current) && !seen.has(current)) {
                seen.add(current);
                const parent = byPid.get(current);
                if (!parent) break;
                current = parent.ppid;
            }
            if (rootSet.has(current)) trees.get(current).push(entry);
        }
        return trees;
    } catch (error) {
        if (!warnedAboutPs) {
            warnedAboutPs = true;
            (options.warn || console.warn)(
                `Unable to sample process tree; measurement unavailable: ${error.message}`
            );
        }
        return null;
    }
}

async function rssByProcessTree(pids, options = {}) {
    const trees = await collectProcessTrees(pids, options);
    return (
        trees &&
        new Map(
            [...trees].map(([pid, entries]) => [
                pid,
                entries.reduce((sum, entry) => sum + entry.rssGb, 0)
            ])
        )
    );
}

// lean: per-task process-table scan; batch snapshots if sampler overhead dominates
class TaskProcessSampler {
    constructor(rootPid, options = {}) {
        this.rootPid = rootPid;
        this.options = options;
        this.cpuByIdentity = new Map();
        this.peakRssGb = null;
        this.inFlight = Promise.resolve();
        this.sampling = false;
    }

    // A tick that arrives while a scan is still running is skipped, so a slow
    // process table never builds a backlog that finish() must wait out.
    sample() {
        if (this.sampling) return this.inFlight;
        this.sampling = true;
        this.inFlight = (async () => {
            const trees = await collectProcessTrees(
                [this.rootPid],
                this.options
            );
            const entries = trees?.get(this.rootPid);
            if (
                !entries?.length ||
                entries.some((entry) => entry.cpuSeconds === null)
            )
                return;
            this.peakRssGb = Math.max(
                this.peakRssGb ?? 0,
                entries.reduce((sum, entry) => sum + entry.rssGb, 0)
            );
            for (const entry of entries) {
                this.cpuByIdentity.set(
                    entry.identity,
                    Math.max(
                        this.cpuByIdentity.get(entry.identity) || 0,
                        entry.cpuSeconds
                    )
                );
            }
        })().finally(() => {
            this.sampling = false;
        });
        return this.inFlight;
    }

    result(durationMs) {
        if (this.peakRssGb === null || durationMs <= 0)
            return {
                peakRssGb: null,
                avgCores: null,
                measurementReason: "process-sampling-unavailable"
            };
        const cpuSeconds = [...this.cpuByIdentity.values()].reduce(
            (sum, value) => sum + value,
            0
        );
        const wallSeconds = durationMs / 1000;
        return {
            peakRssGb: this.peakRssGb,
            avgCores: cpuSeconds / wallSeconds,
            measurementReason: null
        };
    }
}

async function rssGbForPids(pids, options = {}) {
    const samples = await rssByPid(pids, options);
    if (!samples) return systemOccupiedGb();
    return [...samples.values()].reduce((sum, value) => sum + value, 0);
}

class ResourceGate {
    constructor({
        testPids,
        infraPids,
        targetLoad,
        memBoundGb,
        sampleOptions
    }) {
        this.testPids = testPids;
        this.infraPids = infraPids;
        this.targetLoad = targetLoad;
        this.memBoundGb = memBoundGb;
        this.sampleOptions = sampleOptions;
        this.lastCpuSnapshot = readCpuSnapshot(sampleOptions);
        this.cpuSource = this.lastCpuSnapshot.source;
        this.cpuCores = this.lastCpuSnapshot.cores;
        // Admission uses the machine's busy share (everything on the box,
        // hypervisor steal included) so a core occupied by anything counts
        // as occupied. What this cgroup itself consumed is kept beside it.
        this.cpuUtil = 0;
        this.peakCpu = 0;
        this.cpuSamples = [];
        this.containerCpuUtil = undefined;
        this.peakContainerCpu = 0;
        this.containerCpuSamples = [];
        this.peakHostSteal = 0;
        // kernel stall accounting: share of the interval with a runnable
        // task waiting for a CPU ("some") and with every task waiting ("full")
        this.cpuPressure = undefined;
        this.peakCpuPressure = 0;
        this.cpuPressureSamples = [];
        this.peakCpuPressureFull = 0;
        // CFS quota throttling of this cgroup; stays zero without a quota
        this.throttledMs = 0;
        this.nrThrottled = 0;
        this.avgPerTestGb = PER_TEST_MEM_GB;
        this.memSampleSum = 0;
        this.memSampleCount = 0;
        this.occupiedGb = 0;
        this.peakOccupiedGb = 0;
        this.holdCounts = { cap: 0, memory: 0, cpu: 0 };
        this.lastHoldReason = null;
    }

    async sample() {
        const snapshot = readCpuSnapshot(this.sampleOptions);
        const delta = cpuDelta(this.lastCpuSnapshot, snapshot);
        this.lastCpuSnapshot = snapshot;
        this.cpuSource = snapshot.source;
        this.cpuCores = snapshot.cores;
        const machineUtil = delta.hostCpuUtil ?? delta.cpuUtil;
        if (machineUtil !== undefined) this.cpuUtil = machineUtil;
        this.peakCpu = Math.max(this.peakCpu, this.cpuUtil);
        this.cpuSamples.push(this.cpuUtil);
        if (snapshot.source === "cgroup" && delta.cpuUtil !== undefined) {
            this.containerCpuUtil = delta.cpuUtil;
            this.peakContainerCpu = Math.max(
                this.peakContainerCpu,
                delta.cpuUtil
            );
            this.containerCpuSamples.push(delta.cpuUtil);
        }
        if (delta.hostSteal !== undefined)
            this.peakHostSteal = Math.max(this.peakHostSteal, delta.hostSteal);
        if (delta.cpuPressure !== undefined) {
            this.cpuPressure = delta.cpuPressure;
            this.peakCpuPressure = Math.max(
                this.peakCpuPressure,
                delta.cpuPressure
            );
            this.cpuPressureSamples.push(delta.cpuPressure);
        }
        if (delta.cpuPressureFull !== undefined)
            this.peakCpuPressureFull = Math.max(
                this.peakCpuPressureFull,
                delta.cpuPressureFull
            );
        if (delta.throttledMs !== undefined) {
            this.throttledMs += Math.max(0, delta.throttledMs);
            this.nrThrottled += Math.max(0, delta.nrThrottled);
        }

        const testPids = this.testPids();
        const infraPids = this.infraPids();
        const samples = await rssByProcessTree(
            [...testPids, ...infraPids],
            this.sampleOptions
        );
        let testGb = 0;
        if (samples) {
            testGb = testPids.reduce(
                (sum, pid) => sum + (samples.get(pid) || 0),
                0
            );
            const infraGb = infraPids.reduce(
                (sum, pid) => sum + (samples.get(pid) || 0),
                0
            );
            this.occupiedGb = testGb + infraGb;
        } else {
            this.occupiedGb = systemOccupiedGb();
        }
        this.peakOccupiedGb = Math.max(this.peakOccupiedGb, this.occupiedGb);
        if (samples && testPids.length) {
            this.memSampleSum += testGb / testPids.length;
            this.memSampleCount++;
            this.avgPerTestGb = Math.max(
                0.25,
                this.memSampleSum / this.memSampleCount
            );
        }
    }

    async allows(
        running,
        concurrencyCap,
        { schedule = "fifo", runningCost, nextCost } = {}
    ) {
        await this.sample();
        this.lastHoldReason = null;
        if (running === 0) return true;
        if (running >= concurrencyCap) return this.hold("cap");
        // Costs arrive validated: fromWireTask on a worker, CostCache locally.
        if (schedule === "cost") {
            const shortfall = costBudgetShortfall(
                nextCost,
                this.costBudget(runningCost)
            );
            if (shortfall) return this.hold(shortfall);
            if (this.cpuUtil >= this.costCpuValve) return this.hold("cpu");
            return true;
        }
        if (this.cpuUtil >= this.targetLoad) return this.hold("cpu");
        if (this.occupiedGb + this.avgPerTestGb >= this.memBoundGb)
            return this.hold("memory");
        return true;
    }

    // The host's --target-load stays a hard ceiling under cost.
    get costCpuValve() {
        return Math.min(this.targetLoad, COST_CPU_VALVE);
    }

    /** What a cost worker can still start beside `runningCost`. */
    costBudget(runningCost) {
        return {
            cores: this.cpuCores * COST_CPU_BUDGET - runningCost.cores,
            rssGb:
                this.memBoundGb - Math.max(this.occupiedGb, runningCost.rssGb)
        };
    }

    hold(reason) {
        this.lastHoldReason = reason;
        this.holdCounts[reason]++;
        return false;
    }

    stats() {
        return {
            holdCounts: { ...this.holdCounts },
            peakCpu: this.peakCpu,
            avgCpu: this.cpuSamples.length
                ? this.cpuSamples.reduce((sum, value) => sum + value, 0) /
                  this.cpuSamples.length
                : 0,
            cpuSampleCount: this.cpuSamples.length,
            cpuSource: this.cpuSource,
            cpuCores: this.cpuCores,
            ...(this.containerCpuSamples.length
                ? {
                      peakContainerCpu: this.peakContainerCpu,
                      avgContainerCpu: average(this.containerCpuSamples),
                      peakHostSteal: this.peakHostSteal
                  }
                : {}),
            ...(this.cpuPressureSamples.length
                ? {
                      peakCpuPressure: this.peakCpuPressure,
                      avgCpuPressure: average(this.cpuPressureSamples),
                      cpuPressureSampleCount: this.cpuPressureSamples.length,
                      peakCpuPressureFull: this.peakCpuPressureFull
                  }
                : {}),
            ...(this.cpuSource === "cgroup"
                ? {
                      throttledMs: this.throttledMs,
                      nrThrottled: this.nrThrottled
                  }
                : {}),
            peakOccupiedGb: this.peakOccupiedGb,
            avgPerTestGb: this.avgPerTestGb,
            memorySampleCount: this.memSampleCount,
            memBoundGb: this.memBoundGb
        };
    }
}

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Time this process spent scanning the process table, and how often. */
function processScanStats() {
    return {
        processScanCount: processScans.count,
        processScanMs: processScans.ms
    };
}

function resetResourceGateWarnings() {
    warnedAboutPs = false;
}

module.exports = {
    cpuTimes,
    processScanStats,
    resetResourceGateWarnings,
    ResourceGate,
    rssByPid,
    rssByProcessTree,
    TaskProcessSampler,
    rssGbForPids,
    systemOccupiedGb
};
