const { execFile } = require("child_process");
const os = require("os");
const { promisify } = require("util");
const { PER_TEST_MEM_GB } = require("./constants");
const { cpuDelta, osTimes, readCpuSnapshot } = require("./cpuAccounting");

const execFileAsync = promisify(execFile);
let warnedAboutPs = false;

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

async function rssByProcessTree(rootPids, options = {}) {
    const roots = [...new Set(rootPids.filter(Boolean))];
    if (!roots.length) return new Map();
    try {
        const run = options.execFile || execFileAsync;
        const result = await run("ps", ["-axo", "pid=,ppid=,rss="]);
        const output = typeof result === "string" ? result : result.stdout;
        const processes = output
            .split("\n")
            .map((line) => line.trim().split(/\s+/).map(Number))
            .filter(
                ([pid, ppid, rss]) =>
                    Number.isInteger(pid) &&
                    Number.isInteger(ppid) &&
                    Number.isFinite(rss)
            )
            .map(([pid, ppid, rss]) => ({
                pid,
                ppid,
                rssGb: rss / 1024 / 1024
            }));
        const byPid = new Map(
            processes.map((process) => [process.pid, process])
        );
        const rootSet = new Set(roots);
        const totals = new Map(roots.map((root) => [root, 0]));
        for (const process of processes) {
            let current = process.pid;
            const seen = new Set();
            while (!rootSet.has(current) && !seen.has(current)) {
                seen.add(current);
                const parent = byPid.get(current);
                if (!parent) break;
                current = parent.ppid;
            }
            if (rootSet.has(current)) {
                totals.set(current, totals.get(current) + process.rssGb);
            }
        }
        return totals;
    } catch (error) {
        if (!warnedAboutPs) {
            warnedAboutPs = true;
            (options.warn || console.warn)(
                `Unable to sample process-tree RSS with ps; using system memory: ${error.message}`
            );
        }
        return null;
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

    async allows(running, concurrencyCap) {
        await this.sample();
        return (
            running === 0 ||
            (running < concurrencyCap &&
                this.cpuUtil < this.targetLoad &&
                this.occupiedGb + this.avgPerTestGb < this.memBoundGb)
        );
    }

    stats() {
        return {
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

function resetResourceGateWarnings() {
    warnedAboutPs = false;
}

module.exports = {
    cpuTimes,
    resetResourceGateWarnings,
    ResourceGate,
    rssByPid,
    rssByProcessTree,
    rssGbForPids,
    systemOccupiedGb
};
