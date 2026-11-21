/**
 * Light client capacity benchmark (docs/light-client-report.md): how many
 * subscribers one RPC node serves. A writer keeps a block workload going at
 * the node's own block time; the subscriber count is raised in steps, and at
 * each step the simulated peers (capacityPeers.ts, in worker threads) receive,
 * verify and apply every pushed message with the SDK's own code.
 *
 * Per step it reports the stage times (median, p95, max), pushes delivered
 * against expected, skipped blocks, refusals, ended subscriptions, whether
 * the end-to-end lag grew over the step, bytes sent, fallback read times, the
 * node's CPU and memory (when the node runs here), and how busy the peer
 * threads were. A step counts as sustained when no push was missing, skipped
 * or refused, no subscription ended, and the median end-to-end lag of the
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
 * BENCH_WORKERS (half the CPUs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { PEER3_LIGHT_CLIENT_CHAIN } from "@/evm/p2pRuntime/rpcNodes/lightClient/LightClientChain";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import {
    LightClientNodeFixture,
    PARTITION_CONTRACT
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { getAddress, toBeHex } from "ethers";
import type { PeerReport, PeerSpec, PushSample } from "./capacityPeers";
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

function channelId(index: number): string {
    return toBeHex(0xc0000 + index, 32);
}

/** A worker thread hosting peers, and a way to wait for its next answer. */
class PeerWorker {
    readonly worker: Worker;
    private readonly waiting: ((message: { type: string }) => void)[] = [];

    constructor(nodeUrl: string) {
        this.worker = new Worker(require.resolve("./capacityPeers.ts"), {
            workerData: { nodeUrl },
            execArgv: [
                "-r",
                "ts-node/register/transpile-only",
                "-r",
                "tsconfig-paths/register"
            ],
            env: { ...process.env, TS_NODE_PROJECT: "tsconfig.json" }
        });
        this.worker.on("message", (message: { type: string }) =>
            this.waiting.shift()?.(message)
        );
    }

    ask<T>(message: unknown): Promise<T> {
        return new Promise((resolve) => {
            this.waiting.push((answer) => resolve(answer as T));
            this.worker.postMessage(message);
        });
    }
}

function stepResult(
    subscribers: number,
    durationMs: number,
    blocks: number,
    reports: PeerReport[],
    nodeSamples: { cpuSeconds: number; rssKb: number; at: number }[]
) {
    const pushes = reports
        .flatMap((report) => report.pushes)
        .filter((push) => !push.sync);
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
    const hostedPeers = reports.reduce((n, r) => n + r.peers, 0);
    const firstThirdLag = percentile(lags(byTime.slice(0, third)), 0.5);
    const lastThirdLag = percentile(lags(byTime.slice(-third)), 0.5);
    const lagGrew =
        firstThirdLag !== null &&
        lastThirdLag !== null &&
        lastThirdLag - firstThirdLag >= BLOCK_TIME_MS;
    const expectedPushes = subscribers * blocks;
    const skippedBlocks = reports.reduce((n, r) => n + r.skippedBlocks, 0);
    const refused = reports.reduce((n, r) => n + r.refused, 0);
    const ended = reports.reduce((n, r) => n + r.ended, 0);
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
            ended
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
        initialSyncMs: spread(reports.flatMap((r) => r.syncMs)),
        fallbackReadMs: spread(reports.flatMap((r) => r.fallbackReadMs)),
        failedFallbackReads: reports.reduce(
            (n, r) => n + r.failedFallbackReads,
            0
        ),
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
            !lagGrew
    };
}

async function main(): Promise<void> {
    const external = process.env.BENCH_NODE_URL;
    const node = external
        ? await LightClientNodeFixture.attach(external)
        : await LightClientNodeFixture.start();
    const workers: PeerWorker[] = [];
    let writing = true;
    let writer: Promise<void> = Promise.resolve();
    try {
        await node.firstBlockSealed();
        const contract = await node.deploy(PARTITION_CONTRACT);
        // a contract outside every partition, which fallback reads prove
        const other = await node.deploy(PARTITION_CONTRACT);
        await node.readWriteLog(other, channelId(CHANNELS), 0, 1, 1);
        // every channel's partition exists before peers subscribe
        await Promise.all(
            Array.from({ length: CHANNELS }, (_, channel) =>
                node.readWriteLog(
                    contract,
                    channelId(channel),
                    0,
                    channel + 1,
                    1
                )
            )
        );
        const fallbackKey = contractStorageKey(
            getAddress(other),
            toBeHex(1, 32)
        );

        // the workload: each block, a random share of the channels is written
        // numbers of the blocks that carried a write
        const writtenBlocks = new Set<number>();
        writer = (async () => {
            while (writing) {
                const busy = Array.from(
                    { length: CHANNELS },
                    (_, channel) => channel
                ).filter(() => Math.random() < BUSY_FRACTION);
                const receipts = await Promise.all(
                    busy.map((channel) =>
                        node.readWriteLog(
                            contract,
                            channelId(channel),
                            channel + 1,
                            channel + 1,
                            1
                        )
                    )
                );
                for (const receipt of receipts)
                    writtenBlocks.add(receipt.blockNumber);
                if (busy.length === 0) await sleep(BLOCK_TIME_MS);
            }
        })();

        for (let index = 0; index < WORKERS; index++)
            workers.push(new PeerWorker(node.url));
        const fallbackEvery =
            FALLBACK_FRACTION > 0 ? Math.round(1 / FALLBACK_FRACTION) : 0;
        const steps = [];
        /** The peer threads' heap at the previous step. */
        let previousHeap: { peers: number; bytes: number } | undefined;
        let opened = 0;
        for (const subscribers of STEPS) {
            const added: PeerSpec[][] = workers.map(() => []);
            for (; opened < subscribers; opened++)
                added[opened % WORKERS].push({
                    id: opened,
                    contract,
                    channel: channelId(opened % CHANNELS),
                    ...(fallbackEvery > 0 &&
                        opened % fallbackEvery === 0 && { fallbackKey })
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
            const firstBlock = await node.provider.getBlockNumber();
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
            const reports = (
                await Promise.all(
                    workers.map((worker) =>
                        worker.ask<{ report: PeerReport }>({ type: "take" })
                    )
                )
            ).map(({ report }) => report);
            reports.forEach((report, index) =>
                report.syncMs.push(...warmup[index].report.syncMs)
            );
            const result = stepResult(
                subscribers,
                Date.now() - started,
                lastBlock - firstBlock,
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
                    `${Math.round(result.bytes.perSecond / 1024)} KiB/s, sustained ${result.sustained}`
            );
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
                            WORKERS,
                            BLOCK_TIME_MS
                        },
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
        // a write in flight finishes before the node stops
        await writer.catch(() => undefined);
        await Promise.all(
            workers.map(async (worker) => {
                await worker.ask({ type: "stop" });
                await worker.worker.terminate();
            })
        );
        await node.stop();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
