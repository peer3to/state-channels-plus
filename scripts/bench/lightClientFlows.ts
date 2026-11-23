/**
 * Light client benchmark of channel flows (S5.0, docs/light-client-report.md):
 * existing tests of whole channel flows, each run alone on a parachain dev
 * node three times: the node without the light client (today's path), with it,
 * and with it and every read it answers compared with the node's at the same
 * block. The harness gives every peer a proxy of its own to the node and
 * writes, per peer, the requests by method, how its light client answered and
 * the trace of its proofs and pushes (test/fixtures/lightClient/flowBench.ts).
 * Results go to logs/bench/light-client-flows-<time>/: one file per flow, mode
 * and repeat, and results.json with the summary.
 *
 *   PEER3_NODE_BIN=<zero-fee-node with --light-client> yarn bench:light-client:flows
 *
 * BENCH_FLOWS (all): flow names to run, comma separated.
 * BENCH_FLOWS_MODES (off,on,compared): the modes to run, comma separated.
 * BENCH_FLOWS_REPEATS (1): runs of each flow in each mode; the files of
 * repeat r > 1 are named <flow>-<mode>-<r>.json.
 *
 * Every run also samples the CPU time of the node processes (every process
 * whose command starts with PEER3_NODE_BIN) every 100 ms; the run's node CPU
 * is the last sample of each, summed. On Linux it is read from
 * /proc/<pid>/stat in clock ticks, as ps there shows whole seconds.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FlowBenchPeer } from "../../test/fixtures/lightClient/flowBench";

type Mode = "off" | "on" | "compared";
type Flow = { name: string; file: string; test: string };

/** The flows the engineer chose (2026-11-23), each an existing test. */
const FLOWS: readonly Flow[] = [
    {
        name: "transitions",
        file: "e2e/E2E-StateTransition.test.ts",
        test: "should handle multiple rotation rounds"
    },
    {
        name: "snapshot",
        file: "e2e/E2E-StateSnapshots.test.ts",
        test: "should post updated state snapshot on-chain after 3 transitions"
    },
    {
        name: "deposit",
        file: "e2e/E2E-JoinSnapshotGuard.test.ts",
        test: "concurrent topUpBalance calls with one prepared request"
    },
    {
        name: "leaveAndWithdraw",
        file: "e2e/E2E-ParticipantLifecycle.test.ts",
        test: "public terminal leave settles before disposal and excludes the former signer"
    },
    {
        name: "dispute",
        file: "e2e/E2E-DisputeManager.test.ts",
        test: "should reduce invalid state transition disputes and create new fork"
    },
    {
        name: "rejoin",
        file: "e2e/E2E-ParticipantLifecycle.test.ts",
        test: "remaining peers do not blacklist the leaver after its exit and it can be force-joined back"
    }
];
const MODES: readonly Mode[] = ["off", "on", "compared"];
/** Requests a light client sends only to prove what it reads. */
const PROOF_METHODS = ["state_getReadProof", "chain_getHeader"];
/** Requests that run a call on the node: remote simulations. */
const SIMULATION_METHODS = ["eth_call", "eth_estimateGas"];
/** How often the node processes' CPU time is sampled. */
const CPU_SAMPLE_MS = 100;

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `ps` CPU time, `[[H:]M:]S.ss`, in seconds. */
function cpuSeconds(time: string): number {
    return time
        .split(":")
        .reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

/**
 * Samples the CPU time of every node process until the returned function is
 * called. A node counts with its last sample: CPU it used after that sample,
 * before it exited, is not counted.
 */
/** Clock ticks per second of /proc/<pid>/stat, on Linux. */
const CLOCK_TICKS =
    process.platform === "linux"
        ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }))
        : 0;

/**
 * The CPU seconds of `pid`: on Linux its user and system ticks from
 * /proc/<pid>/stat, since ps there shows whole seconds only; elsewhere ps's
 * `time`. Undefined once the process is gone.
 */
function processCpuSeconds(pid: number, psTime: string): number | undefined {
    if (process.platform !== "linux") return cpuSeconds(psTime);
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        // the fields after the command name, which may hold spaces: state is the first
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        return (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS;
    } catch {
        return undefined;
    }
}

function sampleNodeCpu(nodeBin: string): () => {
    nodeCpuSeconds: number;
    nodeProcesses: number;
} {
    // process id -> its CPU seconds at the last sample
    const lastCpuSeconds = new Map<number, number>();
    const sample = () => {
        let listing: string;
        try {
            listing = execFileSync("ps", ["-A", "-o", "pid=,time=,command="], {
                encoding: "utf8"
            });
        } catch {
            return;
        }
        for (const line of listing.split("\n")) {
            const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
            if (!match || !match[3].startsWith(nodeBin)) continue;
            const seconds = processCpuSeconds(Number(match[1]), match[2]);
            if (seconds !== undefined)
                lastCpuSeconds.set(Number(match[1]), seconds);
        }
    };
    const timer = setInterval(sample, CPU_SAMPLE_MS);
    return () => {
        clearInterval(timer);
        return {
            nodeCpuSeconds: [...lastCpuSeconds.values()].reduce(
                (total, seconds) => total + seconds,
                0
            ),
            nodeProcesses: lastCpuSeconds.size
        };
    };
}

async function runFlow(
    flow: Flow,
    mode: Mode,
    file: string,
    nodeBin: string
): Promise<{ passed: boolean; nodeCpuSeconds: number; nodeProcesses: number }> {
    const stopSampling = sampleNodeCpu(nodeBin);
    const child = spawn(
        "yarn",
        [
            "-s",
            "test:parallel",
            "--parachain",
            "--no-forge",
            "--mocha-test-pattern",
            flow.file,
            "--grep",
            escapeRegExp(flow.test)
        ],
        {
            stdio: ["ignore", "ignore", "inherit"],
            env: {
                ...process.env,
                PEER3_NODE_LIGHT_CLIENT: mode === "off" ? "0" : "1",
                BENCH_FLOWS_FILE: file,
                BENCH_FLOWS_COMPARE: mode === "compared" ? "1" : "0"
            }
        }
    );
    const status = await new Promise<number | null>((resolve) =>
        child.on("close", resolve)
    );
    return { passed: status === 0, ...stopSampling() };
}

function total(counts: Record<string, number>, methods?: string[]): number {
    return Object.entries(counts)
        .filter(([method]) => !methods || methods.includes(method))
        .reduce((n, [, count]) => n + count, 0);
}

function sumPeers(peers: FlowBenchPeer[]) {
    const requests: Record<string, number> = {};
    for (const peer of peers)
        for (const [method, count] of Object.entries(peer.requests))
            requests[method] = (requests[method] ?? 0) + count;
    const sum = (
        pick: (peer: FlowBenchPeer) => Record<string, number> | undefined
    ) => {
        const out: Record<string, number> = {};
        for (const peer of peers)
            for (const [key, value] of Object.entries(pick(peer) ?? {}))
                out[key] = (out[key] ?? 0) + value;
        return out;
    };
    return {
        peers: peers.length,
        requests,
        totalRequests: total(requests),
        proofRequests: total(requests, PROOF_METHODS),
        remoteSimulations: total(requests, SIMULATION_METHODS),
        bytes: peers.reduce((n, p) => n + p.requestBytes + p.replyBytes, 0),
        lightClient: sum((peer) => peer.counts?.lightClient),
        pushedState: sum((peer) => peer.counts?.pushedState),
        readComparisons: sum((peer) => peer.counts?.readComparisons)
    };
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function listFromEnv<T extends string>(
    name: string,
    all: readonly T[]
): readonly T[] {
    const names = process.env[name]?.split(",").map((n) => n.trim());
    if (!names) return all;
    const unknown = names.filter((n) => !all.includes(n as T));
    if (unknown.length > 0)
        throw new Error(`${name}: unknown ${unknown.join(", ")}`);
    return all.filter((item) => names.includes(item));
}

async function main(): Promise<void> {
    const nodeBin = process.env.PEER3_NODE_BIN;
    if (!nodeBin) throw new Error("PEER3_NODE_BIN names no peer3 node binary");
    const flowNames = listFromEnv(
        "BENCH_FLOWS",
        FLOWS.map((flow) => flow.name)
    );
    const flows = FLOWS.filter((flow) => flowNames.includes(flow.name));
    const modes = listFromEnv("BENCH_FLOWS_MODES", MODES);
    const repeats = Number(process.env.BENCH_FLOWS_REPEATS ?? "1");
    if (!Number.isInteger(repeats) || repeats < 1)
        throw new Error("BENCH_FLOWS_REPEATS is not a positive integer");
    const dir = path.join(
        "logs",
        "bench",
        `light-client-flows-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    mkdirSync(dir, { recursive: true });
    const summary: Record<string, unknown> = {};
    for (const flow of flows) {
        const byMode: Record<string, unknown[]> = {};
        const medianRequests: Record<string, number | null> = {};
        for (const mode of modes) {
            const runs = [];
            for (let repeat = 1; repeat <= repeats; repeat++) {
                const name =
                    repeat === 1
                        ? `${flow.name}-${mode}.json`
                        : `${flow.name}-${mode}-${repeat}.json`;
                const file = path.resolve(dir, name);
                const run = await runFlow(flow, mode, file, nodeBin);
                let result: ReturnType<typeof sumPeers> | null = null;
                try {
                    result = sumPeers(
                        (
                            JSON.parse(readFileSync(file, "utf8")) as {
                                peers: FlowBenchPeer[];
                            }
                        ).peers
                    );
                } catch {
                    result = null;
                }
                runs.push({ file: name, ...run, ...result });
                console.log(
                    `${flow.name} ${mode} #${repeat}: ${run.passed ? "passed" : "FAILED"}, ${result?.totalRequests ?? "?"} requests, node CPU ${run.nodeCpuSeconds.toFixed(2)} s (${run.nodeProcesses} processes)`
                );
            }
            byMode[mode] = runs;
            medianRequests[mode] = median(
                runs.flatMap((run) =>
                    "totalRequests" in run &&
                    typeof run.totalRequests === "number"
                        ? [run.totalRequests]
                        : []
                )
            );
        }
        const off = medianRequests.off;
        const on = medianRequests.on;
        summary[flow.name] = {
            test: `${flow.file}: ${flow.test}`,
            ...byMode,
            medianRequests,
            requestsOnPerOff:
                off && on !== null && on !== undefined ? on / off : null
        };
    }
    writeFileSync(
        path.join(dir, "results.json"),
        JSON.stringify(
            {
                run: {
                    date: new Date().toISOString(),
                    nodeBinary: nodeBin,
                    repeats,
                    modes
                },
                flows: summary
            },
            null,
            2
        )
    );
    console.log(`results: ${path.join(dir, "results.json")}`);
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
