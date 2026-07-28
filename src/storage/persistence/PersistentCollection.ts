import cloneDeep from "lodash.clonedeep";

import type { CollectionId } from "./PersistenceRecordCodec";
import type { PersistenceController } from "./PersistenceController";

export type PersistentCollectionUpdate<TValue> = (
    currentValue: TValue | undefined
) => TValue | undefined;

export class PersistentCollection<TKey, TValue> {
    public readonly id: CollectionId;
    private readonly cache = new Map<TKey, TValue>();
    private controller?: PersistenceController;
    private readonly onCacheChanged?: () => void;

    constructor(
        id: CollectionId,
        controller?: PersistenceController,
        onCacheChanged?: () => void
    ) {
        this.id = id;
        this.controller = controller;
        this.onCacheChanged = onCacheChanged;
        controller?.register(this);
    }

    public attach(controller: PersistenceController): void {
        if (this.controller === controller) return;
        if (this.controller) {
            throw new Error(`${this.id} is already attached to a controller`);
        }
        this.controller = controller;
        controller.register(this);
    }

    public get(key: TKey): TValue | undefined {
        return this.cache.get(key);
    }

    public has(key: TKey): boolean {
        return this.cache.has(key);
    }

    public entries(): IterableIterator<[TKey, TValue]> {
        return this.cache.entries();
    }

    public keys(): IterableIterator<TKey> {
        return this.cache.keys();
    }

    public values(): IterableIterator<TValue> {
        return this.cache.values();
    }

    public get size(): number {
        return this.cache.size;
    }

    public set(key: TKey, value: TValue): TValue {
        if (!this.controller) {
            const copiedValue = cloneDeep(value);
            this.cache.set(key, copiedValue);
            this.notifyChanged();
            return cloneDeep(copiedValue);
        }
        return this.controller.update(this, key, () =>
            cloneDeep(value)
        ) as TValue;
    }

    public update(
        key: TKey,
        updater: PersistentCollectionUpdate<TValue>
    ): TValue | undefined {
        if (!this.controller) {
            const nextValue = updater(cloneDeep(this.cache.get(key)));
            const committedValue = cloneDeep(nextValue);
            this.apply(key, committedValue);
            return cloneDeep(committedValue);
        }
        return this.controller.update(this, key, updater);
    }

    public delete(key: TKey): boolean {
        if (!this.cache.has(key)) return false;
        this.update(key, () => undefined);
        return true;
    }

    public deleteMany(keys: readonly TKey[]): void {
        this.takeMany(keys);
    }

    public takeMany(keys: readonly TKey[]): TValue[] {
        if (!this.controller) {
            const values = keys.flatMap((key) => {
                const value = this.cache.get(key);
                this.cache.delete(key);
                return value === undefined ? [] : [cloneDeep(value)];
            });
            if (values.length) this.notifyChanged();
            return values;
        }
        return this.controller.deleteMany(this, keys);
    }

    public clear(): void {
        if (!this.controller) {
            if (!this.cache.size) return;
            this.cache.clear();
            this.notifyChanged();
            return;
        }
        this.controller.clear(this);
    }

    public apply(key: TKey, value: TValue | undefined, notify = true): void {
        if (value === undefined) {
            this.cache.delete(key);
        } else {
            this.cache.set(key, value);
        }
        if (notify) this.notifyChanged();
    }

    public replace(entries: Iterable<[TKey, TValue]>): void {
        this.cache.clear();
        for (const [key, value] of entries) {
            this.cache.set(key, value);
        }
        this.notifyChanged();
    }

    public notifyChanged(): void {
        this.onCacheChanged?.();
    }
}
