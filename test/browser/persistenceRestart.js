import { Storage } from "../../src/storage/Storage.ts";
import { openPersistencePartition } from "../../src/storage/persistence/PersistencePartition.ts";

function deleteDatabase(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () =>
            reject(request.error ?? new Error(`Failed to delete ${name}`));
        request.onblocked = () =>
            reject(new Error(`Deletion blocked for ${name}`));
    });
}

globalThis.runPersistenceRestartBrowserSmoke = async () => {
    const prefix = `peer3-persistence-test-${crypto.randomUUID()}-`;
    const identity = {
        chainId: "31337",
        stateChannelManagerAddress:
            "0x1000000000000000000000000000000000000001",
        stateMachineAddress: "0x2000000000000000000000000000000000000002",
        channelId:
            "0x3000000000000000000000000000000000000000000000000000000000000003"
    };
    const originalSigner =
        "0x4000000000000000000000000000000000000000000000000000000000000004";
    let openHandle;
    let databaseName;

    try {
        const first = await openPersistencePartition({
            identity,
            persistence: { location: prefix },
            signerSecret: originalSigner,
            existingPartition: "allow"
        });
        openHandle = first.databaseHandle;
        databaseName = `${prefix}${first.namespace}`;

        let leaseRejected = false;
        try {
            await openPersistencePartition({
                identity,
                persistence: { location: prefix },
                signerSecret:
                    "0x5000000000000000000000000000000000000000000000000000000000000005",
                existingPartition: "allow"
            });
        } catch {
            leaseRejected = true;
        }
        await openHandle.close();
        openHandle = undefined;

        const second = await openPersistencePartition({
            identity,
            persistence: { location: prefix },
            signerSecret:
                "0x6000000000000000000000000000000000000000000000000000000000000006",
            existingPartition: "allow"
        });
        openHandle = second.databaseHandle;
        const firstStorage = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await firstStorage.bind(openHandle);
        openHandle = undefined;
        for (let height = 1; height <= 10; height++) {
            firstStorage.forceJoin.setJoinSubmissionBlockHeight(height);
        }
        await firstStorage.flush();
        await firstStorage.close();

        const third = await openPersistencePartition({
            identity,
            persistence: { location: prefix },
            signerSecret:
                "0x7000000000000000000000000000000000000000000000000000000000000007",
            existingPartition: "allow"
        });
        openHandle = third.databaseHandle;
        const secondStorage = new Storage(undefined, {
            flushIntervalMs: 20
        });
        await secondStorage.bind(openHandle);
        openHandle = undefined;
        const explicitBatchRecovered =
            secondStorage.forceJoin.getJoinSubmissionBlockHeight() === 10;
        secondStorage.forceExit.setForceExit(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const automaticFlushPersisted =
            (await third.databaseHandle.database.get(
                "records!v1!forceExit!value"
            )) !== undefined;
        await secondStorage.close();

        const fourth = await openPersistencePartition({
            identity,
            persistence: { location: prefix },
            signerSecret:
                "0x8000000000000000000000000000000000000000000000000000000000000008",
            existingPartition: "allow"
        });
        openHandle = fourth.databaseHandle;
        const recoveredStorage = new Storage();
        await recoveredStorage.bind(openHandle);
        openHandle = undefined;
        const forceExitRecovered = recoveredStorage.forceExit.getForceExit();
        await recoveredStorage.close();

        return {
            leaseRejected,
            signerRecovered: third.signerSecret === originalSigner,
            explicitBatchRecovered,
            automaticFlushPersisted,
            forceExitRecovered
        };
    } finally {
        await openHandle?.close();
        if (databaseName) await deleteDatabase(databaseName);
    }
};

globalThis.runPersistenceBrowserBenchmark = async () => {
    const prefix = `peer3-persistence-benchmark-${crypto.randomUUID()}-`;
    const identity = {
        chainId: "31337",
        stateChannelManagerAddress:
            "0x1000000000000000000000000000000000000001",
        stateMachineAddress: "0x2000000000000000000000000000000000000002",
        channelId:
            "0x9000000000000000000000000000000000000000000000000000000000000009"
    };
    const signerSecret =
        "0xa00000000000000000000000000000000000000000000000000000000000000a";
    const partition = await openPersistencePartition({
        identity,
        persistence: { location: prefix },
        signerSecret,
        existingPartition: "allow"
    });
    const databaseName = `${prefix}${partition.namespace}`;
    const database = partition.databaseHandle.database;
    const originalBatch = database.batch.bind(database);
    let batchCalls = 0;
    let submittedOperations = 0;
    database.batch = async (operations) => {
        batchCalls += 1;
        submittedOperations += operations.length;
        await originalBatch(operations);
    };
    const storage = new Storage(undefined, {
        flushIntervalMs: 60_000,
        maxBatchOperations: Number.MAX_SAFE_INTEGER
    });
    await storage.bind(partition.databaseHandle);
    const samples = [];

    try {
        for (const mode of ["database-first", "write-behind"]) {
            for (const workload of ["distinct", "repeated"]) {
                for (const writes of [10, 100, 1000]) {
                    for (let run = -5; run < 30; run++) {
                        const batchCallsBefore = batchCalls;
                        const operationsBefore = submittedOperations;
                        const mutationStartedAt = performance.now();
                        if (mode === "database-first") {
                            for (let index = 0; index < writes; index++) {
                                const key =
                                    workload === "repeated"
                                        ? "value"
                                        : `value-${index}`;
                                await database.batch([
                                    {
                                        type: "put",
                                        key: `benchmark!${key}`,
                                        value: `0x${index
                                            .toString(16)
                                            .padStart(64, "0")}`
                                    }
                                ]);
                            }
                        } else if (workload === "repeated") {
                            for (let index = 0; index < writes; index++) {
                                storage.forceJoin.setJoinSubmissionBlockHeight(
                                    index
                                );
                            }
                        } else {
                            for (let index = 0; index < writes; index++) {
                                const channelId = `0x${index
                                    .toString(16)
                                    .padStart(64, "0")}`;
                                storage.eventSync.storeLatestProcessedBlock(
                                    channelId,
                                    index
                                );
                            }
                        }
                        const mutationCallMs =
                            performance.now() - mutationStartedAt;
                        const flushStartedAt = performance.now();
                        if (mode === "write-behind") await storage.flush();
                        const flushMs = performance.now() - flushStartedAt;
                        if (run >= 0) {
                            samples.push({
                                mode,
                                workload,
                                writes,
                                mutationCallMs,
                                flushMs,
                                totalMs: mutationCallMs + flushMs,
                                batchCalls: batchCalls - batchCallsBefore,
                                submittedOperations:
                                    submittedOperations - operationsBefore
                            });
                        }
                    }
                }
            }
        }
        return {
            environment: {
                userAgent: navigator.userAgent,
                warmups: 5,
                measuredRuns: 30
            },
            samples
        };
    } finally {
        await storage.close();
        await deleteDatabase(databaseName);
    }
};
