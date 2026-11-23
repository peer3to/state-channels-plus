/**
 * Light client benchmark of channel flows (S5.0, docs/light-client-report.md):
 * existing tests of whole channel flows, each run alone on a parachain dev
 * node three times: the node without the light client (today's path), with it,
 * and with it and every read it answers compared with the node's at the same
 * block. The harness gives every peer a proxy of its own to the node and
 * writes, per peer, the requests by method and how its light client answered
 * (test/fixtures/lightClient/flowBench.ts). Results go to
 * logs/bench/light-client-flows-<time>/: one file per flow and mode, and
 * results.json with the summary.
 *
 *   PEER3_NODE_BIN=<zero-fee-node with --light-client> yarn bench:light-client:flows
 *
 * BENCH_FLOWS (all): flow names to run, comma separated.
 */
import { spawnSync } from "node:child_process";
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

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runFlow(flow: Flow, mode: Mode, file: string): boolean {
    const result = spawnSync(
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
    return result.status === 0;
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

function main(): void {
    const names = process.env.BENCH_FLOWS?.split(",").map((n) => n.trim());
    const flows = names
        ? FLOWS.filter((flow) => names.includes(flow.name))
        : FLOWS;
    const dir = path.join(
        "logs",
        "bench",
        `light-client-flows-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    mkdirSync(dir, { recursive: true });
    const summary: Record<string, unknown> = {};
    for (const flow of flows) {
        const byMode: Record<string, unknown> = {};
        for (const mode of MODES) {
            const file = path.resolve(dir, `${flow.name}-${mode}.json`);
            const passed = runFlow(flow, mode, file);
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
            byMode[mode] = { passed, ...result };
            console.log(
                `${flow.name} ${mode}: ${passed ? "passed" : "FAILED"}, ${result?.totalRequests ?? "?"} requests`
            );
        }
        const off = byMode.off as { totalRequests?: number };
        const on = byMode.on as { totalRequests?: number };
        summary[flow.name] = {
            test: `${flow.file}: ${flow.test}`,
            ...byMode,
            requestsOnPerOff:
                off.totalRequests && on.totalRequests !== undefined
                    ? on.totalRequests / off.totalRequests
                    : null
        };
    }
    writeFileSync(
        path.join(dir, "results.json"),
        JSON.stringify(
            {
                run: {
                    date: new Date().toISOString(),
                    nodeBinary: process.env.PEER3_NODE_BIN ?? null
                },
                flows: summary
            },
            null,
            2
        )
    );
    console.log(`results: ${path.join(dir, "results.json")}`);
}

main();
