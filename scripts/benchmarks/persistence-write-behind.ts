import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ClassicLevel } from "classic-level";
import { MemoryLevel } from "memory-level";

import {
    PersistenceController,
    PersistentCollection,
    type PersistenceBatchOperation,
    type PersistenceDatabase,
    type PersistenceDatabaseHandle
} from "../../src/storage/persistence";
import { createStorageRecordCodec } from "../../src/storage/persistence/storageCodecs";

const WARMUPS = 5;
const MEASURED_RUNS = 30;
const WORKLOAD_SIZES = [10, 100, 1_000] as const;
const OUTPUT_DIRECTORY = path.resolve(
    "temp/plan-implementations/16-write-behind-persistence"
);

type Backend = "MemoryLevel" | "ClassicLevel";
type Mode = "database-first" | "write-behind";
type Workload = "distinct" | "repeated" | "canonical-transition";
type Sample = {
    backend: Backend;
    mode: Mode;
    workload: Workload;
    writes: number;
    mutationCallMs: number;
    totalMs: number;
    flushMs: number;
    batchCalls: number;
    submittedOperations: number;
    mutationP50Ms: number;
    mutationP95Ms: number;
    eventLoopDelayP95Ms: number;
};

function percentile(values: number[], quantile: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
    ];
}

function round(value: number): number {
    return Number(value.toFixed(4));
}

function instrumentDatabase(database: PersistenceDatabase): {
    getBatchCalls: () => number;
    getSubmittedOperations: () => number;
} {
    const originalBatch = database.batch.bind(database);
    let batchCalls = 0;
    let submittedOperations = 0;
    database.batch = ((
        operations: PersistenceBatchOperation[]
    ): Promise<void> => {
        batchCalls += 1;
        submittedOperations += operations.length;
        return originalBatch(operations);
    }) as PersistenceDatabase["batch"];
    return {
        getBatchCalls: () => batchCalls,
        getSubmittedOperations: () => submittedOperations
    };
}

async function createDatabase(
    backend: Backend,
    runId: string
): Promise<{
    handle: PersistenceDatabaseHandle;
    cleanup: () => Promise<void>;
}> {
    if (backend === "MemoryLevel") {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        let closed = false;
        return {
            handle: {
                database,
                location: `memory:${runId}`,
                close: async () => {
                    if (closed) return;
                    closed = true;
                    await database.close();
                },
                destroy: () => database.clear()
            },
            cleanup: async () => undefined
        };
    }

    const root = await mkdtemp(
        path.join(tmpdir(), "state-channels-plus-persistence-benchmark-")
    );
    const location = path.join(root, runId);
    const database = new ClassicLevel<string, string>(location, {
        keyEncoding: "utf8",
        valueEncoding: "utf8"
    });
    let closed = false;
    return {
        handle: {
            database,
            location,
            close: async () => {
                if (closed) return;
                closed = true;
                await database.close();
            },
            destroy: async () => {
                if (!closed) {
                    closed = true;
                    await database.close();
                }
                await ClassicLevel.destroy(location);
            }
        },
        cleanup: () => rm(root, { recursive: true, force: true })
    };
}

async function runSample(
    backend: Backend,
    mode: Mode,
    workload: Workload,
    writes: number,
    run: number
): Promise<Sample> {
    const { handle, cleanup } = await createDatabase(
        backend,
        `${mode}-${workload}-${writes}-${run}`
    );
    const database = handle.database;
    const instrumentation = instrumentDatabase(database);
    const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
    const mutationLatencies: number[] = [];
    let mutationCallMs = 0;
    let flushMs = 0;
    const startedAt = performance.now();
    eventLoopDelay.enable();

    try {
        await database.open();
        if (mode === "database-first") {
            const cache = new Map<string, number>();
            for (let index = 0; index < writes; index++) {
                const key =
                    workload === "repeated" ? "value" : `value-${index}`;
                const mutationStartedAt = performance.now();
                await database.batch([
                    {
                        type: "put",
                        key: `records!v1!forceJoin!${key}`,
                        value: `0x${index.toString(16).padStart(64, "0")}`
                    }
                ]);
                cache.set(key, index);
                const mutationMs = performance.now() - mutationStartedAt;
                mutationLatencies.push(mutationMs);
                mutationCallMs += mutationMs;
            }
        } else {
            const controller = new PersistenceController(
                createStorageRecordCodec(),
                {
                    databaseHandle: handle,
                    flushIntervalMs: 60_000,
                    maxBatchOperations: Number.MAX_SAFE_INTEGER
                }
            );
            const values = new PersistentCollection<string, number>(
                "forceJoin",
                controller
            );
            await controller.bind();
            for (let index = 0; index < writes; index++) {
                const key =
                    workload === "repeated" ? "value" : `value-${index}`;
                const mutationStartedAt = performance.now();
                values.set(key, index);
                const mutationMs = performance.now() - mutationStartedAt;
                mutationLatencies.push(mutationMs);
                mutationCallMs += mutationMs;
            }
            const flushStartedAt = performance.now();
            await controller.flush();
            flushMs = performance.now() - flushStartedAt;
            await controller.close();
        }
    } finally {
        eventLoopDelay.disable();
        await handle.close();
        await cleanup();
    }

    return {
        backend,
        mode,
        workload,
        writes,
        mutationCallMs: round(mutationCallMs),
        totalMs: round(performance.now() - startedAt),
        flushMs: round(flushMs),
        batchCalls: instrumentation.getBatchCalls(),
        submittedOperations: instrumentation.getSubmittedOperations(),
        mutationP50Ms: round(percentile(mutationLatencies, 0.5)),
        mutationP95Ms: round(percentile(mutationLatencies, 0.95)),
        eventLoopDelayP95Ms: round(eventLoopDelay.percentile(95) / 1_000_000)
    };
}

function summarize(samples: Sample[]) {
    const groups = new Map<string, Sample[]>();
    for (const sample of samples) {
        const key = [
            sample.backend,
            sample.mode,
            sample.workload,
            sample.writes
        ].join(":");
        const values = groups.get(key) ?? [];
        values.push(sample);
        groups.set(key, values);
    }
    return [...groups.values()].map((values) => {
        const first = values[0];
        const median = (field: keyof Sample) =>
            round(
                percentile(
                    values.map((sample) => Number(sample[field])),
                    0.5
                )
            );
        return {
            backend: first.backend,
            mode: first.mode,
            workload: first.workload,
            writes: first.writes,
            mutationCallMs: median("mutationCallMs"),
            totalMs: median("totalMs"),
            flushMs: median("flushMs"),
            batchCalls: median("batchCalls"),
            submittedOperations: median("submittedOperations"),
            mutationP50Ms: median("mutationP50Ms"),
            mutationP95Ms: median("mutationP95Ms"),
            eventLoopDelayP95Ms: median("eventLoopDelayP95Ms")
        };
    });
}

function renderReport(
    summary: ReturnType<typeof summarize>,
    nodeVersion: string
): string {
    const lines = [
        "# Persistence write-behind benchmark",
        "",
        `Node ${nodeVersion}; ${WARMUPS} warmups and ${MEASURED_RUNS} measured runs per workload.`,
        "",
        "| Backend | Mode | Workload | Writes | Mutation calls ms | Total ms | Flush ms | Batches | Submitted ops | Mutation p50 ms | Mutation p95 ms | Event-loop p95 ms |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    ];
    for (const row of summary) {
        lines.push(
            `| ${row.backend} | ${row.mode} | ${row.workload} | ${row.writes} | ${row.mutationCallMs} | ${row.totalMs} | ${row.flushMs} | ${row.batchCalls} | ${row.submittedOperations} | ${row.mutationP50Ms} | ${row.mutationP95Ms} | ${row.eventLoopDelayP95Ms} |`
        );
    }
    return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
    const samples: Sample[] = [];
    const workloads = [
        ...(["distinct", "repeated"] as const).flatMap((workload) =>
            WORKLOAD_SIZES.map((writes) => ({ workload, writes }))
        ),
        // Snapshot, state, block, metadata, outbound message, participant
        // change, and force-join removal before the externalization gate.
        { workload: "canonical-transition" as const, writes: 7 }
    ];
    for (const backend of ["MemoryLevel", "ClassicLevel"] as const) {
        for (const mode of ["database-first", "write-behind"] as const) {
            for (const { workload, writes } of workloads) {
                for (let run = -WARMUPS; run < MEASURED_RUNS; run++) {
                    const sample = await runSample(
                        backend,
                        mode,
                        workload,
                        writes,
                        run
                    );
                    if (run >= 0) samples.push(sample);
                }
            }
        }
    }

    const summary = summarize(samples);
    const raw = {
        environment: {
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            warmups: WARMUPS,
            measuredRuns: MEASURED_RUNS
        },
        samples,
        summary
    };
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    await Promise.all([
        writeFile(
            path.join(OUTPUT_DIRECTORY, "benchmark-node.json"),
            `${JSON.stringify(raw, null, 2)}\n`
        ),
        writeFile(
            path.join(OUTPUT_DIRECTORY, "benchmark-node.md"),
            renderReport(summary, process.version)
        )
    ]);
    console.log(JSON.stringify(summary, null, 2));
}

void main();
