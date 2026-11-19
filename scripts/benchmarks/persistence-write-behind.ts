// yarn ts-node -r tsconfig-paths/register scripts/benchmarks/persistence-write-behind.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { ClassicLevel } from "classic-level";
import { ethers } from "ethers";
import { MemoryLevel } from "memory-level";

import type { PersistenceDatabaseHandle } from "../../src/storage/persistence";
import { Storage } from "../../src/storage/Storage";
import * as factory from "../../test/factory";

const RUNS = 5;
const BLOCKS = [100, 1_000];

type Backend = "memory-level" | "classic-level";
// write-behind: N stores, then one flush; flush-per-block: store, then await flush (sign -> flush -> broadcast)
type Mode = "write-behind" | "flush-per-block";

async function openHandle(backend: Backend): Promise<{
    handle: PersistenceDatabaseHandle;
    cleanup: () => Promise<void>;
}> {
    if (backend === "memory-level") {
        const database = new MemoryLevel<string, string>();
        return {
            handle: {
                database,
                location: "memory",
                close: () => database.close(),
                destroy: () => database.clear()
            },
            cleanup: async () => undefined
        };
    }
    const root = await mkdtemp(path.join(tmpdir(), "persistence-bench-"));
    const database = new ClassicLevel<string, string>(root);
    return {
        handle: {
            database,
            location: root,
            close: () => database.close(),
            destroy: () => ClassicLevel.destroy(root)
        },
        cleanup: () => rm(root, { recursive: true, force: true })
    };
}

async function run(backend: Backend, mode: Mode, count: number) {
    const forkId = ethers.hexlify(ethers.randomBytes(32));
    const blocks = Array.from({ length: count }, (_, height) =>
        factory.blockAt(forkId, height)
    );
    const { handle, cleanup } = await openHandle(backend);
    const storage = new Storage(undefined, undefined, {
        flushIntervalMs: 60_000
    });
    let batches = 0;
    const batch = handle.database.batch.bind(handle.database);
    handle.database.batch = ((...args: Parameters<typeof batch>) => {
        batches++;
        return batch(...args);
    }) as typeof handle.database.batch;
    await storage.open(handle, () => undefined);

    let storeMs = 0;
    let flushMs = 0;
    const startedAt = performance.now();
    for (const block of blocks) {
        const storedAt = performance.now();
        storage.blocks.storeBlock(block);
        storeMs += performance.now() - storedAt;
        if (mode === "flush-per-block") {
            const flushedAt = performance.now();
            await storage.flush();
            flushMs += performance.now() - flushedAt;
        }
    }
    const flushedAt = performance.now();
    await storage.flush();
    flushMs += performance.now() - flushedAt;
    const totalMs = performance.now() - startedAt;
    await storage.close();
    await cleanup();
    return {
        storeBlockMs: storeMs / count,
        flushMs: mode === "flush-per-block" ? flushMs / count : flushMs,
        blocksPerSecond: (count / totalMs) * 1_000,
        batches
    };
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

async function main(): Promise<void> {
    const rows = [
        "| backend | mode | blocks | storeBlock ms | flush ms | blocks/s | batches |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |"
    ];
    for (const backend of ["memory-level", "classic-level"] as const) {
        for (const mode of ["write-behind", "flush-per-block"] as const) {
            for (const count of BLOCKS) {
                const samples = [await run(backend, mode, count)];
                for (let index = 1; index < RUNS; index++) {
                    samples.push(await run(backend, mode, count));
                }
                const pick = (field: keyof (typeof samples)[number]) =>
                    median(samples.map((sample) => sample[field])).toFixed(3);
                rows.push(
                    `| ${backend} | ${mode} | ${count} | ${pick("storeBlockMs")} | ${pick("flushMs")} | ${pick("blocksPerSecond")} | ${pick("batches")} |`
                );
            }
        }
    }
    console.log(`Node ${process.version}, median of ${RUNS} runs`);
    console.log(rows.join("\n"));
}

void main();
