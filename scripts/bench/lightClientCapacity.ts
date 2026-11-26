/**
 * Light client capacity benchmark (docs/light-client-report.md): how many
 * subscribers one RPC node serves. A writer keeps a block workload going at
 * the node's own block time; the subscriber count is raised in steps, and at
 * each step the simulated peers (capacityPeers.ts, in worker threads) receive,
 * verify and apply every pushed message with the SDK's own code.
 *
 * Per step it reports the stage times (median, p95, max), pushes delivered
 * against expected, skipped blocks, refusals, ended subscriptions, whether
 * the end-to-end lag grew over the step, peers the node refused to open,
 * bytes sent, fallback read times, the
 * node's CPU and memory (when the node runs here), and how busy the peer
 * threads were. A step counts as sustained when no push was missing, skipped
 * or refused, no subscription ended, every peer opened, and the median end-to-end lag of the
 * step's last third is not above its first third's by a block time or more.
 * It also reports the time each peer's thread spent verifying and applying a
 * push, the stage times of the peer whose median end-to-end lag was highest,
 * and the peer threads' heap above what they used before any peer, with what
 * each peer added since the previous step costs.
 *
 *   PEER3_NODE_BIN=<zero-fee-node> yarn bench:light-client:capacity
 *
 * BENCH_NODE_URL: a node already running elsewhere (its CPU and memory are
 * then measured on its host); BENCH_STEPS (10,25,50,100,200): subscriber
 * counts; BENCH_STEP_SECONDS (60); BENCH_WARMUP_SECONDS (10);
 * BENCH_CHANNELS (20): channels, peer i follows channel i mod CHANNELS, so
 * more subscribers than channels share partitions; BENCH_BUSY_FRACTION (0.5):
 * channels written each block, the rest idle; BENCH_FALLBACK_FRACTION (0.1):
 * peers that also prove one key outside their partition each block;
 * BENCH_WORKERS (half the CPUs): peer threads, per host with BENCH_PEER_HOSTS.
 *
 * A workload calibrated from the channel flows (scripts/bench/lightClientFlows.ts):
 * BENCH_PARTITION_KEYS (1): slots each channel's partition holds;
 * BENCH_WRITES_PER_BLOCK (1): of those, slots a busy channel writes per block;
 * BENCH_PEERS_PER_CHANNEL (0): when set, peer i follows channel
 * floor(i / PEERS_PER_CHANNEL), so every step keeps that many peers per
 * channel; BENCH_WATCHED_KEYS (0): when set, each peer also follows the
 * contract with a subscription of no topics and watches that many config
 * slots on it; BENCH_WATCH_FRESH (0): the chance, per block of its channel,
 * that a peer then watches one never written slot (1: every block);
 * BENCH_WATCH_PREFILL (0): never written slots each peer watches with the
 * config slots, as a long-running peer has gathered them (50 + 974 reaches
 * the node's 1,024 per subscription). With more
 * than one key per partition or per write, or with watched keys, the
 * partitions are written by MULTI_PARTITION_CONTRACT, one transaction per
 * channel. BENCH_BUSY_CHANNELS: channels written each block, in place of
 * BENCH_BUSY_FRACTION; BENCH_STOP_AT_MISS (0): with 1, the ramp ends after its
 * first step that is not sustained. Channels are set up as the steps need
 * them, before each step, at most BENCH_SETUP_PER_BLOCK (all of a batch) per
 * block: the node's paid lane raises its price floor above the fixture's gas
 * price when a run of blocks books more than its target. BENCH_CONTRACT: the
 * partition contract an earlier run on BENCH_NODE_URL set up, with
 * BENCH_CHANNELS_READY of its channels; nothing is deployed or set up again.
 *
 * BENCH_PEER_HOSTS: ssh hosts that run the peers instead of this machine, each
 * through capacityPeerHost.ts in its checkout BENCH_PEER_HOST_DIR, with
 * BENCH_PEER_HOST_NODE (node) as node.js, reaching the node at
 * BENCH_PEER_NODE_URL. Peers are spread over every host's threads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PEER3_LIGHT_CLIENT_CHAIN } from "@/evm/p2pRuntime/rpcNodes/lightClient/LightClientChain";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import {
    LightClientNodeFixture,
    PARTITION_CONTRACT
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { concat, getAddress, toBeHex } from "ethers";
import type { PeerReport, PeerSpec, PushSample } from "./capacityPeers";
import { PeerHost, type PeerThread, PeerWorker } from "./peerThreads";
import {
    hostDescription,
    percentile,
    processUsage,
    sleep,
    spread
} from "./benchUtils";

const STEPS = (process.env.BENCH_STEPS ?? "10,25,50,100,200")
    .split(",")
    .map(Number);
const STEP_SECONDS = Number(process.env.BENCH_STEP_SECONDS ?? 60);
const WARMUP_SECONDS = Number(process.env.BENCH_WARMUP_SECONDS ?? 10);
const CHANNELS = Number(process.env.BENCH_CHANNELS ?? 20);
const BUSY_FRACTION = Number(process.env.BENCH_BUSY_FRACTION ?? 0.5);
const FALLBACK_FRACTION = Number(process.env.BENCH_FALLBACK_FRACTION ?? 0.1);
const WORKERS = Number(
    process.env.BENCH_WORKERS ?? Math.max(1, Math.floor(os.cpus().length / 2))
);
const BLOCK_TIME_MS = PEER3_LIGHT_CLIENT_CHAIN.blockTimeMs;
/** Channel writes sent at once while the partitions are set up. */
const SETUP_BATCH = 200;
const PEER_HOSTS =
    process.env.BENCH_PEER_HOSTS?.split(",").filter(Boolean) ?? [];
const PARTITION_KEYS = Number(process.env.BENCH_PARTITION_KEYS ?? 1);
const WRITES_PER_BLOCK = Number(process.env.BENCH_WRITES_PER_BLOCK ?? 1);
const PEERS_PER_CHANNEL = Number(process.env.BENCH_PEERS_PER_CHANNEL ?? 0);
const WATCHED_KEYS = Number(process.env.BENCH_WATCHED_KEYS ?? 0);
const WATCH_FRESH = Number(process.env.BENCH_WATCH_FRESH ?? 0);
const WATCH_PREFILL = Number(process.env.BENCH_WATCH_PREFILL ?? 0);
const BUSY_CHANNELS =
    process.env.BENCH_BUSY_CHANNELS === undefined
        ? undefined
        : Number(process.env.BENCH_BUSY_CHANNELS);
const STOP_AT_MISS = process.env.BENCH_STOP_AT_MISS === "1";
const SETUP_PER_BLOCK = Number(process.env.BENCH_SETUP_PER_BLOCK ?? 0);
const GIVEN_CONTRACT = process.env.BENCH_CONTRACT;
const CHANNELS_READY = Number(process.env.BENCH_CHANNELS_READY ?? 0);
const MULTI_SLOT =
    PARTITION_KEYS > 1 || WRITES_PER_BLOCK > 1 || WATCHED_KEYS > 0;
/** Slots of channel c start at CHANNEL_SLOTS + c * CHANNEL_SLOT_STRIDE. */
const CHANNEL_SLOTS = 0x100000;
const CHANNEL_SLOT_STRIDE = 0x1000;
/** The config slots peers watch, and the never written slots they watch one per block (per peer). */
const CONFIG_SLOTS = 0x10000000;
const FRESH_SLOTS = 0x20000000;
const FRESH_SLOTS_PER_PEER = 0x10000;
/** The topic the config slots are written with, which no peer follows. */
const CONFIG_TOPIC = toBeHex(0xc0ffee, 32);

/**
 * A partition contract whose writes take `count` slots: with 128 bytes of
 * calldata `topic, first, count, add` it stores `sload(slot) + add` at slots
 * `first` to `first + count - 1` and logs with topics 1 and `topic`, as
 * PARTITION_CONTRACT; with 32 bytes it returns the slot they name.
 */
const MULTI_PARTITION_CONTRACT =
    "0x603d80600b6000396000f3" +
    "36608014601357" + // calldata of 128 bytes: write
    "6000355460005260206000f3" + // else return sload(calldata[0])
    "5b604035" + // i = count
    "5b8015603157" + // loop: i == 0 -> end
    "6001900380602035018054606035019055" + // i -= 1; slot = first + i; sstore(slot, sload(slot) + add)
    "601756" + // to the loop
    "5b600035600160006000a200"; // end: log2(topic 1, topic); stop

function multiWrite(topic: string, first: number, count: number): string {
    return concat([
        topic,
        toBeHex(first, 32),
        toBeHex(count, 32),
        toBeHex(1, 32)
    ]);
}

/** Gas for a MULTI_PARTITION_CONTRACT write of `slots` slots: a new slot costs 22,100, the loop and log the rest. */
function multiWriteGas(slots: number): bigint {
    return BigInt(60_000 + slots * 26_000);
}

/** `count` distinct numbers below `below`, at random. */
function distinctRandom(count: number, below: number): number[] {
    const picked = new Set<number>();
    while (picked.size < count) picked.add(Math.floor(Math.random() * below));
    return [...picked];
}

function channelSlots(channel: number): number {
    return CHANNEL_SLOTS + channel * CHANNEL_SLOT_STRIDE;
}

function channelOf(peer: number): number {
    return PEERS_PER_CHANNEL > 0
        ? Math.floor(peer / PEERS_PER_CHANNEL)
        : peer % CHANNELS;
}

function channelId(index: number): string {
    return toBeHex(0xc0000 + index, 32);
}

function stepResult(
    subscribers: number,
    durationMs: number,
    /** The step's blocks: after the first, up to and including the last. */
    { firstBlock, lastBlock }: { firstBlock: number; lastBlock: number },
    reports: PeerReport[],
    nodeSamples: { cpuSeconds: number; rssKb: number; at: number }[]
) {
    const blocks = lastBlock - firstBlock;
    const pushes = reports
        .flatMap((report) => report.pushes)
        .filter(
            (push) =>
                !push.sync &&
                push.number > firstBlock &&
                push.number <= lastBlock
        );
    const endToEnd = (push: PushSample) =>
        push.executedAt === null ? null : push.verifiedAt - push.executedAt;
    const byTime = [...pushes].sort((a, b) => a.receivedAt - b.receivedAt);
    const third = Math.max(1, Math.floor(byTime.length / 3));
    const lags = (part: PushSample[]) =>
        part.flatMap((push) => {
            const lag = endToEnd(push);
            return lag === null ? [] : [lag];
        });
    const stages = (part: PushSample[]) => ({
        build: spread(
            part.flatMap((p) =>
                p.executedAt === null ? [] : [p.builtAt - p.executedAt]
            )
        ),
        dispatch: spread(part.map((p) => p.sentAt - p.builtAt)),
        transit: spread(part.map((p) => p.receivedAt - p.sentAt)),
        verify: spread(part.map((p) => p.verifiedAt - p.receivedAt)),
        accept: spread(part.map((p) => p.acceptMs)),
        endToEnd: spread(lags(part))
    });
    // peer id -> its pushes of the step
    const byPeer = new Map<number, PushSample[]>();
    for (const push of pushes)
        byPeer.set(push.peer, [...(byPeer.get(push.peer) ?? []), push]);
    const slowest = [...byPeer].reduce<
        { peer: number; lag: number } | undefined
    >((worst, [peer, own]) => {
        const lag = percentile(lags(own), 0.5);
        return lag !== null && (worst === undefined || lag > worst.lag)
            ? { peer, lag }
            : worst;
    }, undefined);
    const pushCost = (part: PushSample[]) => ({
        pushes: part.length,
        bytesPerPush: spread(part.map((p) => p.bytes)),
        newProofNodesPerPush: spread(part.map((p) => p.newNodes)),
        acceptMs: spread(part.map((p) => p.acceptMs))
    });
    const hostedPeers = reports.reduce((n, r) => n + r.peers, 0);
    const firstThirdLag = percentile(lags(byTime.slice(0, third)), 0.5);
    const lastThirdLag = percentile(lags(byTime.slice(-third)), 0.5);
    const lagGrew =
        firstThirdLag !== null &&
        lastThirdLag !== null &&
        lastThirdLag - firstThirdLag >= BLOCK_TIME_MS;
    const expectedPushes = subscribers * blocks;
    // blocks of the step with fewer pushes than subscribers: where a miss happened
    const perBlock = new Map<number, number>();
    for (const push of pushes)
        perBlock.set(push.number, (perBlock.get(push.number) ?? 0) + 1);
    const blocksShort = Array.from(
        { length: blocks },
        (_, index) => firstBlock + 1 + index
    )
        .map((number) => ({
            number,
            pushes: perBlock.get(number) ?? 0
        }))
        .filter(({ pushes: count }) => count < subscribers);
    const inStep = (push: PushSample) =>
        !push.sync && push.number > firstBlock && push.number <= lastBlock;
    const watch =
        WATCHED_KEYS > 0
            ? {
                  pushes: reports.flatMap((r) => r.watchPushes).filter(inStep),
                  expected: subscribers * blocks,
                  skippedBlocks: reports.reduce(
                      (n, r) => n + r.watchSkippedBlocks,
                      0
                  ),
                  refused: reports.reduce((n, r) => n + r.watchRefused, 0),
                  ended: reports.reduce((n, r) => n + r.watchEnded, 0),
                  failedRegistrations: reports.reduce(
                      (n, r) => n + r.failedWatchRegistrations,
                      0
                  ),
                  failedWatches: reports.reduce(
                      (n, r) => n + r.failedWatches,
                      0
                  ),
                  keysNotWatched: reports.reduce(
                      (n, r) => n + r.keysNotWatched,
                      0
                  )
              }
            : undefined;
    const skippedBlocks = reports.reduce((n, r) => n + r.skippedBlocks, 0);
    const refused = reports.reduce((n, r) => n + r.refused, 0);
    const ended = reports.reduce((n, r) => n + r.ended, 0);
    const unopened = reports.reduce((n, r) => n + r.unopened, 0);
    const cpuPercent =
        nodeSamples.length < 2
            ? null
            : nodeSamples.slice(1).map((sample, index) => {
                  const before = nodeSamples[index];
                  return (
                      (100 * (sample.cpuSeconds - before.cpuSeconds) * 1000) /
                      (sample.at - before.at)
                  );
              });
    return {
        subscribers,
        durationSeconds: durationMs / 1000,
        blocks,
        pushes: {
            delivered: pushes.length,
            expected: expectedPushes,
            skippedBlocks,
            refused,
            ended,
            unopened,
            blocksShort
        },
        stagesMs: stages(pushes),
        // the peer with the highest median end-to-end lag, by stage: where it waited
        slowestPeer: slowest && {
            peer: slowest.peer,
            stagesMs: stages(byPeer.get(slowest.peer)!)
        },
        // the peer threads' heap above what they used before any peer
        peerHeap: {
            peers: hostedPeers,
            bytes: reports.reduce((n, r) => n + r.heapAbovePeerlessBytes, 0)
        },
        lagMedianMs: { firstThird: firstThirdLag, lastThird: lastThirdLag },
        bytes: {
            perSecond: Math.round(
                pushes.reduce((n, p) => n + p.bytes, 0) / (durationMs / 1000)
            ),
            perPush: spread(pushes.map((p) => p.bytes)),
            newProofNodesPerPush: spread(pushes.map((p) => p.newNodes))
        },
        // a partition whose contract slots kept their values while its proof
        // path moved with other partitions' writes, against pushes that
        // changed a slot of it
        unchangedValuesWithNewProofNodes: pushCost(
            pushes.filter((p) => p.contractValues === 0 && p.newNodes > 0)
        ),
        changedValues: pushCost(pushes.filter((p) => p.contractValues > 0)),
        initialSyncMs: spread(reports.flatMap((r) => r.syncMs)),
        fallbackReadMs: spread(reports.flatMap((r) => r.fallbackReadMs)),
        failedFallbackReads: reports.reduce(
            (n, r) => n + r.failedFallbackReads,
            0
        ),
        // the subscriptions of no topics and their watch calls (BENCH_WATCHED_KEYS)
        watch: watch && {
            pushes: {
                delivered: watch.pushes.length,
                expected: watch.expected,
                skippedBlocks: watch.skippedBlocks,
                refused: watch.refused,
                ended: watch.ended
            },
            stagesMs: stages(watch.pushes),
            bytesPerPush: spread(watch.pushes.map((p) => p.bytes)),
            registrationMs: spread(
                reports.flatMap((r) => r.watchRegistrationMs)
            ),
            failedRegistrations: watch.failedRegistrations,
            freshWatchMs: spread(reports.flatMap((r) => r.watchMs)),
            freshWatches: reports.reduce((n, r) => n + r.watchMs.length, 0),
            failedWatches: watch.failedWatches,
            keysNotWatched: watch.keysNotWatched
        },
        node:
            nodeSamples.length === 0
                ? null
                : {
                      cpuPercent: cpuPercent && spread(cpuPercent),
                      rssMbMax: Math.round(
                          Math.max(...nodeSamples.map((s) => s.rssKb)) / 1024
                      )
                  },
        peerThreadsBusyMax: Math.max(
            ...reports.map((r) => r.eventLoopUtilization)
        ),
        sustained:
            pushes.length >= expectedPushes &&
            skippedBlocks === 0 &&
            refused === 0 &&
            ended === 0 &&
            unopened === 0 &&
            !lagGrew &&
            (watch === undefined ||
                (watch.pushes.length >= watch.expected &&
                    watch.skippedBlocks === 0 &&
                    watch.refused === 0 &&
                    watch.ended === 0 &&
                    watch.failedRegistrations === 0 &&
                    watch.failedWatches === 0))
    };
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is needed with BENCH_PEER_HOSTS`);
    return value;
}

async function main(): Promise<void> {
    if (
        PEERS_PER_CHANNEL > 0 &&
        Math.ceil(Math.max(...STEPS) / PEERS_PER_CHANNEL) > CHANNELS
    )
        throw new Error(
            "BENCH_CHANNELS is below the last step's subscribers / BENCH_PEERS_PER_CHANNEL"
        );
    const external = process.env.BENCH_NODE_URL;
    const node = external
        ? await LightClientNodeFixture.attach(external)
        : await LightClientNodeFixture.start();
    const workers: PeerThread[] = [];
    const peerHosts: PeerHost[] = [];
    let writing = true;
    let writer: Promise<void> = Promise.resolve();
    try {
        await node.firstBlockSealed();
        const contract =
            GIVEN_CONTRACT ??
            (await node.deploy(
                MULTI_SLOT ? MULTI_PARTITION_CONTRACT : PARTITION_CONTRACT
            ));
        console.log(`partition contract ${contract}`);
        // the channel's partition: its slots, written once with its topic
        const setUpChannel = (channel: number) =>
            MULTI_SLOT
                ? node.transact(
                      contract,
                      multiWrite(
                          channelId(channel),
                          channelSlots(channel),
                          PARTITION_KEYS
                      ),
                      multiWriteGas(PARTITION_KEYS)
                  )
                : node.readWriteLog(
                      contract,
                      channelId(channel),
                      0,
                      channel + 1,
                      1
                  );
        // a busy channel's writes of one block
        const writeChannel = (channel: number) =>
            MULTI_SLOT
                ? node.transact(
                      contract,
                      multiWrite(
                          channelId(channel),
                          channelSlots(channel),
                          WRITES_PER_BLOCK
                      ),
                      multiWriteGas(WRITES_PER_BLOCK)
                  )
                : node.readWriteLog(
                      contract,
                      channelId(channel),
                      channel + 1,
                      channel + 1,
                      1
                  );
        if (WATCHED_KEYS > 0 && !GIVEN_CONTRACT)
            await node.transact(
                contract,
                multiWrite(CONFIG_TOPIC, CONFIG_SLOTS, WATCHED_KEYS),
                multiWriteGas(WATCHED_KEYS)
            );
        // a contract outside every partition, which fallback reads prove
        const other = await node.deploy(PARTITION_CONTRACT);
        await node.readWriteLog(other, channelId(CHANNELS), 0, 1, 1);
        // a channel's partition exists before its peers subscribe; set up as
        // the steps need them, in batches, since the node's pool drops what
        // one sender queues past its limits
        let channelsReady = GIVEN_CONTRACT ? CHANNELS_READY : 0;
        // the channels the current step's peers follow: the writer picks
        // among these, also when an earlier run set up more (BENCH_CONTRACT)
        let channelsInUse = 0;
        const setUpChannels = async (count: number) => {
            channelsInUse = count;
            while (channelsReady < count) {
                const batch = Math.min(
                    SETUP_PER_BLOCK > 0 ? SETUP_PER_BLOCK : SETUP_BATCH,
                    count - channelsReady
                );
                await Promise.all(
                    Array.from({ length: batch }, (_, offset) =>
                        setUpChannel(channelsReady + offset)
                    )
                );
                channelsReady += batch;
            }
            console.log(`channels ready ${channelsReady}`);
        };
        const fallbackKey = contractStorageKey(
            getAddress(other),
            toBeHex(1, 32)
        );

        // the workload: each block, a random share of the channels is written
        // numbers of the blocks that carried a write
        const writtenBlocks = new Set<number>();
        writer = (async () => {
            while (writing) {
                // BUSY_CHANNELS of the ready channels in use, or each with BUSY_FRACTION
                const ready = Math.min(channelsReady, channelsInUse);
                const busy =
                    BUSY_CHANNELS === undefined
                        ? Array.from({ length: ready }, (_, c) => c).filter(
                              () => Math.random() < BUSY_FRACTION
                          )
                        : distinctRandom(Math.min(BUSY_CHANNELS, ready), ready);
                const receipts = await Promise.all(busy.map(writeChannel));
                for (const receipt of receipts)
                    writtenBlocks.add(receipt.blockNumber);
                if (busy.length === 0) await sleep(BLOCK_TIME_MS);
            }
        })();

        if (PEER_HOSTS.length === 0)
            for (let index = 0; index < WORKERS; index++)
                workers.push(new PeerWorker(node.url));
        for (const host of PEER_HOSTS) {
            const peerHost = PeerHost.start(host, {
                dir: requiredEnv("BENCH_PEER_HOST_DIR"),
                node: process.env.BENCH_PEER_HOST_NODE ?? "node",
                nodeUrl: requiredEnv("BENCH_PEER_NODE_URL"),
                threads: WORKERS
            });
            peerHosts.push(peerHost);
            workers.push(...peerHost.threads);
        }
        const fallbackEvery =
            FALLBACK_FRACTION > 0 ? Math.round(1 / FALLBACK_FRACTION) : 0;
        const steps = [];
        /** The peer threads' heap at the previous step. */
        let previousHeap: { peers: number; bytes: number } | undefined;
        let opened = 0;
        for (const subscribers of STEPS) {
            await setUpChannels(
                Math.min(
                    CHANNELS,
                    PEERS_PER_CHANNEL > 0
                        ? Math.ceil(subscribers / PEERS_PER_CHANNEL)
                        : subscribers
                )
            );
            const added: PeerSpec[][] = workers.map(() => []);
            for (; opened < subscribers; opened++)
                added[opened % workers.length].push({
                    id: opened,
                    contract,
                    channel: channelId(channelOf(opened)),
                    ...(fallbackEvery > 0 &&
                        opened % fallbackEvery === 0 && { fallbackKey }),
                    ...(WATCHED_KEYS > 0 && {
                        watch: {
                            configBase: CONFIG_SLOTS,
                            configCount: WATCHED_KEYS,
                            ...((WATCH_FRESH > 0 || WATCH_PREFILL > 0) && {
                                freshBase:
                                    FRESH_SLOTS + opened * FRESH_SLOTS_PER_PEER,
                                prefill: WATCH_PREFILL
                            }),
                            ...(WATCH_FRESH > 0 && { freshRate: WATCH_FRESH })
                        }
                    })
                });
            await Promise.all(
                workers.map((worker, index) =>
                    worker.ask({ type: "add", peers: added[index] })
                )
            );
            await sleep(WARMUP_SECONDS * 1000);
            // what the warm-up recorded is dropped, the initial syncs kept
            const warmup = await Promise.all(
                workers.map((worker) =>
                    worker.ask<{ report: PeerReport }>({ type: "take" })
                )
            );
            // a block whose pushes the warm-up already took belongs to it, even
            // when the node's block number does not show that block yet
            const firstBlock = Math.max(
                await node.provider.getBlockNumber(),
                ...warmup.flatMap(({ report }) =>
                    [...report.pushes, ...report.watchPushes].map(
                        (push) => push.number
                    )
                )
            );
            const started = Date.now();
            const nodeSamples: {
                cpuSeconds: number;
                rssKb: number;
                at: number;
            }[] = [];
            while (Date.now() - started < STEP_SECONDS * 1000) {
                if (!external)
                    nodeSamples.push({
                        ...processUsage(node.pid),
                        at: Date.now()
                    });
                await sleep(1000);
            }
            const lastBlock = await node.provider.getBlockNumber();
            // the last block's pushes may still be on their way
            await sleep(BLOCK_TIME_MS);
            const reports = (
                await Promise.all(
                    workers.map((worker) =>
                        worker.ask<{ report: PeerReport }>({ type: "take" })
                    )
                )
            ).map(({ report }) => report);
            // the initial syncs, refused opens and watch registrations happened in the warm-up
            reports.forEach((report, index) => {
                report.syncMs.push(...warmup[index].report.syncMs);
                report.unopened += warmup[index].report.unopened;
                // so are the registrations of the watched config slots
                report.watchRegistrationMs.push(
                    ...warmup[index].report.watchRegistrationMs
                );
                report.failedWatchRegistrations +=
                    warmup[index].report.failedWatchRegistrations;
            });
            const result = stepResult(
                subscribers,
                Date.now() - started,
                { firstBlock, lastBlock },
                reports,
                nodeSamples
            );
            // what each peer added since the previous step costs the peer threads
            steps.push({
                ...result,
                peerHeapBytesPerAddedPeer:
                    previousHeap === undefined
                        ? null
                        : Math.round(
                              (result.peerHeap.bytes - previousHeap.bytes) /
                                  (result.peerHeap.peers - previousHeap.peers)
                          )
            });
            previousHeap = result.peerHeap;
            console.log(
                `${subscribers} subscribers: delivered ${result.pushes.delivered}/${result.pushes.expected}, ` +
                    `end-to-end median ${result.stagesMs.endToEnd.median} ms p95 ${result.stagesMs.endToEnd.p95} ms, ` +
                    `node CPU median ${result.node?.cpuPercent?.median ?? "n/a"}%, ` +
                    `${Math.round(result.bytes.perSecond / 1024)} KiB/s, ` +
                    (result.watch
                        ? `watch pushes ${result.watch.pushes.delivered}/${result.watch.pushes.expected}, ` +
                          `fresh watches ${result.watch.freshWatches} (median ${result.watch.freshWatchMs.median} ms, failed ${result.watch.failedWatches}), `
                        : "") +
                    `sustained ${result.sustained}`
            );
            if (STOP_AT_MISS && !result.sustained) break;
        }

        const dir = path.join(
            "logs",
            "bench",
            `light-client-capacity-${new Date().toISOString().replace(/[:.]/g, "-")}`
        );
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            path.join(dir, "results.json"),
            JSON.stringify(
                {
                    run: {
                        date: new Date().toISOString(),
                        host: hostDescription(),
                        node: external
                            ? { url: "external", measuredHere: false }
                            : {
                                  binary: process.env.PEER3_NODE_BIN,
                                  measuredHere: true
                              },
                        parameters: {
                            STEPS,
                            STEP_SECONDS,
                            WARMUP_SECONDS,
                            CHANNELS,
                            BUSY_FRACTION,
                            FALLBACK_FRACTION,
                            PARTITION_KEYS,
                            WRITES_PER_BLOCK,
                            PEERS_PER_CHANNEL,
                            WATCHED_KEYS,
                            WATCH_FRESH,
                            WATCH_PREFILL,
                            BUSY_CHANNELS,
                            STOP_AT_MISS,
                            WORKERS,
                            PEER_HOSTS,
                            BLOCK_TIME_MS
                        },
                        contract,
                        channelsReady,
                        blocksWritten: writtenBlocks.size
                    },
                    steps
                },
                null,
                2
            )
        );
        console.log(`results: ${dir}/results.json`);
    } finally {
        writing = false;
        // a write in flight finishes before the node stops; one the node
        // never includes must not hide the error that ended the run
        await Promise.race([
            writer.catch(() => undefined),
            sleep(30_000).then(() =>
                console.error("the writer's last writes did not finish")
            )
        ]);
        await Promise.all(workers.map((worker) => worker.close()));
        await Promise.all(peerHosts.map((peerHost) => peerHost.close()));
        await node.stop();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
