import type { AbstractBatchOperation } from "abstract-level";
import { expect } from "chai";
import { MemoryLevel } from "memory-level";
import sinon from "sinon";

import {
    PersistenceController,
    PersistentCollection,
    type PersistenceDatabaseHandle
} from "@/storage/persistence";
import { createStorageRecordCodec } from "@/storage/persistence/storageCodecs";

type Database = MemoryLevel<string, string>;
type BatchOperation = AbstractBatchOperation<Database, string, string>;

function deferred(): {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
} {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

class BatchControl {
    public readonly batches: BatchOperation[][] = [];
    public maxActiveBatches = 0;
    private readonly database: Database;
    private readonly originalBatch: Database["batch"];
    private readonly gates: ReturnType<typeof deferred>[] = [];
    private readonly batchWaiters: Array<{
        count: number;
        resolve: () => void;
    }> = [];
    private activeBatches = 0;

    constructor(database: Database) {
        this.database = database;
        this.originalBatch = database.batch.bind(database);
        database.batch = ((operations: BatchOperation[]): Promise<void> =>
            this.run(operations)) as Database["batch"];
    }

    public holdNext(): ReturnType<typeof deferred> {
        const gate = deferred();
        this.gates.push(gate);
        return gate;
    }

    public waitForBatch(count: number): Promise<void> {
        if (this.batches.length >= count) return Promise.resolve();
        return new Promise((resolve) => {
            this.batchWaiters.push({ count, resolve });
        });
    }

    private async run(operations: BatchOperation[]): Promise<void> {
        this.batches.push(operations);
        this.activeBatches += 1;
        this.maxActiveBatches = Math.max(
            this.maxActiveBatches,
            this.activeBatches
        );
        for (let index = this.batchWaiters.length - 1; index >= 0; index--) {
            const waiter = this.batchWaiters[index];
            if (this.batches.length < waiter.count) continue;
            this.batchWaiters.splice(index, 1);
            waiter.resolve();
        }

        try {
            const gate = this.gates.shift();
            if (gate) await gate.promise;
            await this.originalBatch(operations);
        } finally {
            this.activeBatches -= 1;
        }
    }
}

function createDatabase(): Database {
    return new MemoryLevel<string, string>({
        keyEncoding: "utf8",
        valueEncoding: "utf8"
    });
}

function createHandle(database = createDatabase()): PersistenceDatabaseHandle {
    return {
        database,
        location: "memory:persistence-controller",
        close: () => database.close(),
        destroy: () => database.clear()
    };
}

async function createSubject(
    options: {
        database?: Database;
        maxBatchOperations?: number;
        flushIntervalMs?: number;
        maxRetries?: number;
        commitDeadlineMs?: number;
    } = {}
) {
    const database = options.database ?? createDatabase();
    const controller = new PersistenceController(createStorageRecordCodec(), {
        databaseHandle: createHandle(database),
        maxBatchOperations: options.maxBatchOperations,
        flushIntervalMs: options.flushIntervalMs,
        maxRetries: options.maxRetries,
        commitDeadlineMs: options.commitDeadlineMs
    });
    const values = new PersistentCollection<string, number>(
        "forceJoin",
        controller
    );
    await controller.bind();
    return { controller, database, values };
}

describe("PersistenceController", function () {
    it("makes a cache-first mutation visible before the backend settles", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const heldBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1
        });

        expect(values.set("value", 7)).to.equal(7);
        expect(values.get("value")).to.equal(7);
        await batches.waitForBatch(1);
        expect(await database.get("records!v1!forceJoin!value")).to.equal(
            undefined
        );

        heldBatch.resolve();
        await controller.flush();
        expect(await database.get("records!v1!forceJoin!value")).to.equal(
            "0x0000000000000000000000000000000000000000000000000000000000000007"
        );
        await controller.close();
    });

    it("batches rapid writes and persists their final value", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const { controller, values } = await createSubject({
            database,
            flushIntervalMs: 60_000
        });

        for (let value = 1; value <= 10; value++) {
            values.set("value", value);
        }
        await controller.flush();

        expect(batches.batches).to.have.length(1);
        expect(batches.batches[0]).to.have.length(1);
        expect(values.get("value")).to.equal(10);
        expect(await database.get("records!v1!forceJoin!value")).to.equal(
            "0x000000000000000000000000000000000000000000000000000000000000000a"
        );
        await controller.close();
    });

    it("applies rapid updates synchronously from the latest cache value", async () => {
        const { controller, database, values } = await createSubject();

        for (let index = 0; index < 20; index++) {
            values.update("value", (current) => (current ?? 0) + 1);
        }

        expect(values.get("value")).to.equal(20);
        await controller.flush();
        expect(await database.get("records!v1!forceJoin!value")).to.equal(
            "0x0000000000000000000000000000000000000000000000000000000000000014"
        );
        await controller.close();
    });

    it("uses a revision watermark for an explicit flush", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const firstBatch = batches.holdNext();
        const secondBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1
        });

        values.set("first", 1);
        await batches.waitForBatch(1);
        const firstFlush = controller.flush();
        let firstResolved = false;
        void firstFlush.then(() => {
            firstResolved = true;
        });
        values.set("second", 2);

        firstBatch.resolve();
        await firstFlush;
        expect(firstResolved).to.be.true;
        await batches.waitForBatch(2);
        expect(await database.get("records!v1!forceJoin!second")).to.equal(
            undefined
        );

        secondBatch.resolve();
        await controller.flush();
        expect(await database.get("records!v1!forceJoin!second")).to.not.equal(
            undefined
        );
        await controller.close();
    });

    it("settles concurrent barriers against their own target revisions", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const firstBatch = batches.holdNext();
        const secondBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1
        });

        values.set("first", 1);
        await batches.waitForBatch(1);
        const firstFlush = controller.flush();
        values.set("second", 2);
        const secondFlush = controller.flush();
        let secondResolved = false;
        void secondFlush.then(() => {
            secondResolved = true;
        });

        firstBatch.resolve();
        await firstFlush;
        expect(secondResolved).to.be.false;
        await batches.waitForBatch(2);
        secondBatch.resolve();
        await secondFlush;
        expect(secondResolved).to.be.true;
        await controller.close();
    });

    it("flushes on the configured interval", async () => {
        const clock = sinon.useFakeTimers();
        try {
            const database = createDatabase();
            const batches = new BatchControl(database);
            const { controller, values } = await createSubject({
                database,
                flushIntervalMs: 50
            });

            values.set("value", 1);
            expect(batches.batches).to.have.length(0);
            await clock.tickAsync(49);
            expect(batches.batches).to.have.length(0);
            await clock.tickAsync(1);
            await batches.waitForBatch(1);
            expect(batches.batches).to.have.length(1);
            await controller.close();
        } finally {
            clock.restore();
        }
    });

    it("flushes at the size threshold without parallel batches", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const firstBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 2,
            flushIntervalMs: 60_000
        });

        values.set("one", 1);
        values.set("two", 2);
        await batches.waitForBatch(1);
        values.set("three", 3);
        values.set("four", 4);
        expect(batches.batches).to.have.length(1);

        firstBatch.resolve();
        await batches.waitForBatch(2);
        await controller.flush();
        expect(batches.maxActiveBatches).to.equal(1);
        expect(batches.batches.map((batch) => batch.length)).to.deep.equal([
            2, 2
        ]);
        await controller.close();
    });

    it("coalesces mutations for a blocked dirty record", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const firstBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1
        });

        values.set("blocker", 1);
        await batches.waitForBatch(1);
        for (let value = 1; value <= 2_500; value++) {
            values.set("dirty", value);
        }

        firstBatch.resolve();
        await controller.flush();
        expect(batches.batches).to.have.length(2);
        expect(batches.batches[1]).to.have.length(1);
        expect(values.get("dirty")).to.equal(2_500);
        await controller.close();
    });

    for (const testCase of [
        {
            name: "put then put",
            mutate(values: PersistentCollection<string, number>) {
                values.set("value", 1);
                values.set("value", 2);
            },
            expected: 2
        },
        {
            name: "put then delete",
            mutate(values: PersistentCollection<string, number>) {
                values.set("value", 1);
                values.delete("value");
            },
            expected: undefined
        },
        {
            name: "delete then put",
            mutate(values: PersistentCollection<string, number>) {
                values.set("value", 1);
                values.delete("value");
                values.set("value", 3);
            },
            expected: 3
        },
        {
            name: "clear then put",
            mutate(values: PersistentCollection<string, number>) {
                values.set("value", 1);
                values.clear();
                values.set("value", 4);
            },
            expected: 4
        }
    ]) {
        it(`preserves ${testCase.name} ordering while coalescing`, async () => {
            const database = createDatabase();
            const batches = new BatchControl(database);
            const { controller, values } = await createSubject({
                database,
                flushIntervalMs: 60_000
            });

            testCase.mutate(values);
            await controller.flush();

            expect(batches.batches).to.have.length(1);
            expect(batches.batches[0]).to.have.length(1);
            expect(values.get("value")).to.equal(testCase.expected);
            expect(await database.get("records!v1!forceJoin!value")).to.equal(
                testCase.expected === undefined
                    ? undefined
                    : `0x${testCase.expected.toString(16).padStart(64, "0")}`
            );
            await controller.close();
        });
    }

    it("does not enqueue empty or missing deletes", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const { controller, values } = await createSubject({ database });

        expect(values.delete("missing")).to.be.false;
        expect(values.takeMany(["missing"])).to.deep.equal([]);
        values.clear();
        await controller.flush();

        expect(batches.batches).to.have.length(0);
        await controller.close();
    });

    it("deletes each key once in a multi-delete", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const { controller, values } = await createSubject({
            database,
            flushIntervalMs: 60_000
        });
        values.set("value", 1);
        await controller.flush();

        expect(values.takeMany(["value", "value"])).to.deep.equal([1]);
        await controller.flush();

        expect(batches.batches).to.have.length(2);
        expect(batches.batches[1]).to.have.length(1);
        expect(values.get("value")).to.equal(undefined);
        await controller.close();
    });

    it("retries the same extracted batch", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const failedAttempt = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1,
            maxRetries: 1
        });

        values.set("value", 7);
        await batches.waitForBatch(1);
        failedAttempt.reject(new Error("transient batch failure"));
        await controller.flush();

        expect(batches.batches).to.have.length(2);
        expect(batches.batches[0]).to.deep.equal(batches.batches[1]);
        expect(await database.get("records!v1!forceJoin!value")).to.not.equal(
            undefined
        );
        await controller.close();
    });

    it("keeps failed cache writes visible and poisons barriers once", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const failedBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1,
            maxRetries: 0
        });
        let failureCount = 0;
        controller.setFailureHandler(() => {
            failureCount += 1;
        });

        values.set("value", 2);
        expect(values.get("value")).to.equal(2);
        await batches.waitForBatch(1);
        failedBatch.reject(new Error("terminal batch failure"));

        let firstError: Error | undefined;
        try {
            await controller.flush();
        } catch (error) {
            firstError = error as Error;
        }
        expect(firstError?.message).to.include("terminal batch failure");
        expect(failureCount).to.equal(1);

        values.set("value", 3);
        expect(values.get("value")).to.equal(3);
        let laterError: Error | undefined;
        try {
            await controller.flush();
        } catch (error) {
            laterError = error as Error;
        }
        expect(laterError).to.equal(firstError);
        expect(failureCount).to.equal(1);
    });

    it("serializes concurrent binds onto a single hydration run", async () => {
        const database = createDatabase();
        // Seed a durable record through a first controller lifetime.
        const seed = new PersistenceController(createStorageRecordCodec(), {
            databaseHandle: createHandle(database)
        });
        const seedValues = new PersistentCollection<string, number>(
            "forceJoin",
            seed
        );
        await seed.bind();
        seedValues.set("value", 21);
        await seed.close();

        const controller = new PersistenceController(
            createStorageRecordCodec(),
            { databaseHandle: createHandle(database) }
        );
        const values = new PersistentCollection<string, number>(
            "forceJoin",
            controller
        );
        let iteratorCalls = 0;
        const originalIterator = database.iterator.bind(database);
        database.iterator = ((options: Parameters<Database["iterator"]>[0]) => {
            iteratorCalls += 1;
            return originalIterator(options);
        }) as Database["iterator"];

        // A resume-from-background hydrate racing the connect-path bind must
        // join the same run, not hydrate twice.
        await Promise.all([controller.bind(), controller.bind()]);
        expect(iteratorCalls).to.equal(1);
        expect(values.get("value")).to.equal(21);

        // Once bound, further binds are no-ops.
        await controller.bind();
        expect(iteratorCalls).to.equal(1);
        await controller.close();
    });

    it("poisons the controller when a commit hangs past its deadline", async () => {
        // A rejecting batch poisons through the retry path; a batch that
        // HANGS would otherwise keep every flush waiter (and thus every
        // durability barrier) pending forever with no failure-handler
        // teardown. The commit deadline converts the hang into the same
        // poison flow.
        const database = createDatabase();
        const batches = new BatchControl(database);
        const hungBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1,
            commitDeadlineMs: 100
        });
        let failureError: Error | undefined;
        controller.setFailureHandler((error) => {
            failureError = error;
        });

        values.set("value", 4);
        await batches.waitForBatch(1);

        let flushError: Error | undefined;
        try {
            await controller.flush();
        } catch (error) {
            flushError = error as Error;
        }
        expect(flushError?.message).to.include("deadline");
        expect(failureError?.message).to.include("deadline");
        // The cache-first write stays visible after the poison, matching the
        // rejecting-batch behavior.
        expect(values.get("value")).to.equal(4);
        // Release the abandoned batch; its late settlement must be a no-op.
        hungBatch.resolve();
    });

    it("leaves commits that settle within the deadline unaffected", async () => {
        const { controller, database, values } = await createSubject({
            maxBatchOperations: 1,
            commitDeadlineMs: 1_000
        });

        values.set("value", 11);
        await controller.flush();

        expect(await database.get("records!v1!forceJoin!value")).to.not.equal(
            undefined
        );
        await controller.close();
    });

    it("separates close from scoped failure-handler cache cleanup", async () => {
        const database = createDatabase();
        const batches = new BatchControl(database);
        const failedBatch = batches.holdNext();
        const { controller, values } = await createSubject({
            database,
            maxBatchOperations: 1,
            maxRetries: 0
        });
        let cleanupResult: number | undefined;
        controller.setFailureHandler(() => {
            cleanupResult = values.set("cleanup", 9);
        });

        values.set("value", 1);
        await batches.waitForBatch(1);
        const close = controller.close();
        expect(() => values.set("ordinary", 2)).to.throw(
            "Persistence controller is closing"
        );

        failedBatch.reject(new Error("close batch failure"));
        let closeError: Error | undefined;
        try {
            await close;
        } catch (error) {
            closeError = error as Error;
        }
        expect(closeError?.message).to.include("close batch failure");
        expect(cleanupResult).to.equal(9);
        expect(values.get("cleanup")).to.equal(9);
        let repeatedCloseError: Error | undefined;
        try {
            await controller.close();
        } catch (error) {
            repeatedCloseError = error as Error;
        }
        expect(repeatedCloseError?.message).to.include("close batch failure");
    });

    it("keeps disabled persistence synchronous and flushes immediately", async () => {
        const controller = new PersistenceController(
            createStorageRecordCodec()
        );
        const values = new PersistentCollection<string, number>(
            "forceJoin",
            controller
        );

        expect(values.set("value", 1)).to.equal(1);
        expect(values.get("value")).to.equal(1);
        await controller.flush();
        await controller.close();
    });

    it("includes the resolved location in hydration failures", async () => {
        const database = createDatabase();
        await database.open();
        await database.put("records!v1!unknown!value", "corrupt");
        const controller = new PersistenceController(
            createStorageRecordCodec(),
            {
                databaseHandle: createHandle(database)
            }
        );
        new PersistentCollection<string, number>("forceJoin", controller);

        let bindError: Error | undefined;
        try {
            await controller.bind();
        } catch (error) {
            bindError = error as Error;
        }

        expect(bindError?.message).to.include(
            "Unknown persistence collection unknown"
        );
        expect(bindError?.message).to.include(
            "(persistence: memory:persistence-controller)"
        );
    });
});
