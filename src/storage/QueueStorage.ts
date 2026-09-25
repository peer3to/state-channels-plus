import { coordinateKey, CoordinateKey } from "./keys";
import Clock from "@/Clock";
import { Block } from "@/models";
import { Address, BlockHeight, ForkId, Hash, Signature } from "@/types/types";

import { getChecksumAddress } from "@/utils/address";

export enum BlockOrigin {
    NETWORK,
    CALLDATA,
    PROOF
}

export type QueueBlockOptions =
    | { origin: BlockOrigin.NETWORK; senderAddress: Address }
    | { origin: BlockOrigin.CALLDATA | BlockOrigin.PROOF };

export type QueuedBlockEntry = {
    block: Block;
    firstSeenAt: number;
    origin: QueueBlockOptions["origin"];
    sourcesToSignatures: Map<Address, Set<Signature>>;
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
    private readonly queuedBlocks: Map<Hash, QueuedBlockEntry> = new Map();
    private readonly blocksByCoordinates: Map<CoordinateKey, Set<Hash>> =
        new Map();

    constructor(maxChannelParticipants = DEFAULT_MAX_CHANNEL_PARTICIPANTS) {
        if (
            !Number.isSafeInteger(maxChannelParticipants) ||
            maxChannelParticipants < 1
        ) {
            throw new Error(
                `QueueStorage: maxChannelParticipants must be a positive safe integer, got ${maxChannelParticipants}`
            );
        }
        this.maxChannelParticipants = maxChannelParticipants;
    }

    createEntry(block: Block, options: QueueBlockOptions): QueuedBlockEntry {
        const entry: QueuedBlockEntry = {
            block: Block.fromSignedBlock(
                block.signedBlock,
                block.onChainTimestamp
            ),
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
        const existing = this.queuedBlocks.get(block.hash);
        if (existing) {
            if (!this.mergeEntry(existing, incoming)) return undefined;
        } else {
            this.queuedBlocks.set(block.hash, incoming);
            this.addHashToCoordinateIndex(
                block.hash,
                block.forkId,
                block.height
            );
        }
        return block.hash;
    }

    restoreEntry(entry: QueuedBlockEntry): void {
        const existing = this.queuedBlocks.get(entry.block.hash);
        if (existing) {
            this.mergeEntry(existing, entry);
            existing.firstSeenAt = Math.min(
                existing.firstSeenAt,
                entry.firstSeenAt
            );
        } else {
            this.queuedBlocks.set(entry.block.hash, entry);
            this.addHashToCoordinateIndex(
                entry.block.hash,
                entry.block.forkId,
                entry.block.height
            );
        }
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
        const admitted = Block.fromSignedBlock(
            target.block.signedBlock,
            incoming.block.onChainTimestamp
        );
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

        const entries = this.dequeueHashes(hashSet);

        this.blocksByCoordinates.delete(key);

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

    removeBlock(blockHash: Hash): QueuedBlockEntry | undefined {
        const entry = this.queuedBlocks.get(blockHash);
        if (!entry) return undefined;

        this.queuedBlocks.delete(blockHash);
        const key = coordinateKey(entry.block.forkId, entry.block.height);
        const hashes = this.blocksByCoordinates.get(key);
        hashes?.delete(blockHash);
        if (hashes?.size === 0) {
            this.blocksByCoordinates.delete(key);
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

    clear(): void {
        this.queuedBlocks.clear();
        this.blocksByCoordinates.clear();
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
