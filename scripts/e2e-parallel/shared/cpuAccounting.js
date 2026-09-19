const fs = require("fs");
const os = require("os");

// Where the runner's CPU figures come from, most specific source first:
//
//   cgroup  this process's cgroup v2 — inside the worker container that is
//           the container itself. cpu.stat gives the CPU our test tree
//           consumed and any quota throttling, cpu.pressure gives the share
//           of time our tasks were runnable but waiting for a CPU (whoever
//           caused the wait), cpuset.cpus.effective the cores we may use.
//   host    Linux /proc/stat: the machine's busy share, with hypervisor
//           steal counted as busy, plus /proc/pressure/cpu.
//   os      os.cpus() times on other platforms.
//
// Utilization is an average over the sampling interval and hides bursts
// shorter than that; pressure is the kernel's own stall accounting and does
// not. Both are reported so the run summary states what the hosts saw.

function defaultReadFile(file) {
    return fs.readFileSync(file, "utf8");
}

// "0-3,6" -> 5
function parseCpuList(text) {
    let count = 0;
    for (const part of text.trim().split(",")) {
        if (!part) continue;
        const [first, last] = part.split("-").map(Number);
        count += last === undefined ? 1 : last - first + 1;
    }
    return count;
}

function parseKeyValues(text) {
    const values = {};
    for (const line of text.split("\n")) {
        const [key, value] = line.trim().split(/\s+/);
        if (key && value !== undefined) values[key] = Number(value);
    }
    return values;
}

// "some avg10=0.00 avg60=0.00 avg300=0.00 total=12345" per line
function parsePressure(text) {
    const totals = {};
    for (const line of text.split("\n")) {
        const match = /^(some|full) .*total=(\d+)/.exec(line.trim());
        if (match) totals[match[1]] = Number(match[2]);
    }
    return totals;
}

function tryRead(readFile, file) {
    try {
        return readFile(file);
    } catch {
        return undefined;
    }
}

function ownCgroupRoot(readFile) {
    const text = tryRead(readFile, "/proc/self/cgroup");
    const line = text?.split("\n").find((entry) => entry.startsWith("0::"));
    if (!line) return undefined;
    return `/sys/fs/cgroup${line.slice(3).trim()}`.replace(/\/+$/, "");
}

// /proc/stat first line: user nice system idle iowait irq softirq steal ...
function readHostStat(readFile) {
    const text = tryRead(readFile, "/proc/stat");
    if (!text) return undefined;
    const fields = text.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
    const [
        user,
        nice,
        system,
        idle,
        iowait = 0,
        irq = 0,
        softirq = 0,
        steal = 0
    ] = fields;
    if (![user, nice, system, idle].every(Number.isFinite)) return undefined;
    const idleAll = idle + iowait;
    return {
        idle: idleAll,
        steal,
        total: user + nice + system + idleAll + irq + softirq + steal
    };
}

function osTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        for (const value of Object.values(cpu.times)) total += value;
        idle += cpu.times.idle;
    }
    return { idle, total };
}

function readCpuSnapshot(options = {}) {
    const readFile = options.readFile || defaultReadFile;
    const cpuCount = options.cpuCount || (() => os.cpus().length);
    const platform = options.platform || process.platform;
    const at = options.now ? options.now() : Date.now();
    if (platform === "linux") {
        const root = ownCgroupRoot(readFile);
        const statText = root && tryRead(readFile, `${root}/cpu.stat`);
        const stat = statText ? parseKeyValues(statText) : undefined;
        const host = readHostStat(readFile);
        if (stat && Number.isFinite(stat.usage_usec)) {
            const cpuset = tryRead(readFile, `${root}/cpuset.cpus.effective`);
            const cores = (cpuset && parseCpuList(cpuset)) || cpuCount();
            const pressure = parsePressure(
                tryRead(readFile, `${root}/cpu.pressure`) ??
                    tryRead(readFile, "/proc/pressure/cpu") ??
                    ""
            );
            return {
                source: "cgroup",
                at,
                cores,
                usageUs: stat.usage_usec,
                throttledUs: stat.throttled_usec,
                nrThrottled: stat.nr_throttled,
                pressureSomeUs: pressure.some,
                pressureFullUs: pressure.full,
                host
            };
        }
        if (host) {
            const pressure = parsePressure(
                tryRead(readFile, "/proc/pressure/cpu") ?? ""
            );
            return {
                source: "host",
                at,
                cores: cpuCount(),
                host,
                pressureSomeUs: pressure.some,
                pressureFullUs: pressure.full
            };
        }
    }
    return { source: "os", at, cores: cpuCount(), os: osTimes() };
}

const clamp = (value) => Math.max(0, Math.min(1, value));

// Rates over the interval between two snapshots of the same source. Every
// field is undefined when its counters are unavailable.
function cpuDelta(previous, next) {
    const delta = {};
    if (!previous || !next || previous.source !== next.source) return delta;
    const wallUs = (next.at - previous.at) * 1000;
    if (next.source === "cgroup") {
        if (wallUs > 0)
            delta.cpuUtil = clamp(
                (next.usageUs - previous.usageUs) / (wallUs * next.cores)
            );
        if (
            Number.isFinite(next.throttledUs) &&
            Number.isFinite(previous.throttledUs)
        ) {
            delta.throttledMs =
                (next.throttledUs - previous.throttledUs) / 1000;
            delta.nrThrottled = next.nrThrottled - previous.nrThrottled;
        }
    }
    if (next.host && previous.host) {
        const total = next.host.total - previous.host.total;
        if (total > 0) {
            delta.hostCpuUtil = clamp(
                1 - (next.host.idle - previous.host.idle) / total
            );
            delta.hostSteal = clamp(
                (next.host.steal - previous.host.steal) / total
            );
        }
        if (next.source === "host") delta.cpuUtil = delta.hostCpuUtil;
    }
    if (next.os && previous.os) {
        const total = next.os.total - previous.os.total;
        if (total > 0)
            delta.cpuUtil = clamp(
                1 - (next.os.idle - previous.os.idle) / total
            );
    }
    if (wallUs > 0) {
        if (
            Number.isFinite(next.pressureSomeUs) &&
            Number.isFinite(previous.pressureSomeUs)
        )
            delta.cpuPressure = clamp(
                (next.pressureSomeUs - previous.pressureSomeUs) / wallUs
            );
        if (
            Number.isFinite(next.pressureFullUs) &&
            Number.isFinite(previous.pressureFullUs)
        )
            delta.cpuPressureFull = clamp(
                (next.pressureFullUs - previous.pressureFullUs) / wallUs
            );
    }
    return delta;
}

module.exports = {
    cpuDelta,
    osTimes,
    parseCpuList,
    parsePressure,
    readCpuSnapshot
};
