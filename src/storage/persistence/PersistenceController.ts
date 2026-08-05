import cloneDeep from "lodash.clonedeep";

import type { Logger } from "@/utils/logging";
import { retry } from "@/utils/retry";

import type {
    PersistenceBatchOperation,
    PersistenceDatabaseHandle
} from "./PersistenceDatabase";
import type { PersistentCollection } from "./PersistentCollection";
import {
    PersistenceRecordCodec,
    type CollectionId
} from "./PersistenceRecordCodec";

const RECORD_PREFIX = "records!v1!";
const DEFAULT_FLUSH_INTERVAL_MS = 50;
const DEFAULT_MAX_BATCH_OPERATIONS = 500;
const DEFAULT_PENDING_WARNING_OPERATIONS = 2_000;
const DEFAULT_COMMIT_DEADLINE_MS = 30_000;

type RegisteredCollection = PersistentCollection<unknown, unknown>;
type EncodedRecordKey = string;
type PendingRecord = {
    operation: PersistenceBatchOperation;
    revision: number;
};
type FlushWaiter = {
    targetRevision: number;
    resolve: () => void;
    reject: (error: Error) => void;
};

export interface PersistenceControllerOptions {
    databaseHandle?: PersistenceDatabaseHandle;
    logger?: Logger;
    maxRetries?: number;
    flushIntervalMs?: number;
    maxBatchOperations?: number;
    pendingWarningOperations?: number;
    /**
     * Deadline for a whole drain attempt (the batch write including its
     * retries). A rejecting batch already poisons the controller through the
     * retry path; this catches the batch that HANGS instead — without it a
     * hung database keeps every flush waiter (and thus every durability
     * barrier) pending forever with no failure-handler teardown. 0 disables.
     */
    commitDeadlineMs?: number;
}

export class PersistenceController {
    private readonly collections = new Map<
        CollectionId,
        RegisteredCollection
    >();
    private readonly codec: PersistenceRecordCodec;
    private databaseHandle?: PersistenceDatabaseHandle;
    private readonly logger?: Logger;
    private readonly maxRetries: number;
    private readonly flushIntervalMs: number;
    private readonly maxBatchOperations: number;
    private readonly pendingWarningOperations: number;
    private readonly commitDeadlineMs: number;
    private readonly pendingRecords = new Map<
        EncodedRecordKey,
        PendingRecord
    >();
    private readonly flushWaiters: FlushWaiter[] = [];
    private failureHandler?: (error: Error) => void;
    private poisonedError?: Error;
    private flushTimer?: ReturnType<typeof setTimeout>;
    private drainPromise?: Promise<void>;
    private bindPromise?: Promise<void>;
    private closePromise?: Promise<void>;
    private nextRevision = 0;
    private persistedRevision = 0;
    private bound = false;
    private closing = false;
    private closed = false;
    private inFailureCleanup = false;
    private pendingWarningEmitted = false;

    constructor(
        codec: PersistenceRecordCodec,
        options: PersistenceControllerOptions = {}
    ) {
        this.codec = codec;
        this.databaseHandle = options.databaseHandle;
        this.logger = options.logger;
        this.maxRetries = options.maxRetries ?? 2;
        this.flushIntervalMs =
            options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
        this.maxBatchOperations =
            options.maxBatchOperations ?? DEFAULT_MAX_BATCH_OPERATIONS;
        this.pendingWarningOperations =
            options.pendingWarningOperations ??
            DEFAULT_PENDING_WARNING_OPERATIONS;
        this.commitDeadlineMs =
            options.commitDeadlineMs ?? DEFAULT_COMMIT_DEADLINE_MS;
        this.bound = !options.databaseHandle;
    }

    public register<TKey, TValue>(
        collection: PersistentCollection<TKey, TValue>
    ): void {
        if (this.collections.has(collection.id)) {
            throw new Error(
                `Persistence collection already registered: ${collection.id}`
            );
        }
        this.collections.set(
            collection.id,
            collection as PersistentCollection<unknown, unknown>
        );
    }

    public async bind(): Promise<void> {
        this.assertOpen();
        if (this.bound) return;
        if (!this.databaseHandle) {
            this.bound = true;
            return;
        }
        // Serialize concurrent binds (e.g. a resume-from-background hydrate
        // racing the connect-path bind) onto one hydration run; the memo is
        // in-flight only, so a handle attached later still re-runs for real.
        if (this.bindPromise) return this.bindPromise;
        this.bindPromise = this.runBind().finally(() => {
            this.bindPromise = undefined;
        });
        return this.bindPromise;
    }

    private async runBind(): Promise<void> {
        if (!this.databaseHandle) {
            this.bound = true;
            return;
        }
        const hydrated = new Map<CollectionId, Array<[string, unknown]>>();
        for (const collectionId of this.collections.keys()) {
            hydrated.set(collectionId, []);
        }

        try {
            await this.databaseHandle.database.open();
            for await (const [
                key,
                encodedValue
            ] of this.databaseHandle.database.iterator({
                gte: RECORD_PREFIX,
                lt: `${RECORD_PREFIX}\uffff`
            })) {
                const parsed = this.parseRecordKey(key);
                const entries = hydrated.get(parsed.collectionId);
                if (!entries) {
                    throw new Error(
                        `Unknown persistence collection ${parsed.collectionId}`
                    );
                }
                entries.push([
                    parsed.key,
                    this.codec.decode(parsed.collectionId, encodedValue)
                ]);
            }
        } catch (error) {
            try {
                await this.databaseHandle.close();
            } catch {
                // Preserve the bind failure, which has the actionable location.
            }
            throw this.withLocation(error);
        }

        const previousEntries = new Map<
            CollectionId,
            Array<[unknown, unknown]>
        >();
        for (const [collectionId, collection] of this.collections) {
            previousEntries.set(
                collectionId,
                cloneDeep([...collection.entries()])
            );
        }

        try {
            for (const [collectionId, entries] of hydrated) {
                this.collections.get(collectionId)!.replace(entries);
            }
        } catch (error) {
            for (const [collectionId, entries] of previousEntries) {
                this.collections.get(collectionId)!.replace(entries);
            }
            try {
                await this.databaseHandle.close();
            } catch {
                // Preserve the hydration failure and its actionable location.
            }
            throw this.withLocation(error);
        }
        this.bound = true;
    }

    public attachDatabaseHandle(
        databaseHandle: PersistenceDatabaseHandle
    ): void {
        this.assertOpen();
        if (this.databaseHandle) {
            throw new Error("Persistence database is already attached");
        }
        this.databaseHandle = databaseHandle;
        this.bound = false;
    }

    public setFailureHandler(handler: (error: Error) => void): void {
        this.failureHandler = handler;
    }

    public update<TKey, TValue>(
        collection: PersistentCollection<TKey, TValue>,
        key: TKey,
        updater: (currentValue: TValue | undefined) => TValue | undefined
    ): TValue | undefined {
        this.assertMutationAllowed();
        const currentValue = cloneDeep(collection.get(key));
        const nextValue = updater(currentValue);
        const committedValue = cloneDeep(nextValue);
        const operation = this.createOperation(
            collection.id,
            key,
            committedValue
        );
        collection.apply(key, committedValue);
        this.enqueue([operation]);
        return cloneDeep(committedValue);
    }

    public clear<TKey, TValue>(
        collection: PersistentCollection<TKey, TValue>
    ): void {
        this.assertMutationAllowed();
        const operations = [...collection.keys()].map(
            (key): PersistenceBatchOperation => ({
                type: "del",
                key: this.recordKey(collection.id, key)
            })
        );
        if (!operations.length) return;
        collection.replace([]);
        this.enqueue(operations);
    }

    public deleteMany<TKey, TValue>(
        collection: PersistentCollection<TKey, TValue>,
        keys: readonly TKey[]
    ): TValue[] {
        this.assertMutationAllowed();
        const existing = [...new Set(keys)].flatMap((key) => {
            const value = collection.get(key);
            return value === undefined
                ? []
                : [[key, cloneDeep(value)] as const];
        });
        if (!existing.length) return [];

        for (const [key] of existing) collection.apply(key, undefined, false);
        collection.notifyChanged();
        this.enqueue(
            existing.map(
                ([key]): PersistenceBatchOperation => ({
                    type: "del",
                    key: this.recordKey(collection.id, key)
                })
            )
        );
        return existing.map(([, value]) => value);
    }

    public async flush(): Promise<void> {
        this.assertOpen();
        await this.flushThrough(this.nextRevision);
    }

    public close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        if (this.closed) return Promise.resolve();

        this.closing = true;
        this.clearFlushTimer();
        const targetRevision = this.nextRevision;
        this.closePromise = (async () => {
            let flushError: Error | undefined;
            try {
                await this.flushThrough(targetRevision);
            } catch (error) {
                flushError = this.normalizeError(error);
            }
            try {
                await this.databaseHandle?.close();
            } catch (error) {
                flushError ??= this.normalizeError(error);
            } finally {
                this.closed = true;
                this.closing = false;
                this.rejectWaiters(
                    flushError ?? new Error("Persistence controller is closed")
                );
            }
            if (flushError) throw flushError;
        })();
        return this.closePromise;
    }

    private createOperation<TKey, TValue>(
        collectionId: CollectionId,
        key: TKey,
        value: TValue | undefined
    ): PersistenceBatchOperation {
        return value === undefined
            ? { type: "del", key: this.recordKey(collectionId, key) }
            : {
                  type: "put",
                  key: this.recordKey(collectionId, key),
                  value: this.codec.encode(collectionId, value)
              };
    }

    private enqueue(operations: PersistenceBatchOperation[]): void {
        if (
            !operations.length ||
            !this.databaseHandle ||
            this.inFailureCleanup
        ) {
            return;
        }
        if (this.poisonedError) return;

        const revision = ++this.nextRevision;
        for (const operation of operations) {
            this.pendingRecords.set(String(operation.key), {
                operation,
                revision
            });
        }
        this.maybeWarnPendingSize();

        if (this.pendingRecords.size >= this.maxBatchOperations) {
            this.clearFlushTimer();
            this.startDrain();
        } else {
            this.scheduleFlush();
        }
    }

    private flushThrough(targetRevision: number): Promise<void> {
        if (!this.databaseHandle || targetRevision <= this.persistedRevision) {
            return Promise.resolve();
        }
        if (this.poisonedError) return Promise.reject(this.poisonedError);

        const promise = new Promise<void>((resolve, reject) => {
            this.flushWaiters.push({ targetRevision, resolve, reject });
        });
        this.clearFlushTimer();
        this.startDrain();
        return promise;
    }

    private scheduleFlush(): void {
        if (this.flushTimer || this.drainPromise || !this.pendingRecords.size) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.startDrain();
        }, this.flushIntervalMs);
        this.flushTimer.unref?.();
    }

    private startDrain(): void {
        if (
            this.drainPromise ||
            this.poisonedError ||
            !this.databaseHandle ||
            !this.pendingRecords.size
        ) {
            return;
        }

        const records = [...this.pendingRecords.values()];
        this.pendingRecords.clear();
        const highestRevision = Math.max(
            ...records.map((record) => record.revision)
        );
        this.drainPromise = this.commit(
            records.map((record) => record.operation)
        )
            .then(() => {
                this.persistedRevision = Math.max(
                    this.persistedRevision,
                    highestRevision
                );
                this.resolveWaiters();
            })
            .catch((error) => this.poison(error))
            .finally(() => {
                this.drainPromise = undefined;
                if (this.poisonedError) return;
                if (
                    this.pendingRecords.size >= this.maxBatchOperations ||
                    this.hasWaitingRevision()
                ) {
                    this.startDrain();
                } else {
                    this.scheduleFlush();
                }
            });
    }

    private async commit(
        operations: PersistenceBatchOperation[]
    ): Promise<void> {
        if (!operations.length || !this.databaseHandle) return;
        await this.withCommitDeadline(
            retry(() => this.databaseHandle!.database.batch(operations), {
                maxRetries: this.maxRetries,
                delayMs: 10,
                useExponentialBackoff: true,
                onRetry: (attempt, error) =>
                    this.logger?.warn("Retrying persistence mutation", {
                        attempt,
                        error
                    })
            })
        );
    }

    /**
     * Rejects when the commit doesn't settle within the deadline, so a HUNG
     * batch flows into the same poison path as a rejecting one. The late
     * settlement of the abandoned batch is harmless: waiters were already
     * rejected by poison() and the drain loop stops on poisonedError.
     */
    private withCommitDeadline(commitPromise: Promise<void>): Promise<void> {
        if (!this.commitDeadlineMs) return commitPromise;
        let deadlineTimer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<never>((_, reject) => {
            deadlineTimer = setTimeout(
                () =>
                    reject(
                        new Error(
                            `Persistence commit exceeded its ${this.commitDeadlineMs}ms deadline`
                        )
                    ),
                this.commitDeadlineMs
            );
            deadlineTimer.unref?.();
        });
        return Promise.race([commitPromise, deadline]).finally(() =>
            clearTimeout(deadlineTimer)
        );
    }

    private resolveWaiters(): void {
        for (let index = this.flushWaiters.length - 1; index >= 0; index--) {
            const waiter = this.flushWaiters[index];
            if (waiter.targetRevision > this.persistedRevision) continue;
            this.flushWaiters.splice(index, 1);
            waiter.resolve();
        }
    }

    private rejectWaiters(error: Error): void {
        for (const waiter of this.flushWaiters.splice(0)) waiter.reject(error);
    }

    private hasWaitingRevision(): boolean {
        return this.flushWaiters.some(
            (waiter) => waiter.targetRevision > this.persistedRevision
        );
    }

    private maybeWarnPendingSize(): void {
        if (this.pendingRecords.size < this.pendingWarningOperations) {
            this.pendingWarningEmitted = false;
            return;
        }
        if (this.pendingWarningEmitted) return;
        this.pendingWarningEmitted = true;
        this.logger?.warn(
            "Persistence pending-record high-water mark reached",
            {
                pendingRecords: this.pendingRecords.size,
                warningThreshold: this.pendingWarningOperations
            }
        );
    }

    private clearFlushTimer(): void {
        if (!this.flushTimer) return;
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
    }

    private assertOpen(): void {
        if (this.closed) {
            throw new Error("Persistence controller is closed");
        }
    }

    private assertMutationAllowed(): void {
        this.assertOpen();
        if (!this.bound) {
            throw new Error("Persistence controller is not bound");
        }
        if (this.closing && !this.inFailureCleanup) {
            throw new Error("Persistence controller is closing");
        }
    }

    private poison(error: unknown): void {
        const normalized = this.normalizeError(error);
        if (this.poisonedError) return;
        this.poisonedError = normalized;
        this.logger?.error("Persistence mutation failed", {
            error: normalized
        });
        this.rejectWaiters(normalized);
        if (!this.failureHandler) return;
        this.inFailureCleanup = true;
        try {
            this.failureHandler(normalized);
        } catch (handlerError) {
            this.logger?.error("Persistence failure handler failed", {
                error: this.normalizeError(handlerError)
            });
        } finally {
            this.inFailureCleanup = false;
        }
    }

    private normalizeError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }

    private withLocation(error: unknown): Error {
        const normalized = this.normalizeError(error);
        const location = this.databaseHandle?.location;
        return location
            ? new Error(`${normalized.message} (persistence: ${location})`)
            : normalized;
    }

    private recordKey(
        collectionId: CollectionId,
        key: unknown
    ): EncodedRecordKey {
        return `${RECORD_PREFIX}${collectionId}!${String(key)}`;
    }

    private parseRecordKey(recordKey: EncodedRecordKey): {
        collectionId: CollectionId;
        key: string;
    } {
        const remainder = recordKey.slice(RECORD_PREFIX.length);
        const separator = remainder.indexOf("!");
        if (separator <= 0) {
            throw new Error(`Invalid persistence record key ${recordKey}`);
        }
        return {
            collectionId: remainder.slice(0, separator) as CollectionId,
            key: remainder.slice(separator + 1)
        };
    }
}
