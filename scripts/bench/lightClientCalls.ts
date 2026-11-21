/**
 * Light client benchmark: the same calls on the same blocks through the
 * current path and the light client path (docs/light-client-report.md).
 *
 * One peer3 dev node, two providers over it, each behind a proxy that records
 * what the provider asked the node:
 * - current path: the proxy hides the light client methods, so every read
 *   goes to the node;
 * - light client path: the provider follows one channel of the partition
 *   contract and answers reads from what the node pushes and proves.
 *
 * Each round writes to the channels, waits for the light client to hold the
 * block, then runs one call set on each path, in alternating order. Results go
 * to logs/bench/light-client-calls-<time>/results.json; a summary is printed.
 *
 *   PEER3_NODE_BIN=<zero-fee-node> yarn bench:light-client
 *
 * BENCH_ROUNDS (30): rounds; BENCH_CHANNELS (4): channels written, the first
 * followed; BENCH_IDLE_EVERY (3): every n-th round leaves the followed
 * channel unwritten; BENCH_COMPARE (0): 1 also asks the node every read the
 * light client answers (REQ-LC-11).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    LIGHT_CLIENT_METHODS,
    type LightClientStorageBlock
} from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import LightClientRpcProvider from "@/evm/p2pRuntime/rpcNodes/LightClientRpcProvider";
import type { LightClientCounters } from "@/index";
import { createRpcNodesProvider } from "@/index";
import {
    LightClientNodeFixture,
    PARTITION_CONTRACT
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import type { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { recordingLogger } from "@test/fixtures/node/RpcNodesFixture";
import { waitFor } from "@test/utils/waitFor";
import { toBeHex } from "ethers";

/** A JSON-RPC method name. */
type RpcMethod = string;
/** Requests the node received, per method. */
type MethodCounts = Record<RpcMethod, number>;
type PathName = "current" | "lightClient";
type CallKind =
    | "storageInPartition"
    | "callReadInPartition"
    | "callWriteInPartition"
    | "callReadOutsidePartition"
    | "callReadWithoutSender"
    | "balanceOfSender";

type CallRecord = {
    round: number;
    block: number;
    path: PathName;
    kind: CallKind;
    ms: number;
    /** Peer CPU, user and system, while the call ran. */
    cpuUs: number;
    requests: MethodCounts;
    /** The storage keys the call's proof requests asked for. */
    proofKeys: string[];
    /** How the light client counted the read; empty on the current path. */
    counted: Partial<LightClientCounters>;
    result: string;
};

type PushRecord = {
    number: number;
    sync: boolean;
    bytes: number;
    values: number;
    proofNodes: number;
    stages?: {
        buildMs: number | null;
        dispatchMs: number;
        transitMs: number;
        verifyMs: number;
        endToEndMs: number | null;
        newNodes: number;
        heldNodes: number;
    };
};

const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 30);
const CHANNELS = Number(process.env.BENCH_CHANNELS ?? 4);
const IDLE_EVERY = Number(process.env.BENCH_IDLE_EVERY ?? 3);
const COMPARES_READS = process.env.BENCH_COMPARE === "1";
/** Slots per channel; channel `c` writes slots c * SLOT_SPAN + 1... */
const SLOT_SPAN = 1000;
const PUSH_TIMEOUT_MS = 30_000;

function channelId(index: number): string {
    return toBeHex(0xa0 + index, 32);
}

function slotOf(channel: number, offset: number): number {
    return channel * SLOT_SPAN + offset;
}

function percentile(values: number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[
        Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
    ];
}

function countMethods(requests: { method: RpcMethod }[]): MethodCounts {
    const counts: MethodCounts = {};
    for (const { method } of requests)
        counts[method] = (counts[method] ?? 0) + 1;
    return counts;
}

function counterDelta(
    before: LightClientCounters,
    after: LightClientCounters
): Partial<LightClientCounters> {
    const delta: Partial<LightClientCounters> = {};
    for (const key of Object.keys(after) as (keyof LightClientCounters)[])
        if (after[key] !== before[key]) delta[key] = after[key] - before[key];
    return delta;
}

/** CPU seconds and resident memory of process `pid`, from `ps`. */
function processUsage(pid: number): { cpuSeconds: number; rssKb: number } {
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
    const cpuSeconds = parts.reduce((total, part) => total * 60 + part, 0);
    return { cpuSeconds, rssKb: Number(rss) };
}

function pushedBlocks(proxy: RpcNodeProxy): LightClientStorageBlock[] {
    return proxy.sentNotifications
        .filter(({ method }) => method === LIGHT_CLIENT_METHODS.notification)
        .map(
            ({ params }) =>
                (params as { result?: LightClientStorageBlock }).result
        )
        .filter((block) => block !== undefined);
}

async function main(): Promise<void> {
    const node = await LightClientNodeFixture.start();
    const { logger, entries } = recordingLogger("warn");
    const providers: LightClientRpcProvider[] = [];
    try {
        await node.firstBlockSealed();
        const currentProxy = await node.proxyToNode();
        const { methods } = (await node.provider.send("rpc_methods", [])) as {
            methods: string[];
        };
        currentProxy.answerRequests("rpc_methods", {
            methods: methods.filter(
                (method) => !method.startsWith("lightClient_")
            )
        });
        const lightClientProxy = await node.proxyToNode();
        const open = async (proxy: RpcNodeProxy) => {
            const provider = await createRpcNodesProvider(
                {
                    PROVIDER_URL: proxy.url,
                    PROVIDER_URLS: [proxy.url],
                    LIGHT_CLIENT_COMPARE_READS: COMPARES_READS
                },
                logger
            );
            if (!(provider instanceof LightClientRpcProvider))
                throw new Error("Expected the light client provider");
            providers.push(provider);
            return provider;
        };
        const paths: Record<
            PathName,
            { provider: LightClientRpcProvider; proxy: RpcNodeProxy }
        > = {
            current: {
                provider: await open(currentProxy),
                proxy: currentProxy
            },
            lightClient: {
                provider: await open(lightClientProxy),
                proxy: lightClientProxy
            }
        };

        const contract = await node.deploy(PARTITION_CONTRACT);
        // a contract the followed channel never touches, as an ERC-20 another call reads
        const other = await node.deploy(PARTITION_CONTRACT);
        // every channel's slots exist before the run
        for (let channel = 0; channel < CHANNELS; channel++)
            await node.readWriteLog(
                contract,
                channelId(channel),
                0,
                slotOf(channel, 1),
                1
            );
        await node.readWriteLog(other, channelId(1), 0, 1, 1);
        paths.lightClient.provider.followChannel(contract, channelId(0));
        await waitFor(
            () => pushedBlocks(lightClientProxy).length > 0,
            PUSH_TIMEOUT_MS
        );

        const calls: Record<
            CallKind,
            (provider: LightClientRpcProvider) => Promise<string>
        > = {
            storageInPartition: (provider) =>
                provider.getStorage(contract, slotOf(0, 1)),
            callReadInPartition: (provider) =>
                provider.call({
                    from: node.senderAddress,
                    to: contract,
                    data: toBeHex(slotOf(0, 1), 32)
                }),
            callWriteInPartition: (provider) =>
                provider.call({
                    from: node.senderAddress,
                    to: contract,
                    data:
                        channelId(0) +
                        toBeHex(slotOf(0, 1), 32).slice(2) +
                        toBeHex(slotOf(0, 2), 32).slice(2) +
                        toBeHex(1, 32).slice(2)
                }),
            callReadOutsidePartition: (provider) =>
                provider.call({
                    from: node.senderAddress,
                    to: other,
                    data: toBeHex(1, 32)
                }),
            // the caller is then the zero address, whose account no partition holds
            callReadWithoutSender: (provider) =>
                provider.call({
                    to: contract,
                    data: toBeHex(slotOf(0, 1), 32)
                }),
            balanceOfSender: async (provider) =>
                (await provider.getBalance(node.senderAddress)).toString()
        };

        const pid = node.pid;
        const nodeBefore = processUsage(pid);
        const records: CallRecord[] = [];
        let mismatches = 0;
        for (let round = 0; round < ROUNDS; round++) {
            const writes: Promise<{ blockNumber: number }>[] = [];
            for (let channel = 0; channel < CHANNELS; channel++) {
                if (channel === 0 && round % IDLE_EVERY === IDLE_EVERY - 1)
                    continue;
                if (channel === 1)
                    writes.push(
                        node.readWriteLog(other, channelId(1), 1, 1, 1)
                    );
                // the same slot again each round: repeated writes
                writes.push(
                    node.readWriteLog(
                        contract,
                        channelId(channel),
                        slotOf(channel, 1),
                        slotOf(channel, 1),
                        1
                    )
                );
            }
            const block = Math.max(
                ...(await Promise.all(writes)).map(
                    (receipt) => receipt.blockNumber
                )
            );
            await waitFor(
                () =>
                    pushedBlocks(lightClientProxy).some(
                        (pushed) => Number(pushed.header.number) >= block
                    ),
                PUSH_TIMEOUT_MS
            );
            const order: PathName[] =
                round % 2 === 0
                    ? ["current", "lightClient"]
                    : ["lightClient", "current"];
            const results: Record<string, string> = {};
            for (const pathName of order) {
                const { provider, proxy } = paths[pathName];
                for (const kind of Object.keys(calls) as CallKind[]) {
                    const requestsBefore = proxy.forwardedRequests.length;
                    const countersBefore = { ...provider.lightClientCounters };
                    const cpuBefore = process.cpuUsage();
                    const started = performance.now();
                    const result = await calls[kind](provider);
                    const ms = performance.now() - started;
                    const cpu = process.cpuUsage(cpuBefore);
                    records.push({
                        round,
                        block,
                        path: pathName,
                        kind,
                        ms,
                        cpuUs: cpu.user + cpu.system,
                        requests: countMethods(
                            proxy.forwardedRequests.slice(requestsBefore)
                        ),
                        proofKeys: proxy.forwardedRequests
                            .slice(requestsBefore)
                            .filter(
                                ({ method }) => method === "state_getReadProof"
                            )
                            .flatMap(
                                ({ params }) =>
                                    (params as [string[], string])[0]
                            ),
                        counted:
                            pathName === "lightClient"
                                ? counterDelta(
                                      countersBefore,
                                      provider.lightClientCounters
                                  )
                                : {},
                        result
                    });
                    const key = `${kind}`;
                    if (key in results && results[key] !== result) mismatches++;
                    results[key] = result;
                }
            }
        }
        const nodeAfter = processUsage(pid);

        // pushed block number -> the stage times of that push
        const timings = new Map(
            paths.lightClient.provider.pushedBlockTimings.map((timing) => [
                timing.number,
                timing
            ])
        );
        const pushes: PushRecord[] = lightClientProxy.sentNotifications
            .filter(
                ({ method }) => method === LIGHT_CLIENT_METHODS.notification
            )
            .map(({ params }) => ({
                params,
                block: (params as { result?: LightClientStorageBlock }).result
            }))
            .filter(({ block }) => block !== undefined)
            .map(({ params, block }) => {
                const number = Number(block!.header.number);
                const timing = timings.get(number);
                return {
                    number,
                    sync: block!.sync,
                    bytes: JSON.stringify(params).length,
                    values: block!.values.length,
                    proofNodes: block!.proofNodes.length,
                    stages: timing && {
                        buildMs:
                            timing.executedAt === null
                                ? null
                                : timing.builtAt - timing.executedAt,
                        dispatchMs: timing.sentAt - timing.builtAt,
                        transitMs: timing.receivedAt - timing.sentAt,
                        verifyMs: timing.verifiedAt - timing.receivedAt,
                        endToEndMs:
                            timing.executedAt === null
                                ? null
                                : timing.verifiedAt - timing.executedAt,
                        newNodes: timing.newNodes,
                        heldNodes: timing.heldNodes
                    }
                };
            });

        const summary = {
            calls: Object.fromEntries(
                (["current", "lightClient"] as PathName[]).map((pathName) => [
                    pathName,
                    Object.fromEntries(
                        (Object.keys(calls) as CallKind[]).map((kind) => {
                            const own = records.filter(
                                (r) => r.path === pathName && r.kind === kind
                            );
                            const requests = own.map((r) =>
                                Object.values(r.requests).reduce(
                                    (a, b) => a + b,
                                    0
                                )
                            );
                            return [
                                kind,
                                {
                                    calls: own.length,
                                    medianMs: percentile(
                                        own.map((r) => r.ms),
                                        0.5
                                    ),
                                    p95Ms: percentile(
                                        own.map((r) => r.ms),
                                        0.95
                                    ),
                                    medianCpuUs: percentile(
                                        own.map((r) => r.cpuUs),
                                        0.5
                                    ),
                                    nodeRequests: requests.reduce(
                                        (a, b) => a + b,
                                        0
                                    )
                                }
                            ];
                        })
                    )
                ])
            ),
            nodeRequestsWholeRun: {
                current: countMethods(currentProxy.forwardedRequests),
                lightClient: countMethods(lightClientProxy.forwardedRequests)
            },
            lightClientCounters: paths.lightClient.provider.lightClientCounters,
            pushedState: paths.lightClient.provider.pushedStateCounters,
            readComparisons: COMPARES_READS
                ? paths.lightClient.provider.readComparisons
                : null,
            resultMismatchesBetweenPaths: mismatches,
            pushes: {
                count: pushes.length,
                medianBytes: percentile(
                    pushes.filter((p) => !p.sync).map((p) => p.bytes),
                    0.5
                ),
                p95Bytes: percentile(
                    pushes.filter((p) => !p.sync).map((p) => p.bytes),
                    0.95
                ),
                unchangedValuesWithNewProofNodes: pushes.filter(
                    (p) =>
                        !p.sync &&
                        p.values === 0 &&
                        (p.stages?.newNodes ?? p.proofNodes) > 0
                ).length,
                stagesMedianMs: Object.fromEntries(
                    (
                        [
                            "buildMs",
                            "dispatchMs",
                            "transitMs",
                            "verifyMs",
                            "endToEndMs"
                        ] as const
                    ).map((stage) => [
                        stage,
                        percentile(
                            pushes.flatMap((p) =>
                                p.stages?.[stage] == null
                                    ? []
                                    : [p.stages[stage]!]
                            ),
                            0.5
                        )
                    ])
                )
            },
            node: {
                cpuSeconds: nodeAfter.cpuSeconds - nodeBefore.cpuSeconds,
                rssKbBefore: nodeBefore.rssKb,
                rssKbAfter: nodeAfter.rssKb
            },
            errorsLogged: entries().filter((entry) => entry.level === "error")
                .length
        };

        const dir = path.join(
            "logs",
            "bench",
            `light-client-calls-${new Date().toISOString().replace(/[:.]/g, "-")}`
        );
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            path.join(dir, "results.json"),
            JSON.stringify(
                {
                    run: {
                        date: new Date().toISOString(),
                        host: {
                            platform: `${os.platform()} ${os.release()}`,
                            cpus: `${os.cpus().length} x ${os.cpus()[0]?.model}`,
                            memoryGb: Math.round(os.totalmem() / 2 ** 30),
                            loadAverage: os.loadavg()
                        },
                        nodeBinary: process.env.PEER3_NODE_BIN,
                        parameters: {
                            ROUNDS,
                            CHANNELS,
                            IDLE_EVERY,
                            COMPARES_READS
                        }
                    },
                    summary,
                    calls: records,
                    pushes
                },
                null,
                2
            )
        );
        console.log(JSON.stringify(summary, null, 2));
        console.log(`results: ${dir}/results.json`);
    } finally {
        for (const provider of providers) provider.destroy();
        logger.dispose();
        await node.stop();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
