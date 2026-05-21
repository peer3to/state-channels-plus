import { Block } from "@/models";
import { Address, BlockHeight, ForkId, Hash, Signature } from "@/types/types";
import Clock from "@/Clock";

export type QueueBlockOptions = {
    senderAddress?: Address;
};

export type QueuedBlockEntry = {
    block: Block;
    firstSeenAt: number;
    sourcePeers: Set<Address>;
    signatureSources: Map<Signature, Set<Address>>;
};

export class QueueStorage {
    private queuedBlocks: Map<Hash, QueuedBlockEntry> = new Map();

    // Secondary index for efficient queries by coordinates
    private blocksByCoordinates: Map<string, Set<Hash>> = new Map();

    /** Queue a block for future processing */
    queueBlock(block: Block, options?: QueueBlockOptions): Hash {
        const now = Clock.getTimeInSeconds();

        // Check if block already exists in queue
        const existingEntry = this.queuedBlocks.get(block.hash);

        if (existingEntry) {
            existingEntry.block.expandSignatures(block.confirmationSignatures);
            this.mergeOnChainTimestamp(existingEntry.block, block);
            this.trackSource(existingEntry, block, options?.senderAddress);
            this.queuedBlocks.set(block.hash, existingEntry);
            return block.hash;
        }

        const entry: QueuedBlockEntry = {
            block,
            firstSeenAt: now,
            sourcePeers: new Set(),
            signatureSources: new Map()
        };
        this.trackSource(entry, block, options?.senderAddress);

        // Store the new block confirmation
        this.queuedBlocks.set(block.hash, entry);
        this.addHashToCoordinateIndex(block.hash, block.forkId, block.height);

        return block.hash;
    }

    /** Try to dequeue confirmations for a specific fork/height */
    tryDequeueAt(forkId: ForkId, height: BlockHeight): QueuedBlockEntry[] {
        const coordinateKey = this.coordinatesToKey(forkId, height);
        const hashSet = this.blocksByCoordinates.get(coordinateKey);

        if (!hashSet) {
            return [];
        }

        const entries = this.dequeueHashes(hashSet);

        this.blocksByCoordinates.delete(coordinateKey);

        return entries;
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

        const entries = this.dequeueHashes(hashes);
        this.blocksByCoordinates.delete(lowestKey);

        return entries;
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

    getQueuedBlock(blockHash: Hash): Block | undefined {
        return this.queuedBlocks.get(blockHash)?.block;
    }

    getSignatureSources(
        blockHash: Hash,
        signature: Signature
    ): Set<Address> | undefined {
        return this.queuedBlocks
            .get(blockHash)
            ?.signatureSources.get(signature);
    }

    getSourcePeers(blockHash: Hash): Set<Address> {
        return this.queuedBlocks.get(blockHash)?.sourcePeers ?? new Set();
    }

    removeBlock(blockHash: Hash): QueuedBlockEntry | undefined {
        const entry = this.queuedBlocks.get(blockHash);
        if (!entry) return undefined;

        this.queuedBlocks.delete(blockHash);
        const coordinateKey = this.coordinatesToKey(
            entry.block.forkId,
            entry.block.height
        );
        const hashes = this.blocksByCoordinates.get(coordinateKey);
        hashes?.delete(blockHash);
        if (hashes?.size === 0) {
            this.blocksByCoordinates.delete(coordinateKey);
        }
        return entry;
    }

    clearFork(forkId: ForkId): Hash[] {
        const removedHashes: Hash[] = [];
        for (const [key, hashSet] of this.blocksByCoordinates.entries()) {
            const { forkId: queuedForkId } = this.keyToCoordinates(key);
            if (queuedForkId !== String(forkId)) continue;

            for (const hash of hashSet) {
                this.queuedBlocks.delete(hash);
                removedHashes.push(hash);
            }
            this.blocksByCoordinates.delete(key);
        }
        return removedHashes;
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
        const entries: QueuedBlockEntry[] = [];

        for (const hash of hashSet) {
            const entry = this.queuedBlocks.get(hash);
            if (entry) {
                entries.push(entry);
                this.queuedBlocks.delete(hash);
            }
        }

        return entries;
    }

    private trackSource(
        entry: QueuedBlockEntry,
        block: Block,
        senderAddress?: Address
    ): void {
        if (!senderAddress) return;

        entry.sourcePeers.add(senderAddress);
        for (const signature of block.allSignatures) {
            const peers = entry.signatureSources.get(signature) ?? new Set();
            peers.add(senderAddress);
            entry.signatureSources.set(signature, peers);
        }
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
