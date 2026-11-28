/** Helpers the light client benchmarks share. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import { ZeroHash } from "ethers";

/** The hex prefix of every storage key of `contract`, for {@link contractValueCount}. */
export function contractStoragePrefix(contract: string): string {
    // the storage map's 32-byte prefix and the contract's 36-byte hashed
    // address, ahead of the hashed slot
    return contractStorageKey(contract, ZeroHash)
        .toLowerCase()
        .slice(0, 2 + 2 * (32 + 36));
}

/**
 * How many of a pushed message's `values` are slots of the contract whose
 * {@link contractStoragePrefix} is `prefix`. The rest are accounts and code,
 * such as the account of whoever sent the block's transactions, whose nonce
 * changes with each one: a partition whose slots kept their values still
 * carries those.
 */
export function contractValueCount(
    values: readonly { key: string }[],
    prefix: string
): number {
    return values.filter(({ key }) => key.toLowerCase().startsWith(prefix))
        .length;
}

/** The value below which `fraction` of `values` lie; null for no values. */
export function percentile(values: number[], fraction: number): number | null {
    return sortedPercentile(sortedCopy(values), fraction);
}

/** Median, p95 and max of `values`, sorted once; a step can hold hundreds of thousands. */
export function spread(values: number[]) {
    const sorted = sortedCopy(values);
    return {
        median: sortedPercentile(sorted, 0.5),
        p95: sortedPercentile(sorted, 0.95),
        max: sorted.length === 0 ? null : sorted[sorted.length - 1]
    };
}

function sortedCopy(values: number[]): number[] {
    return [...values].sort((a, b) => a - b);
}

function sortedPercentile(sorted: number[], fraction: number): number | null {
    if (sorted.length === 0) return null;
    return sorted[
        Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
    ];
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
