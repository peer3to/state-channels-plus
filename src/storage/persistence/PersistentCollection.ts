import type { PersistenceController } from "./PersistenceController";
import {
    codecs,
    type CollectionId,
    type CollectionValue
} from "./storageCodecs";

import { ethers } from "ethers";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

/** A key's place in `Map` insertion order; a load sorts by it. */
type InsertionSequence = number;
/** `abi.encode(uint256 sequence, bytes value)` */
export type EncodedRecord = string;

/**
 * A `Map` whose writes the controller copies to disk; without a controller it
 * is a plain `Map`. Values are held by reference: the store proxies copy at
 * the boundary.
 */
export class PersistentCollection<TKey, TId extends CollectionId> {
    public readonly id: TId;
    private readonly cache = new Map<TKey, CollectionValue<TId>>();
    private readonly sequences = new Map<TKey, InsertionSequence>();
    private readonly controller?: PersistenceController;
    // rebuilds the owning store's derived indexes after a load
    private readonly onLoad?: () => void;
    private nextSequence = 0;

    constructor(
        id: TId,
        controller?: PersistenceController,
        onLoad?: () => void
    ) {
        this.id = id;
        this.controller = controller;
        this.onLoad = onLoad;
        controller?.register(this);
    }

    public get size(): number {
        return this.cache.size;
    }

    public get(key: TKey): CollectionValue<TId> | undefined {
        return this.cache.get(key);
    }

    public has(key: TKey): boolean {
        return this.cache.has(key);
    }

    public entries(): IterableIterator<[TKey, CollectionValue<TId>]> {
        return this.cache.entries();
    }

    public keys(): IterableIterator<TKey> {
        return this.cache.keys();
    }

    public values(): IterableIterator<CollectionValue<TId>> {
        return this.cache.values();
    }

    /** An overwrite keeps the key's place in the order. */
    public set(key: TKey, value: CollectionValue<TId>): CollectionValue<TId> {
        this.cache.set(key, value);
        if (!this.sequences.has(key)) {
            this.sequences.set(key, this.nextSequence++);
        }
        this.controller?.enqueue(this, key);
        return value;
    }

    /** Writes what `updater` returns; `undefined` deletes the key. */
    public update(
        key: TKey,
        updater: (
            current: CollectionValue<TId> | undefined
        ) => CollectionValue<TId> | undefined
    ): CollectionValue<TId> | undefined {
        const next = updater(this.cache.get(key));
        if (next === undefined) this.delete(key);
        else this.set(key, next);
        return next;
    }

    public delete(key: TKey): boolean {
        if (!this.cache.delete(key)) return false;
        this.sequences.delete(key);
        this.controller?.enqueue(this, key);
        return true;
    }

    /** The key's current disk record; undefined once the key is gone. */
    public encodeRecord(key: TKey): EncodedRecord | undefined {
        const value = this.cache.get(key);
        if (value === undefined) return undefined;
        const codec = codecs[this.id] as {
            encode(value: CollectionValue<TId>): string;
        };
        return abiCoder.encode(
            ["uint256", "bytes"],
            [this.sequences.get(key), codec.encode(value)]
        );
    }

    /** Replaces memory with `records`, in their stored order. */
    public load(records: Array<[TKey, EncodedRecord]>): void {
        const decoded = records.map(([key, encodedRecord]) => {
            try {
                const [sequence, encodedValue] = abiCoder.decode(
                    ["uint256", "bytes"],
                    encodedRecord
                );
                return {
                    key,
                    sequence: Number(sequence),
                    value: codecs[this.id].decode(
                        encodedValue
                    ) as CollectionValue<TId>
                };
            } catch (error) {
                throw new Error(
                    `Cannot decode persisted ${this.id} record ${String(key)}: ${String(error)}`
                );
            }
        });
        decoded.sort((left, right) => left.sequence - right.sequence);
        this.cache.clear();
        this.sequences.clear();
        this.nextSequence = 0;
        for (const { key, sequence, value } of decoded) {
            this.cache.set(key, value);
            this.sequences.set(key, sequence);
            this.nextSequence = sequence + 1;
        }
        this.onLoad?.();
    }
}
