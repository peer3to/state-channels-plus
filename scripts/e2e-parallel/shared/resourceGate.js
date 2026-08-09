const { execFile } = require("child_process");
const os = require("os");
const { promisify } = require("util");
const { PER_TEST_MEM_GB } = require("./constants");

const execFileAsync = promisify(execFile);
let warnedAboutPs = false;

function cpuTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        for (const value of Object.values(cpu.times)) total += value;
        idle += cpu.times.idle;
    }
    return { idle, total };
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
        this.lastCpu = cpuTimes();
        this.cpuUtil = 0;
        this.peakCpu = 0;
        this.cpuSamples = [];
        this.avgPerTestGb = PER_TEST_MEM_GB;
        this.memSampleSum = 0;
        this.memSampleCount = 0;
        this.occupiedGb = 0;
        this.peakOccupiedGb = 0;
    }

    async sample() {
        const now = cpuTimes();
        const idleDelta = now.idle - this.lastCpu.idle;
        const totalDelta = now.total - this.lastCpu.total;
        this.lastCpu = now;
        if (totalDelta > 0) {
            this.cpuUtil = Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
        }
        this.peakCpu = Math.max(this.peakCpu, this.cpuUtil);
        this.cpuSamples.push(this.cpuUtil);

        const testPids = this.testPids();
        const infraPids = this.infraPids();
        const samples = await rssByPid(
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
            peakOccupiedGb: this.peakOccupiedGb,
            avgPerTestGb: this.avgPerTestGb,
            memorySampleCount: this.memSampleCount,
            memBoundGb: this.memBoundGb
        };
    }
}

function resetResourceGateWarnings() {
    warnedAboutPs = false;
}

module.exports = {
    cpuTimes,
    resetResourceGateWarnings,
    ResourceGate,
    rssByPid,
    rssGbForPids,
    systemOccupiedGb
};
