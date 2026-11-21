/** Helpers the light client benchmarks share. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

/** The value below which `fraction` of `values` lie; null for no values. */
export function percentile(values: number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[
        Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
    ];
}

export function spread(values: number[]) {
    return {
        median: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        max: values.length === 0 ? null : Math.max(...values)
    };
}

export function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clock ticks per second of /proc's CPU times, read once. */
let clockTicks: number | undefined;

/**
 * CPU seconds and resident memory of process `pid`: from /proc on Linux, to
 * the clock tick, and from `ps` elsewhere.
 */
export function processUsage(pid: number): {
    cpuSeconds: number;
    rssKb: number;
} {
    if (os.platform() === "linux") {
        clockTicks ??= Number(execFileSync("getconf", ["CLK_TCK"]).toString());
        // the command name in parentheses may hold spaces: fields follow its end
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        // utime and stime are fields 14 and 15, the 12th and 13th after the name
        const ticks = Number(fields[11]) + Number(fields[12]);
        const rss = /VmRSS:\s+(\d+)/.exec(
            readFileSync(`/proc/${pid}/status`, "utf8")
        );
        return {
            cpuSeconds: ticks / clockTicks,
            rssKb: Number(rss?.[1] ?? 0)
        };
    }
    const [rss, time] = execFileSync("ps", [
        "-o",
        "rss=,time=",
        "-p",
        String(pid)
    ])
        .toString()
        .trim()
        .split(/\s+/);
    const parts = time.split(/[:-]/).map(Number);
    return {
        cpuSeconds: parts.reduce((total, part) => total * 60 + part, 0),
        rssKb: Number(rss)
    };
}

/** The host a benchmark ran on, for its results. */
export function hostDescription() {
    return {
        platform: `${os.platform()} ${os.release()}`,
        cpus: `${os.cpus().length} x ${os.cpus()[0]?.model}`,
        memoryGb: Math.round(os.totalmem() / 2 ** 30),
        loadAverage: os.loadavg()
    };
}
