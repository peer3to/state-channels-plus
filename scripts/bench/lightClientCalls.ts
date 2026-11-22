/**
 * Light client benchmark: the same calls on the same blocks through the
 * current path and the light client's fallback strategies
 * (docs/light-client-report.md).
 *
 * One peer3 dev node and one provider per path over it, each behind a proxy
 * that records what the provider asked the node:
 * - current: the proxy hides the light client methods, so every read goes to
 *   the node. For a call the pushed state does not answer, this is also the
 *   card's strategy 3, a remote simulation. The card runs it on another node;
 *   the dev node takes no peers, so BENCH_PATHS=current gives it a node of its
 *   own instead;
 * - batchPerPass: the light client as it is, which collects what a pass
 *   finds missing, proves it in one request and runs the call again
 *   (strategy 2);
 * - fetchEachMiss: the light client proving each missing key as the call
 *   reaches it and going on (strategy 1, `LIGHT_CLIENT_FETCH_EACH_MISS`).
 * - cold: the light client as batchPerPass, following no channel, so it
 *   proves every key a call reads. The share of those keys the followed paths
 *   did not have to prove is their hit rate.
 * Both strategy paths follow the same channel of the partition contract.
 *
 * Each round writes to the channels, waits until the following light clients
 * hold the block, then runs one call set on each path, in rotating order.
 * Every few rounds each following path's socket is dropped, and the time
 * until its light client accepts the node's new sync is recorded. Results go
 * to logs/bench/light-client-calls-<time>/results.json; a summary is printed.
 *
 *   PEER3_NODE_BIN=<zero-fee-node> yarn bench:light-client
 *
 * BENCH_ROUNDS (30): rounds; BENCH_CHANNELS (4): channels written, the first
 * followed; BENCH_IDLE_EVERY (3): every n-th round leaves the followed
 * channel unwritten; BENCH_COMPARE (0): 1 also asks the node every read the
 * light clients answer (REQ-LC-11); BENCH_PATHS (all): the paths to run, comma
 * separated, one per run giving each path a node of its own, so that the node's
 * CPU and memory are that path's; BENCH_NODE_LIGHT_CLIENT (1): 0 starts the node
 * without `--light-client`, for the current path only, the node's baseline;
 * BENCH_CHANNELS_PER_TX (1): channels one transaction writes, as one
 * multicall over several channels does; BENCH_RECONNECT_EVERY (10): rounds
 * between dropped sockets, 0 for none; BENCH_CALL_SETS (1): times each path
 * runs the call set per round, so that the node's work per call shows above
 * its block production.
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
    PARTITION_CONTRACT,
    partitionWrite
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import type { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { recordingLogger } from "@test/fixtures/node/RpcNodesFixture";
import { waitFor } from "@test/utils/waitFor";
import { toBeHex } from "ethers";
import { ethers } from "hardhat";
import {
    hostDescription,
    percentile,
    processUsage,
    spread,
    sum
} from "./benchUtils";

/** A JSON-RPC method name. */
type RpcMethod = string;
/** Requests the node received, per method. */
type MethodCounts = Record<RpcMethod, number>;
type PathName = "current" | "batchPerPass" | "fetchEachMiss" | "cold";
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
    /** Whether the light client follows the bench's channel. */
    follows: boolean;
};

type CallRecord = {
    round: number;
    /** Which of the round's call sets, from 0. */
    set: number;
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

/** A dropped socket and the new sync the light client accepted after it. */
type ReconnectRecord = {
    round: number;
    path: PathName;
    /** From dropping the socket until the light client held the new sync. */
    ms: number;
    /** Block of the first push accepted after the drop, and whether the node sent it as a sync. */
    number: number;
    sync: boolean;
    /** Values that push carried: for a sync, every key the partition holds. */
    values: number;
    bytes: number;
};

const PATHS: readonly PathName[] = [
    "current",
    "batchPerPass",
    "fetchEachMiss",
    "cold"
];
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 30);
const CHANNELS = Number(process.env.BENCH_CHANNELS ?? 4);
const IDLE_EVERY = Number(process.env.BENCH_IDLE_EVERY ?? 3);
const COMPARES_READS = process.env.BENCH_COMPARE === "1";
const RUN_PATHS = runPaths(process.env.BENCH_PATHS);
const NODE_LIGHT_CLIENT = process.env.BENCH_NODE_LIGHT_CLIENT !== "0";
const CHANNELS_PER_TX = Number(process.env.BENCH_CHANNELS_PER_TX ?? 1);
const RECONNECT_EVERY = Number(process.env.BENCH_RECONNECT_EVERY ?? 10);
const CALL_SETS = Number(process.env.BENCH_CALL_SETS ?? 1);
/** Above the gas one write of the partition contract takes, called from the probe. */
const GAS_PER_FORWARDED_WRITE = 100_000n;
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

/** The paths `BENCH_PATHS` names, in the order of {@link PATHS}; all of them when unset. */
function runPaths(names: string | undefined): PathName[] {
    if (names === undefined) return [...PATHS];
    const named = names.split(",").map((name) => name.trim());
    const unknown = named.filter(
        (name) => !(PATHS as readonly string[]).includes(name)
    );
    if (named.length === 0 || unknown.length > 0)
        throw new Error(
            `BENCH_PATHS names unknown paths ${unknown.join(", ")}; known: ${PATHS.join(", ")}`
        );
    return PATHS.filter((name) => named.includes(name));
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

/** The pushed blocks `proxy` delivered from its `from`-th notification on, with their message's size. */
function pushedBlocks(
    proxy: RpcNodeProxy,
    from = 0
): { block: LightClientStorageBlock; bytes: number }[] {
    return proxy.sentNotifications.slice(from).flatMap(({ method, params }) => {
        if (method !== LIGHT_CLIENT_METHODS.notification) return [];
        const block = (params as { result?: LightClientStorageBlock }).result;
        return block === undefined
            ? []
            : [{ block, bytes: JSON.stringify(params).length }];
    });
}

function pushRecords(path: BenchPath): PushRecord[] {
    // pushed block number -> the stage times of that push
    const timings = new Map(
        path.provider.pushedBlockTimings.map((timing) => [
            timing.number,
            timing
        ])
    );
    return pushedBlocks(path.proxy).map(({ block, bytes }) => {
        const number = Number(block.header.number);
        const timing = timings.get(number);
        return {
            path: path.name,
            number,
            sync: block.sync,
            bytes,
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
        };
    });
}

/**
 * Drops `path`'s socket and lets the provider connect again at once; how long
 * until its light client held the first push the node sent after the drop.
 */
async function reconnect(
    path: BenchPath,
    round: number
): Promise<ReconnectRecord> {
    const { proxy, provider } = path;
    const notificationsBefore = proxy.sentNotifications.length;
    const droppedAt = Date.now();
    proxy.cut();
    proxy.restore();
    const acceptedAfterDrop = () => {
        const [pushed] = pushedBlocks(proxy, notificationsBefore);
        if (pushed === undefined) return undefined;
        const number = Number(pushed.block.header.number);
        const timing = provider.pushedBlockTimings.find(
            (accepted) =>
                accepted.number === number && accepted.receivedAt >= droppedAt
        );
        return timing && { ...pushed, number, timing };
    };
    await waitFor(() => acceptedAfterDrop() !== undefined, PUSH_TIMEOUT_MS);
    const accepted = acceptedAfterDrop();
    if (accepted === undefined)
        throw new Error(`${path.name} accepted no push after the drop`);
    return {
        round,
        path: path.name,
        ms: accepted.timing.verifiedAt - droppedAt,
        number: accepted.number,
        sync: accepted.block.sync,
        values: accepted.block.values.length,
        bytes: accepted.bytes
    };
}

/** Keys the records' proof requests named; a key asked for again counts again. */
function proofKeys(records: CallRecord[]): number {
    return sum(
        records.map((record) =>
            sum(record.proofRequests.map((keys) => keys.length))
        )
    );
}

/**
 * The share of the keys the cold path proved for `kind`, or for every kind
 * when none is named, that `path` did not have to prove; null when the cold
 * path proved none.
 */
function hitRate(
    records: CallRecord[],
    path: PathName,
    kind?: CallKind
): number | null {
    const provedBy = (name: PathName) =>
        proofKeys(
            records.filter(
                (record) =>
                    record.path === name &&
                    (kind === undefined || record.kind === kind)
            )
        );
    const cold = provedBy("cold");
    return cold === 0 ? null : 1 - provedBy(path) / cold;
}

/**
 * How `path`'s calls were answered, as shares of its calls, and for the calls
 * that needed a fallback the spread and histogram of the keys and round trips
 * each one proved itself. A call can need a fallback and prove nothing: it
 * used a proof an earlier call fetched at the same block.
 */
function callOutcomes(records: CallRecord[], path: PathName) {
    const own = records.filter((record) => record.path === path);
    const counted = (key: keyof LightClientCounters) =>
        own.filter((record) => (record.counted[key] ?? 0) > 0).length;
    const share = (count: number) =>
        own.length === 0 ? null : count / own.length;
    const affected = own.filter(
        (record) => (record.counted.withFallbackRead ?? 0) > 0
    );
    const keysPerCall = affected.map((record) => proofKeys([record]));
    const roundTripsPerCall = affected.map(
        (record) => record.proofRequests.length
    );
    return {
        calls: own.length,
        fromPushedState: share(counted("fromPushedState")),
        withFallbackRead: share(affected.length),
        leftToNodes: share(counted("leftToNodes")),
        failed: share(counted("failed")),
        missingKeysPerAffectedCall: {
            ...spread(keysPerCall),
            histogram: histogram(keysPerCall)
        },
        roundTripsPerAffectedCall: {
            ...spread(roundTripsPerCall),
            histogram: histogram(roundTripsPerCall)
        }
    };
}

/** How often each value occurs. */
function histogram(values: number[]): Record<number, number> {
    // value -> the number of times it occurs
    const counts: Record<number, number> = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
}

function summarize(
    records: CallRecord[],
    pushes: PushRecord[],
    reconnects: ReconnectRecord[],
    paths: BenchPath[]
) {
    const kinds = [...new Set(records.map((record) => record.kind))];
    const followingPaths = paths.filter((path) => path.follows);
    // the following paths follow the same channel: one path's pushes stand for all
    const pushPath = followingPaths[0]?.name;
    const deltaPushes = pushes.filter(
        (push) => push.path === pushPath && !push.sync
    );
    return {
        calls: Object.fromEntries(
            paths.map(({ name: pathName }) => [
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
                                proofKeys: proofKeys(own),
                                bytes: sum(own.map((record) => record.bytes))
                            }
                        ];
                    })
                )
            ])
        ),
        callOutcomes: Object.fromEntries(
            paths
                .filter((path) => path.isLightClient)
                .map(({ name }) => [name, callOutcomes(records, name)])
        ),
        hitRate: paths.some((path) => path.name === "cold")
            ? Object.fromEntries(
                  followingPaths.map(({ name }) => [
                      name,
                      {
                          all: hitRate(records, name),
                          ...Object.fromEntries(
                              kinds.map((kind) => [
                                  kind,
                                  hitRate(records, name, kind)
                              ])
                          )
                      }
                  ])
              )
            : null,
        reconnects: Object.fromEntries(
            followingPaths.map(({ name }) => {
                const own = reconnects.filter(
                    (reconnect) => reconnect.path === name
                );
                return [
                    name,
                    {
                        count: own.length,
                        bySync: own.filter((reconnect) => reconnect.sync)
                            .length,
                        ms: spread(own.map((reconnect) => reconnect.ms)),
                        medianSyncValues: percentile(
                            own
                                .filter((reconnect) => reconnect.sync)
                                .map((reconnect) => reconnect.values),
                            0.5
                        )
                    }
                ];
            })
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
            values: spread(deltaPushes.map((push) => push.values)),
            newProofNodes: spread(
                deltaPushes.flatMap((push) =>
                    push.stages ? [push.stages.newNodes] : []
                )
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
    if (!NODE_LIGHT_CLIENT && RUN_PATHS.some((name) => name !== "current"))
        throw new Error(
            "BENCH_NODE_LIGHT_CLIENT=0 runs only the current path: set BENCH_PATHS=current"
        );
    const node = await LightClientNodeFixture.start({
        lightClient: NODE_LIGHT_CLIENT
    });
    const { logger, entries } = recordingLogger("warn");
    const paths: BenchPath[] = [];
    try {
        await node.firstBlockSealed();
        const { methods } = (await node.provider.send("rpc_methods", [])) as {
            methods: string[];
        };
        for (const name of RUN_PATHS) {
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
            paths.push({
                name,
                provider,
                proxy,
                isLightClient,
                follows: isLightClient && name !== "cold"
            });
        }
        const followingPaths = paths.filter((path) => path.follows);

        const contract = await node.deploy(PARTITION_CONTRACT);
        // contracts the followed channel never touches, as an ERC-20 another
        // call reads: one for the dependent reads, one for the independent ones
        const probe = await ethers.getContractFactory("LightClientProbe");
        const chainProbe = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        const sumProbe = await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS);
        // sends the writes of several channels as one transaction; the calls never read it
        const multiChannelSender =
            CHANNELS_PER_TX > 1
                ? await node.deploy(probe.bytecode, PROBE_DEPLOY_GAS)
                : undefined;
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
        for (const path of followingPaths)
            path.provider.followChannel(contract, channelId(0));
        await waitFor(
            () =>
                followingPaths.every(
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
        const reconnects: ReconnectRecord[] = [];
        let mismatches = 0;
        for (let round = 0; round < ROUNDS; round++) {
            const written: number[] = [];
            for (let channel = 0; channel < CHANNELS; channel++)
                if (channel !== 0 || round % IDLE_EVERY !== IDLE_EVERY - 1)
                    written.push(channel);
            // the same slot again each round: repeated writes
            const writeOf = (channel: number) =>
                partitionWrite(
                    channelId(channel),
                    slotOf(channel, 1),
                    slotOf(channel, 1),
                    1
                );
            const writes: Promise<{ blockNumber: number }>[] = [];
            for (let at = 0; at < written.length; at += CHANNELS_PER_TX) {
                const group = written.slice(at, at + CHANNELS_PER_TX);
                writes.push(
                    multiChannelSender === undefined
                        ? node.transact(contract, writeOf(group[0]))
                        : node.transact(
                              multiChannelSender,
                              probe.interface.encodeFunctionData("callEach", [
                                  contract,
                                  group.map(writeOf)
                              ]),
                              GAS_PER_FORWARDED_WRITE * BigInt(group.length + 1)
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
                    followingPaths.every((path) =>
                        pushedBlocks(path.proxy).some(
                            ({ block: pushed }) =>
                                Number(pushed.header.number) >= block
                        )
                    ),
                PUSH_TIMEOUT_MS
            );
            // each path goes first in turn
            const order = paths.map(
                (_, index) => paths[(index + round) % paths.length]
            );
            // call kind -> the first path's result this round
            const results = new Map<CallKind, string>();
            for (const path of order) {
                const { provider, proxy } = path;
                for (let set = 0; set < CALL_SETS; set++)
                    for (const kind of Object.keys(calls) as CallKind[]) {
                        const requestsBefore = proxy.forwardedRequests.length;
                        const bytesBefore =
                            proxy.requestBytes + proxy.replyBytes;
                        const countersBefore = {
                            ...provider.lightClientCounters
                        };
                        const cpuBefore = process.cpuUsage();
                        const started = performance.now();
                        const result = await calls[kind](provider);
                        const ms = performance.now() - started;
                        const cpu = process.cpuUsage(cpuBefore);
                        const sent =
                            proxy.forwardedRequests.slice(requestsBefore);
                        records.push({
                            round,
                            set,
                            block,
                            path: path.name,
                            kind,
                            ms,
                            cpuUs: cpu.user + cpu.system,
                            requests: countMethods(sent),
                            proofRequests: sent
                                .filter(
                                    ({ method }) =>
                                        method === "state_getReadProof"
                                )
                                .map(({ params }) => (params as [string[]])[0]),
                            bytes:
                                proxy.requestBytes +
                                proxy.replyBytes -
                                bytesBefore,
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
            if (
                RECONNECT_EVERY > 0 &&
                round % RECONNECT_EVERY === RECONNECT_EVERY - 1
            )
                for (const path of followingPaths)
                    reconnects.push(await reconnect(path, round));
        }
        const nodeAfter = processUsage(node.pid);

        const pushes = followingPaths.flatMap(pushRecords);
        const summary = {
            ...summarize(records, pushes, reconnects, paths),
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
                            COMPARES_READS,
                            RUN_PATHS,
                            NODE_LIGHT_CLIENT,
                            CHANNELS_PER_TX,
                            RECONNECT_EVERY,
                            CALL_SETS
                        }
                    },
                    summary,
                    calls: records,
                    pushes,
                    reconnects
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
