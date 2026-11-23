// @spec-test-coverage-ignore: fixture support for the light client benchmark of channel flows (scripts/bench/lightClientFlows.ts).
/**
 * The light client benchmark of channel flows runs existing tests with
 * `BENCH_FLOWS_FILE` set. Every peer then reaches the test node through a
 * proxy of its own, so what its runtime asks the node is counted apart from
 * the harness's own requests; with `BENCH_FLOWS_COMPARE=1` its light client
 * asks the node every read it answers at the same block
 * (`LIGHT_CLIENT_COMPARE_READS`). At cleanup the harness writes, per peer, the
 * requests by method and how its light client answered, to that file.
 */
import type { RpcNodeProxy } from "../node/RpcNodeProxy";
import type { Config } from "@/utils/config";
import type { LightClientCounts } from "@test/fixtures/customRpc/harnessControl/services/lightClient/LightClientControlService";
import { writeFileSync } from "node:fs";

/** Peers the harness can start: every one gets a proxy. */
const MAX_PEERS = 10;

/** One peer's part of a flow benchmark. */
export type FlowBenchPeer = {
    peer: number;
    /** Requests the peer's runtime sent the node, by JSON-RPC method. */
    requests: Record<string, number>;
    requestBytes: number;
    replyBytes: number;
    /** Null when the runtime was gone or its provider is not the light client's. */
    counts: LightClientCounts | null;
    /**
     * Keys the peer's proofs asked for, by what they hold and whose
     * (`storage:<address>`, `code:<address>`, `account:<address>`, or
     * `other`), with repeats.
     */
    provenKeys: Record<string, number>;
};

/** `twox128` prefixes of the state maps a Frontier key lives in, and what each holds. */
const KEY_PREFIXES: readonly [prefix: string, kind: string][] = [
    [
        "0x1da53b775b270400e7e61ed5cbc5a146ab1160471b1418779239ba8e2b847e42",
        "storage"
    ],
    [
        "0x1da53b775b270400e7e61ed5cbc5a146ea70f53d5a3306ce02aaf97049cf181a",
        "code"
    ],
    [
        "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9",
        "account"
    ]
];

/**
 * What a state trie key holds and whose: the map's 32-byte prefix, then
 * `Blake2_128Concat` of the address, whose last 20 bytes are the address.
 */
function keyKind(key: string): string {
    const lower = key.toLowerCase();
    for (const [prefix, kind] of KEY_PREFIXES)
        if (lower.startsWith(prefix)) {
            const addressStart = prefix.length + 2 * 16;
            return `${kind}:0x${lower.slice(addressStart, addressStart + 40)}`;
        }
    return "other";
}

/** The file a flow benchmark writes to, when one runs. */
export function flowBenchFile(): string | undefined {
    return process.env.BENCH_FLOWS_FILE || undefined;
}

/** `byPeer`, with one proxy for every peer it leaves out while a flow benchmark runs. */
export function flowBenchProxies(
    byPeer: Record<number, number> | undefined
): Record<number, number> | undefined {
    if (!flowBenchFile()) return byPeer;
    const all: Record<number, number> = {};
    for (let peer = 0; peer < MAX_PEERS; peer++) all[peer] = 1;
    return { ...all, ...byPeer };
}

/** `overrides`, with the reads compared while a flow benchmark asks for it. */
export function flowBenchConfig(overrides: Partial<Config>): Partial<Config> {
    return flowBenchFile() && process.env.BENCH_FLOWS_COMPARE === "1"
        ? { ...overrides, LIGHT_CLIENT_COMPARE_READS: true }
        : overrides;
}

/** What `proxies` forwarded for one peer, with its runtime's `counts`. */
export function flowBenchPeer(
    peer: number,
    proxies: readonly RpcNodeProxy[],
    counts: LightClientCounts | null
): FlowBenchPeer {
    const requests: Record<string, number> = {};
    const provenKeys: Record<string, number> = {};
    for (const proxy of proxies)
        for (const { method, params } of proxy.forwardedRequests) {
            requests[method] = (requests[method] ?? 0) + 1;
            if (method === "state_getReadProof")
                for (const key of (params as [string[]])[0]) {
                    const kind = keyKind(key);
                    provenKeys[kind] = (provenKeys[kind] ?? 0) + 1;
                }
        }
    return {
        peer,
        requests,
        requestBytes: proxies.reduce((n, proxy) => n + proxy.requestBytes, 0),
        replyBytes: proxies.reduce((n, proxy) => n + proxy.replyBytes, 0),
        counts,
        provenKeys
    };
}

export function writeFlowBench(file: string, peers: FlowBenchPeer[]): void {
    writeFileSync(file, JSON.stringify({ peers }, null, 2));
}
