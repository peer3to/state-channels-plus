/**
 * Light client benchmark: the same calls on the same blocks through the
 * current path and the light client's fallback strategies
 * (docs/light-client-report.md).
 *
 * One peer3 dev node and one provider per path over it, each behind a proxy
 * that records what the provider asked the node:
 * - current: the proxy hides the light client methods, so every read goes to
 *   the node. For a call the pushed state does not answer, this is also the
 *   card's strategy 3, a remote simulation;
 * - batchPerPass: the light client as it is, which collects what a pass
 *   finds missing, proves it in one request and runs the call again
 *   (strategy 2);
 * - fetchEachMiss: the light client proving each missing key as the call
 *   reaches it and going on (strategy 1, `LIGHT_CLIENT_FETCH_EACH_MISS`).
 * Both light client paths follow the same channel of the partition contract.
 *
 * Each round writes to the channels, waits until both light clients hold the
 * block, then runs one call set on each path, in rotating order. Results go
 * to logs/bench/light-client-calls-<time>/results.json; a summary is printed.
 *
 *   PEER3_NODE_BIN=<zero-fee-node> yarn bench:light-client
 *
 * BENCH_ROUNDS (30): rounds; BENCH_CHANNELS (4): channels written, the first
 * followed; BENCH_IDLE_EVERY (3): every n-th round leaves the followed
 * channel unwritten; BENCH_COMPARE (0): 1 also asks the node every read the
 * light clients answer (REQ-LC-11).
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
import { ethers } from "hardhat";
import { hostDescription, percentile, processUsage, sum } from "./benchUtils";

/** A JSON-RPC method name. */
type RpcMethod = string;
/** Requests the node received, per method. */
type MethodCounts = Record<RpcMethod, number>;
type PathName = "current" | "batchPerPass" | "fetchEachMiss";
type CallKind =
    | "storageInPartition"
    | "callReadInPartition"
    | "callWriteInPartition"
    | "callReadOutsidePartition"
    | "callReadManyOutsidePartition"
    | "callReadChainOutsidePartition"
    | "callReadChainOutsidePartitionAgain"
    | "callReadWithoutSender"
    | "balanceOfSender";
type BenchPath = {
    name: PathName;
    provider: LightClientRpcProvider;
    proxy: RpcNodeProxy;
    isLightClient: boolean;
};

type CallRecord = {
    round: number;
    block: number;
    path: PathName;
    kind: CallKind;
    ms: number;
    /** Peer CPU, user and system, while the call ran. */
    cpuUs: number;
    requests: MethodCounts;
    /** The storage keys of each proof request the call made, one list per request. */
    proofRequests: string[][];
    /** Bytes of the call's request and reply frames between peer and node. */
    bytes: number;
    /** How the light client counted the read; empty on the current path. */
    counted: Partial<LightClientCounters>;
    result: string;
};

type PushRecord = {
    path: PathName;
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

const PATHS: readonly PathName[] = ["current", "batchPerPass", "fetchEachMiss"];
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 30);
const CHANNELS = Number(process.env.BENCH_CHANNELS ?? 4);
const IDLE_EVERY = Number(process.env.BENCH_IDLE_EVERY ?? 3);
const COMPARES_READS = process.env.BENCH_COMPARE === "1";
/** Slots per channel; channel `c` writes slots c * SLOT_SPAN + 1... */
const SLOT_SPAN = 1000;
const PUSH_TIMEOUT_MS = 30_000;
/** Enough for the light client probe's deployment. */
const PROBE_DEPLOY_GAS = 9_000_000n;
/** Slots in each probe's list: `walk` reads them one after another. */
const LIST_LENGTH = 8;
/** Slots `sumOf` reads, none depending on another. */
const INDEPENDENT_SLOTS = [0, 1, 2, 3];

function channelId(index: number): string {
    return toBeHex(0xa0 + index, 32);
}

function slotOf(channel: number, offset: number): number {
    return channel * SLOT_SPAN + offset;
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

function pushedBlocks(proxy: RpcNodeProxy): LightClientStorageBlock[] {
    return proxy.sentNotifications
        .filter(({ method }) => method === LIGHT_CLIENT_METHODS.notification)
        .map(
            ({ params }) =>
                (params as { result?: LightClientStorageBlock }).result
        )
        .filter((block) => block !== undefined);
}

function pushRecords(path: BenchPath): PushRecord[] {
    // pushed block number -> the stage times of that push
    const timings = new Map(
        path.provider.pushedBlockTimings.map((timing) => [
            timing.number,
            timing
        ])
    );
    return path.proxy.sentNotifications
        .filter(({ method }) => method === LIGHT_CLIENT_METHODS.notification)
        .flatMap(({ params }) => {
            const block = (params as { result?: LightClientStorageBlock })
                .result;
            if (block === undefined) return [];
            const number = Number(block.header.number);
            const timing = timings.get(number);
            return [
                {
                    path: path.name,
                    number,
                    sync: block.sync,
                    bytes: JSON.stringify(params).length,
                    values: block.values.length,
                    proofNodes: block.proofNodes.length,
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
                }
            ];
        });
}

function summarize(
    records: CallRecord[],
    pushes: PushRecord[],
    paths: BenchPath[]
) {
    const kinds = [...new Set(records.map((record) => record.kind))];
    const deltaPushes = pushes.filter(
        (push) => push.path === "batchPerPass" && !push.sync
    );
    return {
        calls: Object.fromEntries(
            PATHS.map((pathName) => [
                pathName,
                Object.fromEntries(
                    kinds.map((kind) => {
                        const own = records.filter(
                            (record) =>
                                record.path === pathName && record.kind === kind
                        );
                        return [
                            kind,
                            {
                                calls: own.length,
                                medianMs: percentile(
                                    own.map((record) => record.ms),
                                    0.5
                                ),
                                p95Ms: percentile(
                                    own.map((record) => record.ms),
                                    0.95
                                ),
                                medianCpuUs: percentile(
                                    own.map((record) => record.cpuUs),
                                    0.5
                                ),
                                nodeRequests: sum(
                                    own.map((record) =>
                                        sum(Object.values(record.requests))
                                    )
                                ),
                                proofRoundTrips: sum(
                                    own.map(
                                        (record) => record.proofRequests.length
                                    )
                                ),
                                proofKeys: sum(
                                    own.map((record) =>
                                        sum(
                                            record.proofRequests.map(
                                                (keys) => keys.length
                                            )
                                        )
                                    )
                                ),
                                bytes: sum(own.map((record) => record.bytes))
                            }
                        ];
                    })
                )
            ])
        ),
        nodeRequestsWholeRun: Object.fromEntries(
            paths.map((path) => [
                path.name,
                countMethods(path.proxy.forwardedRequests)
            ])
        ),
        lightClientCounters: Object.fromEntries(
            paths
                .filter((path) => path.isLightClient)
                .map((path) => [path.name, path.provider.lightClientCounters])
        ),
        pushedState: Object.fromEntries(
            paths
                .filter((path) => path.isLightClient)
                .map((path) => [path.name, path.provider.pushedStateCounters])
        ),
        readComparisons: COMPARES_READS
            ? Object.fromEntries(
                  paths
                      .filter((path) => path.isLightClient)
                      .map((path) => [path.name, path.provider.readComparisons])
              )
            : null,
        pushes: {
            count: deltaPushes.length,
            medianBytes: percentile(
                deltaPushes.map((push) => push.bytes),
                0.5
            ),
            p95Bytes: percentile(
                deltaPushes.map((push) => push.bytes),
                0.95
            ),
            unchangedValuesWithNewProofNodes: deltaPushes.filter(
                (push) =>
                    push.values === 0 &&
                    (push.stages?.newNodes ?? push.proofNodes) > 0
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
                        deltaPushes.flatMap((push) => {
                            const value = push.stages?.[stage];
                            return value === null || value === undefined
                                ? []
                                : [value];
                        }),
                        0.5
                    )
                ])
            )
        }
    };
}

async function main(): Promise<void> {
    const node = await LightClientNodeFixture.start();
    const { logger, entries } = recordingLogger("warn");
    const paths: BenchPath[] = [];
    try {
        await node.firstBlockSealed();
        const { methods } = (await node.provider.send("rpc_methods", [])) as {
            methods: string[];
        };
        for (const name of PATHS) {
            const proxy = await node.proxyToNode();
            const isLightClient = name !== "current";
            if (!isLightClient)
                proxy.answerRequests("rpc_methods", {
                    methods: methods.filter(
                        (method) => !method.startsWith("lightClient_")
                    )
                });
            const provider = await createRpcNodesProvider(
                {
                    PROVIDER_URL: proxy.url,
                    PROVIDER_URLS: [proxy.url],
                    LIGHT_CLIENT_COMPARE_READS: COMPARES_READS,
                    LIGHT_CLIENT_FETCH_EACH_MISS: name === "fetchEachMiss"
                },
                logger
            );
            if (!(provider instanceof LightClientRpcProvider))
                throw new Error("Expected the light client provider");
            paths.push({ name, provider, proxy, isLightClient });
        }
        const lightClientPaths = paths.filter((path) => path.isLightClient);

        const contract = await node.deploy(PARTITION_CONTRACT);
        // contracts the followed channel never touches, as an ERC-20 another
        // call reads: one for the dependent reads, one for the independent ones
        const probe = await ethers.getContractFactory("LightClientProbe");
        const chainProbe = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        const sumProbe = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        for (const address of [chainProbe, sumProbe])
            await node.transact(
                address,
                probe.interface.encodeFunctionData("link", [LIST_LENGTH])
            );
        // every channel's slots exist before the run
        for (let channel = 0; channel < CHANNELS; channel++)
            await node.readWriteLog(
                contract,
                channelId(channel),
                0,
                slotOf(channel, 1),
                1
            );
        for (const path of lightClientPaths)
            path.provider.followChannel(contract, channelId(0));
        await waitFor(
            () =>
                lightClientPaths.every(
                    (path) => pushedBlocks(path.proxy).length > 0
                ),
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
                    to: sumProbe,
                    data: probe.interface.encodeFunctionData("next", [
                        LIST_LENGTH - 1
                    ])
                }),
            callReadManyOutsidePartition: (provider) =>
                provider.call({
                    from: node.senderAddress,
                    to: sumProbe,
                    data: probe.interface.encodeFunctionData("sumOf", [
                        INDEPENDENT_SLOTS
                    ])
                }),
            callReadChainOutsidePartition: (provider) =>
                provider.call({
                    from: node.senderAddress,
                    to: chainProbe,
                    data: probe.interface.encodeFunctionData("walk")
                }),
            // the same call at the same block: everything it reads is held
            callReadChainOutsidePartitionAgain: (provider) =>
                provider.call({
                    from: node.senderAddress,
                    to: chainProbe,
                    data: probe.interface.encodeFunctionData("walk")
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

        const nodeBefore = processUsage(node.pid);
        const records: CallRecord[] = [];
        let mismatches = 0;
        for (let round = 0; round < ROUNDS; round++) {
            const writes: Promise<{ blockNumber: number }>[] = [];
            for (let channel = 0; channel < CHANNELS; channel++) {
                if (channel === 0 && round % IDLE_EVERY === IDLE_EVERY - 1)
                    continue;
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
                    lightClientPaths.every((path) =>
                        pushedBlocks(path.proxy).some(
                            (pushed) => Number(pushed.header.number) >= block
                        )
                    ),
                PUSH_TIMEOUT_MS
            );
            // each path goes first in turn
            const order = PATHS.map(
                (_, index) => paths[(index + round) % paths.length]
            );
            // call kind -> the first path's result this round
            const results = new Map<CallKind, string>();
            for (const path of order) {
                const { provider, proxy } = path;
                for (const kind of Object.keys(calls) as CallKind[]) {
                    const requestsBefore = proxy.forwardedRequests.length;
                    const bytesBefore = proxy.requestBytes + proxy.replyBytes;
                    const countersBefore = {
                        ...provider.lightClientCounters
                    };
                    const cpuBefore = process.cpuUsage();
                    const started = performance.now();
                    const result = await calls[kind](provider);
                    const ms = performance.now() - started;
                    const cpu = process.cpuUsage(cpuBefore);
                    const sent = proxy.forwardedRequests.slice(requestsBefore);
                    records.push({
                        round,
                        block,
                        path: path.name,
                        kind,
                        ms,
                        cpuUs: cpu.user + cpu.system,
                        requests: countMethods(sent),
                        proofRequests: sent
                            .filter(
                                ({ method }) => method === "state_getReadProof"
                            )
                            .map(({ params }) => (params as [string[]])[0]),
                        bytes:
                            proxy.requestBytes + proxy.replyBytes - bytesBefore,
                        counted: path.isLightClient
                            ? counterDelta(
                                  countersBefore,
                                  provider.lightClientCounters
                              )
                            : {},
                        result
                    });
                    const first = results.get(kind);
                    if (first === undefined) results.set(kind, result);
                    else if (first !== result) mismatches++;
                }
            }
        }
        const nodeAfter = processUsage(node.pid);

        const pushes = lightClientPaths.flatMap(pushRecords);
        const summary = {
            ...summarize(records, pushes, paths),
            resultMismatchesBetweenPaths: mismatches,
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
                        host: hostDescription(),
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
        for (const benchPath of paths) benchPath.provider.destroy();
        logger.dispose();
        await node.stop();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
