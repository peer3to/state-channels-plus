import { coordinateKey, CoordinateKey } from "./keys";
import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import {
    Address,
    BlockHeight,
    Bytes,
    ForkId,
    Hash,
    Signature
} from "@/types/types";

import { getChecksumAddress } from "@/utils/address";

export enum BlockOrigin {
    NETWORK,
    CALLDATA,
    PROOF
}

export type QueueBlockOptions =
    | { origin: BlockOrigin.NETWORK; senderAddress: Address }
    | { origin: BlockOrigin.CALLDATA | BlockOrigin.PROOF };

/**
 * What a replayed block is judged from: the block it extends (none for the
 * fork genesis), that block's resulting snapshot and its state.
 */
export type BlockPredecessor = {
    block?: Block;
    snapshot: StateSnapshot;
    state: Bytes;
};

export type QueuedBlockEntry = {
    block: Block;
    firstSeenAt: number;
    origin: QueueBlockOptions["origin"];
    sourcesToSignatures: Map<Address, Set<Signature>>;
    /** set only by dispute replay: judge the block from this, not storage */
    predecessor?: BlockPredecessor;
};

export function getSourcePeers(entry: QueuedBlockEntry): Set<Address> {
    return new Set(entry.sourcesToSignatures.keys());
}

export function getSourcePeersAndAuthor(entry: QueuedBlockEntry): Set<Address> {
    return new Set([...entry.sourcesToSignatures.keys(), entry.block.author]);
}

export function getSignatureSuppliers(
    entry: QueuedBlockEntry,
    signatures: Set<Signature>
): Set<Address> {
    return new Set(
        [...entry.sourcesToSignatures]
            .filter(([, supplied]) =>
                [...signatures].some((signature) => supplied.has(signature))
            )
            .map(([source]) => source)
    );
}

// Production injects the deployed maximum.
const DEFAULT_MAX_CHANNEL_PARTICIPANTS = 32;

export class QueueStorage {
    public readonly maxChannelParticipants: number;
    private readonly queuedBlocks: PersistentCollection<Hash, QueuedBlockEntry>;
    private readonly blocksByCoordinates: Map<CoordinateKey, Set<Hash>> =
        new Map();

    constructor(
        maxChannelParticipants = DEFAULT_MAX_CHANNEL_PARTICIPANTS,
        controller?: PersistenceController
    ) {
        if (
            !Number.isSafeInteger(maxChannelParticipants) ||
            maxChannelParticipants < 1
        ) {
            throw new Error(
                `QueueStorage: maxChannelParticipants must be a positive safe integer, got ${maxChannelParticipants}`
            );
        }
        this.maxChannelParticipants = maxChannelParticipants;
        this.queuedBlocks = new PersistentCollection("queues", controller, () =>
            this.rebuildIndexes()
        );
    }

    createEntry(block: Block, options: QueueBlockOptions): QueuedBlockEntry {
        const entry: QueuedBlockEntry = {
            // `block` is this call's own copy (the storage boundary clones
            // arguments), so the entry reuses its decode and hash.
            block: block.authorSignedCopy(),
            firstSeenAt: Clock.getTimeInSeconds(),
            origin: options.origin,
            sourcesToSignatures: new Map()
        };
        // Each source gets N values including the author: at most N² across N sources.
        // Count policy: docs/spec/specification/storage/queue.md (REQ-QSTORE-2).
        this.mergeEntry(entry, {
            ...entry,
            block,
            sourcesToSignatures:
                options.origin === BlockOrigin.NETWORK
                    ? new Map([
                          [
                              getChecksumAddress(options.senderAddress),
                              new Set([
                                  block.originalSignature,
                                  ...block.confirmationSignatures
                              ])
                          ]
                      ])
                    : new Map()
        });
        return entry;
    }

    queueBlock(block: Block, options: QueueBlockOptions): Hash | undefined {
        const incoming = this.createEntry(block, options);
        let accepted = true;
        this.queuedBlocks.update(block.hash, (existing) => {
            if (!existing) return incoming;
            accepted = this.mergeEntry(existing, incoming);
            return existing;
        });
        return accepted ? block.hash : undefined;
    }

    restoreEntry(entry: QueuedBlockEntry): void {
        this.queuedBlocks.update(entry.block.hash, (existing) => {
            if (!existing) return entry;
            this.mergeEntry(existing, entry);
            existing.firstSeenAt = Math.min(
                existing.firstSeenAt,
                entry.firstSeenAt
            );
            return existing;
        });
    }

    private mergeEntry(
        target: QueuedBlockEntry,
        incoming: QueuedBlockEntry
    ): boolean {
        if (!incoming.sourcesToSignatures.size) {
            target.block.mergeFrom(incoming.block);
            return true;
        }
        const signatures = new Set<Signature>();
        const liveSignatures = incoming.block.allSignatures;
        let acceptedSource = false;
        for (const [source, offered] of incoming.sourcesToSignatures) {
            let supplied = target.sourcesToSignatures.get(source);
            if (!supplied) {
                // At most maxChannelParticipants sources
                if (
                    target.sourcesToSignatures.size >=
                    this.maxChannelParticipants
                )
                    continue;
                supplied = new Set();
                target.sourcesToSignatures.set(source, supplied);
            }
            acceptedSource = true;
            for (const signature of offered) {
                if (!supplied.has(signature)) {
                    // At most maxChannelParticipants signatures per source
                    if (supplied.size >= this.maxChannelParticipants) continue;
                    supplied.add(signature);
                }
                if (liveSignatures.has(signature)) signatures.add(signature);
            }
        }
        if (!acceptedSource) return false;
        signatures.delete(target.block.originalSignature);
        // The target's decode is reused: same signed bytes, no confirmations.
        const admitted = target.block.authorSignedCopy();
        admitted.onChainTimestamp = incoming.block.onChainTimestamp;
        admitted.expandSignatures(signatures);
        target.block.mergeFrom(admitted);
        return true;
    }

    tryDequeueAt(forkId: ForkId, height: BlockHeight): QueuedBlockEntry[] {
        const key = coordinateKey(forkId, height);
        const hashSet = this.blocksByCoordinates.get(key);

        if (!hashSet) {
            return [];
        }

        return this.dequeueHashes(hashSet);
    }

    tryDequeuePriority(
        forkId: ForkId,
        maxHeight: BlockHeight
    ): QueuedBlockEntry[] {
        let lowestHeight: BlockHeight | undefined;
        let lowestKey: string | undefined;

        for (const key of this.blocksByCoordinates.keys()) {
            const { forkId: queuedForkId, height } = this.keyToCoordinates(key);
            if (queuedForkId !== String(forkId)) continue;
            if (height > maxHeight) continue;
            if (lowestHeight === undefined || height < lowestHeight) {
                lowestHeight = height;
                lowestKey = key;
            }
        }

        if (!lowestKey) return [];

        const hashes = this.blocksByCoordinates.get(lowestKey);
        if (!hashes) return [];

        return this.dequeueHashes(hashes);
    }

    isBlockQueued(block: Block, options?: { hash?: Hash }): boolean {
        const blockHash = options?.hash || block.hash;

        if (!this.queuedBlocks.has(blockHash)) {
            return false;
        }

        return true;
    }

    getQueuedEntry(blockHash: Hash): QueuedBlockEntry | undefined {
        return this.queuedBlocks.get(blockHash);
    }

    getEntries(): QueuedBlockEntry[] {
        return [...this.queuedBlocks.values()];
    }

    removeBlock(blockHash: Hash): QueuedBlockEntry | undefined {
        return this.queuedBlocks.takeMany([blockHash])[0];
    }

    clearFork(forkId: ForkId): Hash[] {
        const removedHashes: Hash[] = [];
        for (const [key, hashSet] of this.blocksByCoordinates.entries()) {
            const { forkId: queuedForkId } = this.keyToCoordinates(key);
            if (queuedForkId !== String(forkId)) continue;

            for (const hash of hashSet) {
                removedHashes.push(hash);
            }
        }
        this.queuedBlocks.deleteMany(removedHashes);
        return removedHashes;
    }

    clear(): void {
        this.queuedBlocks.clear();
    }

    rebuildIndexes(): void {
        this.blocksByCoordinates.clear();
        for (const [hash, entry] of this.queuedBlocks.entries()) {
            this.addHashToCoordinateIndex(
                hash,
                entry.block.forkId,
                entry.block.height
            );
        }
    }

    private addHashToCoordinateIndex(
        hash: Hash,
        forkId: ForkId,
        height: BlockHeight
    ): void {
        const key = coordinateKey(forkId, height);

        if (!this.blocksByCoordinates.has(key)) {
            this.blocksByCoordinates.set(key, new Set());
        }
        this.blocksByCoordinates.get(key)!.add(hash);
    }

    private dequeueHashes(hashSet: Set<Hash>): QueuedBlockEntry[] {
        return this.queuedBlocks.takeMany([...hashSet]);
    }

    private keyToCoordinates(key: string): {
        forkId: string;
        height: BlockHeight;
    } {
        const separatorIndex = key.lastIndexOf(":");
        return {
            forkId: key.slice(0, separatorIndex),
            height: Number(key.slice(separatorIndex + 1))
        };
    }
}
