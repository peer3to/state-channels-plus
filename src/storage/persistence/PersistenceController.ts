import type {
    EncodedPersistenceValue,
    PersistenceDatabaseHandle,
    PersistenceKey
} from "./PersistenceDatabase";
import type {
    EncodedRecord,
    PersistentCollection
} from "./PersistentCollection";
import type { CollectionId } from "./storageCodecs";
import type { Logger } from "@/utils/logging";
import { retry } from "@/utils/retry";

import type { AbstractBatchOptions } from "abstract-level";

const RECORD_PREFIX = "records!v1!";
const DEFAULT_FLUSH_INTERVAL_MS = 50;
const PENDING_WARNING_RECORDS = 2_000;

type RegisteredCollection = PersistentCollection<unknown, CollectionId>;
/** `records!v1!<collection id>!<map key>` */
type RecordKey = string;
/** Counts writes; a flush waits until the disk holds its revision. */
type Revision = number;
type FlushWaiter = {
    revision: Revision;
    resolve: () => void;
    reject: (error: Error) => void;
};
// classic-level reads `sync`; abstract-level's options type does not name it
type BatchOptions = AbstractBatchOptions<
    PersistenceKey,
    EncodedPersistenceValue
>;

export interface PersistenceControllerOptions {
    logger?: Logger;
    flushIntervalMs?: number;
    maxRetries?: number;
}

/**
 * Copies collection writes to disk behind memory. A drain starts only between
 * tasks (timer, `flush()`, `close()`) and writes everything pending as one
 * `database.batch`, so the disk always holds a prefix of synchronous steps.
 */
export class PersistenceController {
    private readonly collections = new Map<
        CollectionId,
        RegisteredCollection
    >();
    // what changed since the last drain; the drain encodes the live value
    private readonly pending = new Map<
        RecordKey,
        { collection: RegisteredCollection; key: unknown }
    >();
    private readonly waiters: FlushWaiter[] = [];
    private readonly logger?: Logger;
    private readonly flushIntervalMs: number;
    private readonly maxRetries: number;
    private databaseHandle?: PersistenceDatabaseHandle;
    private failureHandler?: (error: Error) => void;
    private poisonedError?: Error;
    private flushTimer?: ReturnType<typeof setTimeout>;
    private drainPromise?: Promise<void>;
    private closePromise?: Promise<void>;
    private nextRevision: Revision = 0;
    private persistedRevision: Revision = 0;
    private pendingWarningEmitted = false;

    constructor(options: PersistenceControllerOptions = {}) {
        this.logger = options.logger;
        this.flushIntervalMs =
            options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
        this.maxRetries = options.maxRetries ?? 2;
    }

    public register(collection: RegisteredCollection): void {
        if (this.collections.has(collection.id)) {
            throw new Error(
                `Persistence collection already registered: ${collection.id}`
            );
        }
        this.collections.set(collection.id, collection);
    }

    /**
     * Loads every collection from disk in one all-or-nothing pass. An empty
     * disk keeps what memory holds and writes it; records on both sides are
     * refused. On failure the database is closed and memory is left as it was.
     */
    public async open(
        databaseHandle: PersistenceDatabaseHandle,
        onFailure: (error: Error) => void
    ): Promise<void> {
        if (this.databaseHandle || this.closePromise) {
            throw new Error("Persistence controller is already opened");
        }
        const records = new Map<CollectionId, Array<[string, EncodedRecord]>>();
        try {
            await databaseHandle.database.open();
            for await (const [
                recordKey,
                encodedRecord
            ] of databaseHandle.database.iterator({
                gte: RECORD_PREFIX,
                lt: `${RECORD_PREFIX}\uffff`
            })) {
                const { collectionId, key } = this.parseRecordKey(recordKey);
                if (!this.collections.has(collectionId)) {
                    throw new Error(
                        `Unknown persisted collection ${collectionId} at ${recordKey}`
                    );
                }
                const entries = records.get(collectionId) ?? [];
                entries.push([key, encodedRecord]);
                records.set(collectionId, entries);
            }
            if (this.closePromise) {
                throw new Error("Persistence controller closed while opening");
            }
            const held = [...this.collections.values()].find(
                (collection) => collection.size
            );
            if (records.size && held) {
                throw new Error(
                    `Cannot load persisted records: ${held.id} already holds records in memory`
                );
            }
            if (records.size) {
                this.load(records);
            }
        } catch (error) {
            await databaseHandle.close().catch(() => undefined);
            throw this.withLocation(error, databaseHandle);
        }
        this.databaseHandle = databaseHandle;
        this.failureHandler = onFailure;
        if (records.size) return;
        for (const collection of this.collections.values()) {
            for (const key of collection.keys()) this.enqueue(collection, key);
        }
    }

    public enqueue(collection: RegisteredCollection, key: unknown): void {
        // a write after close starts, or after a failure, stays in memory
        if (!this.databaseHandle || this.closePromise || this.poisonedError) {
            return;
        }
        this.nextRevision++;
        this.pending.set(this.recordKey(collection.id, key), {
            collection,
            key
        });
        this.warnPendingSize();
        this.scheduleDrain();
    }

    /** Resolves once the disk holds every write made before the call. */
    public flush(): Promise<void> {
        // after close starts nothing new reaches disk: wait for close's drain
        if (this.closePromise) return this.closePromise;
        return this.flushThrough(this.nextRevision);
    }

    /** Drains what is pending, then closes the database. */
    public close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        const databaseHandle = this.databaseHandle;
        const drained = this.flushThrough(this.nextRevision);
        this.clearFlushTimer();
        this.closePromise = (async () => {
            try {
                await drained;
            } finally {
                await databaseHandle?.close();
            }
        })();
        return this.closePromise;
    }

    private load(records: Map<CollectionId, Array<[string, EncodedRecord]>>) {
        try {
            for (const [collectionId, collection] of this.collections) {
                collection.load(records.get(collectionId) ?? []);
            }
        } catch (error) {
            // every collection was empty before the load
            for (const collection of this.collections.values()) {
                collection.load([]);
            }
            throw error;
        }
    }

    private flushThrough(revision: Revision): Promise<void> {
        if (!this.databaseHandle || revision <= this.persistedRevision) {
            return Promise.resolve();
        }
        if (this.poisonedError) return Promise.reject(this.poisonedError);
        const promise = new Promise<void>((resolve, reject) => {
            this.waiters.push({ revision, resolve, reject });
        });
        this.clearFlushTimer();
        this.startDrain();
        return promise;
    }

    private scheduleDrain(): void {
        if (this.flushTimer || this.drainPromise || !this.pending.size) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.startDrain();
        }, this.flushIntervalMs);
        this.flushTimer.unref?.();
    }

    private startDrain(): void {
        const databaseHandle = this.databaseHandle;
        if (this.drainPromise || this.poisonedError || !databaseHandle) return;
        const revision = this.nextRevision;
        if (!this.pending.size) {
            // nothing pending and no drain in flight: the disk holds it all
            this.persistedRevision = revision;
            this.resolveWaiters();
            return;
        }
        let operations;
        try {
            operations = [...this.pending].map(
                ([recordKey, { collection, key }]) => {
                    const value = collection.encodeRecord(key);
                    return value === undefined
                        ? { type: "del" as const, key: recordKey }
                        : { type: "put" as const, key: recordKey, value };
                }
            );
        } catch (error) {
            this.poison(error);
            return;
        }
        this.pending.clear();
        // a batch someone waits for is fsynced on node
        const options = { sync: this.waiters.length > 0 } as BatchOptions;
        this.drainPromise = retry(
            () => databaseHandle.database.batch(operations, options),
            {
                maxRetries: this.maxRetries,
                delayMs: 10,
                useExponentialBackoff: true,
                onRetry: (attempt, error) =>
                    this.logger?.warn("Retrying persistence batch", {
                        attempt,
                        error
                    })
            }
        )
            .then(
                () => {
                    this.persistedRevision = revision;
                    this.resolveWaiters();
                },
                (error) => this.poison(error)
            )
            .finally(() => {
                this.drainPromise = undefined;
                if (this.waiters.length) this.startDrain();
                else this.scheduleDrain();
            });
    }

    private resolveWaiters(): void {
        for (let index = this.waiters.length - 1; index >= 0; index--) {
            const waiter = this.waiters[index];
            if (waiter.revision > this.persistedRevision) continue;
            this.waiters.splice(index, 1);
            waiter.resolve();
        }
    }

    private poison(error: unknown): void {
        if (this.poisonedError) return;
        const normalized = this.withLocation(error, this.databaseHandle);
        this.poisonedError = normalized;
        this.logger?.error("Persistence batch failed", { error: normalized });
        for (const waiter of this.waiters.splice(0)) waiter.reject(normalized);
        try {
            this.failureHandler?.(normalized);
        } catch (handlerError) {
            this.logger?.error("Persistence failure handler failed", {
                error: handlerError
            });
        }
    }

    private warnPendingSize(): void {
        if (this.pending.size < PENDING_WARNING_RECORDS) {
            this.pendingWarningEmitted = false;
            return;
        }
        if (this.pendingWarningEmitted) return;
        this.pendingWarningEmitted = true;
        this.logger?.warn("Persistence pending-record high-water mark", {
            pendingRecords: this.pending.size
        });
    }

    private clearFlushTimer(): void {
        if (!this.flushTimer) return;
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
    }

    private withLocation(
        error: unknown,
        databaseHandle?: PersistenceDatabaseHandle
    ): Error {
        const message = error instanceof Error ? error.message : String(error);
        return databaseHandle
            ? new Error(`${message} (persistence: ${databaseHandle.location})`)
            : error instanceof Error
              ? error
              : new Error(message);
    }

    private recordKey(collectionId: CollectionId, key: unknown): RecordKey {
        return `${RECORD_PREFIX}${collectionId}!${String(key)}`;
    }

    private parseRecordKey(recordKey: RecordKey): {
        collectionId: CollectionId;
        key: string;
    } {
        const remainder = recordKey.slice(RECORD_PREFIX.length);
        const separator = remainder.indexOf("!");
        if (separator <= 0) {
            throw new Error(`Invalid persisted record key ${recordKey}`);
        }
        return {
            collectionId: remainder.slice(0, separator) as CollectionId,
            key: remainder.slice(separator + 1)
        };
    }
}
