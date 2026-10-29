import type { PerformanceSample } from "../performanceMonitorInternal";
import { readFileSync } from "node:fs";

// Linux kernel scheduler counters read by the event-loop monitor once per
// reporting interval. Everything here returns undefined off Linux or where a
// file is not exposed, so the monitor simply omits the fields.

/**
 * The calling thread's scheduler counters from the Linux kernel: nanoseconds
 * on a CPU and nanoseconds runnable but waiting for one. Undefined where the
 * file does not exist (other platforms, kernels without schedstats).
 */
export function readThreadSchedstat():
    | { runNs: number; waitNs: number }
    | undefined {
    if (process.platform !== "linux") return undefined;
    try {
        const [runNs, waitNs] = readFileSync(
            "/proc/thread-self/schedstat",
            "utf8"
        )
            .trim()
            .split(" ")
            .map(Number);
        return Number.isFinite(runNs) && Number.isFinite(waitNs)
            ? { runNs, waitNs }
            : undefined;
    } catch {
        return undefined;
    }
}

export type HostCounters = {
    // /proc/stat jiffies: everything but idle and iowait, idle and iowait, steal
    busy: number;
    idle: number;
    steal: number;
    // /proc/pressure/cpu "some" total, microseconds
    pressureUs?: number;
    // this cgroup's cpu.stat throttled time, microseconds
    throttledUs?: number;
};

function readCgroupThrottledUs(): number | undefined {
    const candidates: { path: string; scale: number; key: string }[] = [];
    try {
        // cgroup v2: "0::/<path>"
        const own = readFileSync("/proc/self/cgroup", "utf8")
            .split("\n")
            .find((line) => line.startsWith("0::"));
        if (own)
            candidates.push({
                path: `/sys/fs/cgroup${own.slice(3).trim()}/cpu.stat`,
                scale: 1,
                key: "throttled_usec"
            });
    } catch {
        // no cgroup information
    }
    candidates.push(
        { path: "/sys/fs/cgroup/cpu.stat", scale: 1, key: "throttled_usec" },
        {
            path: "/sys/fs/cgroup/cpu,cpuacct/cpu.stat",
            scale: 1 / 1000,
            key: "throttled_time"
        }
    );
    for (const { path, scale, key } of candidates) {
        try {
            const match = new RegExp(`^${key} (\\d+)`, "m").exec(
                readFileSync(path, "utf8")
            );
            if (match) return Number(match[1]) * scale;
        } catch {
            // try the next location
        }
    }
    return undefined;
}

/**
 * Host-wide counters from the Linux kernel, for the one thread per process
 * that reports them. Undefined on other platforms.
 */
export function readHostCounters(): HostCounters | undefined {
    if (process.platform !== "linux") return undefined;
    try {
        const cpu = readFileSync("/proc/stat", "utf8")
            .split("\n")[0]
            .trim()
            .split(/\s+/)
            .slice(1)
            .map(Number);
        const [user, nice, system, idle, iowait, irq, softirq, steal = 0] = cpu;
        if (![user, nice, system, idle].every(Number.isFinite))
            return undefined;
        const counters: HostCounters = {
            busy: user + nice + system + (irq ?? 0) + (softirq ?? 0) + steal,
            idle: idle + (iowait ?? 0),
            steal
        };
        try {
            const match = /^some .*total=(\d+)/m.exec(
                readFileSync("/proc/pressure/cpu", "utf8")
            );
            if (match) counters.pressureUs = Number(match[1]);
        } catch {
            // pressure-stall information not exposed
        }
        counters.throttledUs = readCgroupThrottledUs();
        return counters;
    } catch {
        return undefined;
    }
}

export function hostDelta(
    now: HostCounters | undefined,
    last: HostCounters | undefined
): Partial<PerformanceSample> {
    if (!now || !last) return {};
    const total = now.busy + now.idle - (last.busy + last.idle);
    if (!(total > 0)) return {};
    return {
        hostBusy: (now.busy - last.busy) / total,
        hostSteal: (now.steal - last.steal) / total,
        ...(now.pressureUs !== undefined && last.pressureUs !== undefined
            ? { hostCpuPressureMs: (now.pressureUs - last.pressureUs) / 1000 }
            : {}),
        ...(now.throttledUs !== undefined && last.throttledUs !== undefined
            ? { cgroupThrottledMs: (now.throttledUs - last.throttledUs) / 1000 }
            : {})
    };
}
