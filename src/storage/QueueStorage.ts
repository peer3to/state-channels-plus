import { Block } from "@/models";
import { Address, BlockHeight, ForkId, Hash, Signature } from "@/types/types";
import Clock from "@/Clock";
import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

export type QueueBlockOptions = {
    senderAddress?: Address;
};

export type QueuedBlockEntry = {
    block: Block;
    firstSeenAt: number;
    sourcePeers: Set<Address>;
    signatureSources: Map<Signature, Set<Address>>;
    // Set once a structural cap was hit: a peer flooded unique junk signatures
    // for this hash. Attribution/rate-limiting hint only - never a validity
    // decision (a later valid copy still processes).
    overflowedSources?: boolean;
};

export class QueueStorage {
    // Structural per-entry retention caps: bound memory against a peer flooding
    // unique junk signatures/sources for one block hash. Far above any real
    // participant union; overflow is retained as a marker, never rejected.
    private static readonly MAX_ENTRY_SOURCES = 128;

    private readonly queuedBlocks: PersistentCollection<Hash, QueuedBlockEntry>;

    // Secondary index for efficient queries by coordinates
    private blocksByCoordinates: Map<string, Set<Hash>> = new Map();

    constructor(controller?: PersistenceController) {
        this.queuedBlocks = new PersistentCollection("queues", controller, () =>
            this.rebuildIndexes()
        );
    }

    /**
     * Build a standalone entry for a block copy — the unit of work the
     * pipeline consumes. Same construction the queue uses, without queueing.
     */
    createEntry(block: Block, options?: QueueBlockOptions): QueuedBlockEntry {
        const entry: QueuedBlockEntry = {
            block,
            firstSeenAt: Clock.getTimeInSeconds(),
            sourcePeers: new Set(),
            signatureSources: new Map()
        };
        this.trackSource(entry, block.allSignatures, options?.senderAddress);
        return entry;
    }

    /** Queue a block for future processing */
    queueBlock(block: Block, options?: QueueBlockOptions): Hash {
        this.queuedBlocks.update(block.hash, (entry) => {
            if (entry) {
                // Check if block already exists in queue
                // Attribute only the signatures this copy carried to its sender,
                // never signatures pooled from earlier copies.
                this.trackSource(
                    entry,
                    block.allSignatures,
                    options?.senderAddress
                );
                entry.block.expandSignatures(block.confirmationSignatures);
                this.mergeOnChainTimestamp(entry.block, block);
                return entry;
            }

            // Store the new block confirmation
            return this.createEntry(block, options);
        });

        return block.hash;
    }

    /** Try to dequeue confirmations for a specific fork/height */
    tryDequeueAt(forkId: ForkId, height: BlockHeight): QueuedBlockEntry[] {
        const coordinateKey = this.coordinatesToKey(forkId, height);
        const hashSet = this.blocksByCoordinates.get(coordinateKey);

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

    public getEntries(): QueuedBlockEntry[] {
        return [...this.queuedBlocks.values()];
    }

    /**
     * Re-insert a previously dequeued entry, merging its signatures and
     * source attribution into any entry queued for the same block meanwhile.
     * Storage only mutates data - it never schedules or fires timeouts;
     * `BlockQueueManager` reads the entry back (`getQueuedEntry`) to (re)schedule.
     */
    restoreEntry(entry: QueuedBlockEntry): void {
        this.queuedBlocks.update(entry.block.hash, (existing) => {
            if (!existing) return entry;
            existing.block.expandSignatures(entry.block.confirmationSignatures);
            this.mergeOnChainTimestamp(existing.block, entry.block);
            existing.firstSeenAt = Math.min(
                existing.firstSeenAt,
                entry.firstSeenAt
            );
            if (entry.overflowedSources) existing.overflowedSources = true;
            for (const peer of entry.sourcePeers) {
                this.addSourcePeer(existing, peer);
            }
            for (const [signature, peers] of entry.signatureSources) {
                for (const peer of peers) {
                    this.addSignatureSource(existing, signature, peer);
                }
            }
            return existing;
        });
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

    public rebuildIndexes(): void {
        this.blocksByCoordinates.clear();
        for (const [hash, entry] of this.queuedBlocks.entries()) {
            this.addHashToCoordinateIndex(
                hash,
                entry.block.forkId,
                entry.block.height
            );
        }
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private coordinatesToKey(forkId: ForkId, height: BlockHeight): string {
        return `${forkId}:${height}`;
    }

    private addHashToCoordinateIndex(
        hash: Hash,
        forkId: ForkId,
        height: BlockHeight
    ): void {
        const coordinateKey = this.coordinatesToKey(forkId, height);

        if (!this.blocksByCoordinates.has(coordinateKey)) {
            this.blocksByCoordinates.set(coordinateKey, new Set());
        }
        this.blocksByCoordinates.get(coordinateKey)!.add(hash);
    }

    private dequeueHashes(hashSet: Set<Hash>): QueuedBlockEntry[] {
        return this.queuedBlocks.takeMany([...hashSet]);
    }

    private trackSource(
        entry: QueuedBlockEntry,
        signatures: Iterable<Signature>,
        senderAddress?: Address
    ): void {
        if (!senderAddress) return;

        this.addSourcePeer(entry, senderAddress);
        for (const signature of signatures) {
            this.addSignatureSource(entry, signature, senderAddress);
        }
    }

    // Capped inserts: retention stops at MAX_ENTRY_SOURCES and flips the
    // overflow marker; existing members are never evicted, so a junk-first
    // flood can't crowd out an already-tracked honest source, and a later
    // valid copy is never rejected for it.
    private addSourcePeer(entry: QueuedBlockEntry, peer: Address): void {
        if (entry.sourcePeers.has(peer)) return;
        if (entry.sourcePeers.size >= QueueStorage.MAX_ENTRY_SOURCES) {
            entry.overflowedSources = true;
            return;
        }
        entry.sourcePeers.add(peer);
    }

    private addSignatureSource(
        entry: QueuedBlockEntry,
        signature: Signature,
        peer: Address
    ): void {
        let peers = entry.signatureSources.get(signature);
        if (!peers) {
            if (entry.signatureSources.size >= QueueStorage.MAX_ENTRY_SOURCES) {
                entry.overflowedSources = true;
                return;
            }
            peers = new Set();
            entry.signatureSources.set(signature, peers);
        }
        if (peers.has(peer)) return;
        if (peers.size >= QueueStorage.MAX_ENTRY_SOURCES) {
            entry.overflowedSources = true;
            return;
        }
        peers.add(peer);
    }

    private mergeOnChainTimestamp(existing: Block, incoming: Block): void {
        const incomingTimestamp = incoming.onChainTimestamp;
        if (incomingTimestamp === undefined) return;

        existing.onChainTimestamp = incomingTimestamp;
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
