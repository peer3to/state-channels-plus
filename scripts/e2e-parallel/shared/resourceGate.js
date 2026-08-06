const { execFileSync } = require("child_process");
const os = require("os");
const { PER_TEST_MEM_GB } = require("./constants");

function cpuTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        for (const value of Object.values(cpu.times)) total += value;
        idle += cpu.times.idle;
    }
    return { idle, total };
}

function rssGbForPids(pids) {
    if (!pids.length) return 0;
    try {
        const output = execFileSync(
            "ps",
            ["-o", "rss=", "-p", pids.join(",")],
            { encoding: "utf8" }
        );
        const kb = output
            .split("\n")
            .map((value) => Number.parseInt(value.trim(), 10))
            .filter(Number.isFinite)
            .reduce((sum, value) => sum + value, 0);
        return kb / 1024 / 1024;
    } catch {
        return 0;
    }
}

class ResourceGate {
    constructor({ testPids, infraPids, targetLoad, memBoundGb }) {
        this.testPids = testPids;
        this.infraPids = infraPids;
        this.targetLoad = targetLoad;
        this.memBoundGb = memBoundGb;
        this.lastCpu = cpuTimes();
        this.cpuUtil = 0;
        this.peakCpu = 0;
        this.cpuSamples = [];
        this.avgPerTestGb = PER_TEST_MEM_GB;
        this.memSampleSum = 0;
        this.memSampleCount = 0;
        this.occupiedGb = rssGbForPids(this.infraPids());
        this.peakOccupiedGb = this.occupiedGb;
    }

    sample() {
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
        const testGb = rssGbForPids(testPids);
        this.occupiedGb = testGb + rssGbForPids(this.infraPids());
        this.peakOccupiedGb = Math.max(this.peakOccupiedGb, this.occupiedGb);
        if (testPids.length) {
            this.memSampleSum += testGb / testPids.length;
            this.memSampleCount++;
            this.avgPerTestGb = Math.max(
                0.25,
                this.memSampleSum / this.memSampleCount
            );
        }
    }

    allows(running, concurrencyCap) {
        this.sample();
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

module.exports = { cpuTimes, rssGbForPids, ResourceGate };
