import { coordinateKey, CoordinateKey } from "./keys";
import Clock from "@/Clock";
import { Block } from "@/models";
import { Address, BlockHeight, ForkId, Hash, Signature } from "@/types/types";
import { ethers } from "ethers";

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
    // Recovery attempts already spent rejecting values on this entry. Slicing
    // bounds one call; without a persistent allowance a sender can resend
    // unrecoverable values forever, because rejected ones consume no room and
    // so buy another full pass every time.
    recoveryBudgetSpent?: number;
};

export function sourcePeersAndAuthor(entry: QueuedBlockEntry): Set<Address> {
    const peers = new Set(entry.sourcePeers);
    peers.add(entry.block.author);
    return peers;
}

export class QueueStorage {
    // Structural per-entry retention caps: bound memory against a peer flooding
    // unique junk signatures/sources for one block hash. Far above any real
    // participant union; overflow is retained as a marker, never rejected.
    private static readonly MAX_ENTRY_SOURCES = 128;
    // Confirmation signatures are capped per entry for the same reason sources
    // are. Ingress authenticates the signed block, not each confirmation
    // signature it carries, so one authenticated peer can resend a single hash
    // with fresh junk signatures; without this the merged set grows without
    // limit.
    //
    // Sized against the on-chain bound: the channel union is capped at
    // MAX_CHANNEL_PARTICIPANTS (Errors.sol) where it is proposed, and the
    // author's own signature is held separately, so an honest block needing
    // every participant's confirmation fits with margin.
    //
    // This is a sizing argument, not a proof that a needed signature is never
    // dropped. Two gaps are open and recorded: the maximum is not enforced on
    // every path that makes a participant set authoritative
    // (FIND-SETTLE-1-G2CPV6), and retention counts signature bytes while
    // validity counts recovered signers, so one participant able to produce
    // many valid signatures can occupy slots others need
    // (FIND-QSTORE-3-1HF4V6). Until those are decided this bounds memory,
    // which is what it was added for.
    private static readonly MAX_CHANNEL_PARTICIPANTS = 32;
    private static readonly MAX_ENTRY_SIGNATURES =
        QueueStorage.MAX_CHANNEL_PARTICIPANTS * 4;
    // Total failed recoveries one block hash will ever pay for. A hash that has
    // spent this much has already been shown to carry junk; further unadmitted
    // values are dropped without recovering, so cumulative cost is bounded over
    // the hash's life in the queue rather than only within a single call.
    //
    // Declared after the cap it derives from, deliberately: a static field
    // initialised from one declared later reads undefined, and the ceiling
    // silently becomes NaN -- which compares false against everything, so no
    // ceiling applies at all.
    private static readonly MAX_ENTRY_RECOVERY_FAILURES =
        QueueStorage.MAX_ENTRY_SIGNATURES * 16;
    // A cardinality cap alone bounds nothing: ingress authenticates the signed
    // block, never the confirmation values attached to it, and
    // Block.fromBlockConfirmation casts them straight into a Set. A frame may
    // approach MAX_RPC_FRAME_BYTES, so a capful of unvalidated strings can hold
    // orders of magnitude more memory than a capful of signatures. Only a canonical 65-byte
    // ECDSA signature can ever recover to a participant, so anything else is
    // retained by nobody and dropped here — which makes the count cap a real
    // byte bound: MAX_ENTRY_SIGNATURES * 65 bytes.
    private static readonly SIGNATURE_BYTES = 65;

    private queuedBlocks: Map<Hash, QueuedBlockEntry> = new Map();

    // Secondary index for efficient queries by coordinates
    private blocksByCoordinates: Map<CoordinateKey, Set<Hash>> = new Map();

    // Recovery failures already paid for, keyed by block hash rather than by
    // entry. An entry object does not survive a dequeue, so a per-entry
    // allowance refills every cycle: dequeue, let a fresh copy build a new
    // entry with a new allowance, spend it, restore. Keyed by hash the spend
    // outlives the entry, and clearFork is what releases it.
    private recoverySpend: Map<Hash, number> = new Map();

    /**
     * Build a standalone entry for a block copy — the unit of work the
     * pipeline consumes. Same construction the queue uses, without queueing.
     */
    // Only recovery proves recoverability. Length is not enough, and neither is
    // Signature.from: it length-checks r without requiring 0 < r < n, and even
    // an in-range r usually identifies no curve point ("Cannot find square
    // root"). Every such value throws out of ethers when validation later
    // derives confirmation signers through SignerRecoveryCache, so a value the
    // queue retains but cannot recover takes the recovery path down with it.
    // Attempting the recovery is the only check that matches what the consumer
    // does.
    //
    // The cost is bounded by what can be retained, not by what is offered:
    // callers slice to the remaining room first, so a full entry does no
    // recovery at all and a flooder cannot buy CPU by sending more.
    private isRecoverable(
        entry: QueuedBlockEntry,
        signature: Signature
    ): boolean {
        if (!ethers.isHexString(signature, QueueStorage.SIGNATURE_BYTES))
            return false;
        const hash = entry.block.hash;
        const spent = this.recoverySpend.get(hash) ?? 0;
        if (spent >= QueueStorage.MAX_ENTRY_RECOVERY_FAILURES) return false;
        try {
            entry.block.signatureToAddress(signature);
            return true;
        } catch {
            this.recoverySpend.set(hash, spent + 1);
            entry.recoveryBudgetSpent = spent + 1;
            return false;
        }
    }

    createEntry(block: Block, options?: QueueBlockOptions): QueuedBlockEntry {
        const entry: QueuedBlockEntry = {
            block,
            firstSeenAt: Clock.getTimeInSeconds(),
            sourcePeers: new Set(),
            signatureSources: new Map()
        };
        this.capSignatures(entry);
        this.trackSource(
            entry,
            entry.block.allSignatures,
            options?.senderAddress
        );
        return entry;
    }

    // The cap has to apply to the copy that creates the entry as well as to
    // every later merge: a first copy carrying thousands of confirmation
    // signatures is retained whole otherwise, and capping only the merge path
    // just moves the flood into the opening request.
    private capSignatures(entry: QueuedBlockEntry): void {
        const held = [...entry.block.confirmationSignatures];
        // Slice before recovering, so the cost is bounded by the cap rather
        // than by how much the sender offered.
        const candidates = held.slice(0, QueueStorage.MAX_ENTRY_SIGNATURES);
        const surplus = held.slice(QueueStorage.MAX_ENTRY_SIGNATURES);
        const unrecoverable = candidates.filter(
            (signature) => !this.isRecoverable(entry, signature)
        );
        if (unrecoverable.length || surplus.length) {
            entry.block.removeConfirmationSignatures(
                new Set([...unrecoverable, ...surplus])
            );
            if (surplus.length) entry.overflowedSources = true;
        }
    }

    /** Queue a block for future processing */
    queueBlock(block: Block, options?: QueueBlockOptions): Hash {
        // Check if block already exists in queue
        const existingEntry = this.queuedBlocks.get(block.hash);

        if (existingEntry) {
            // Attribute only the signatures this copy carried to its sender,
            // never signatures pooled from earlier copies -- and only those the
            // entry actually retained, so the attribution map is not spent on
            // signatures the block no longer holds.
            const carried = new Set(block.allSignatures);
            this.mergeBlockCapped(existingEntry, block);
            const retained = new Set(
                [...carried].filter((signature) =>
                    existingEntry.block.allSignatures.has(signature)
                )
            );
            this.trackSource(existingEntry, retained, options?.senderAddress);
            this.queuedBlocks.set(block.hash, existingEntry);
            return block.hash;
        }

        const entry = this.createEntry(block, options);

        // Store the new block confirmation
        this.queuedBlocks.set(block.hash, entry);
        this.addHashToCoordinateIndex(block.hash, block.forkId, block.height);

        return block.hash;
    }

    /** Try to dequeue confirmations for a specific fork/height */
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

    /**
     * Re-insert a previously dequeued entry, merging its signatures and
     * source attribution into any entry queued for the same block meanwhile.
     * Storage only mutates data - it never schedules or fires timeouts;
     * `BlockQueueManager` reads the entry back (`getQueuedEntry`) to (re)schedule.
     */
    restoreEntry(entry: QueuedBlockEntry): void {
        // Normalize first. A restored entry is an object the caller has held
        // across a dequeue, so the queue cannot assume it still respects the
        // cap; the no-existing branch below stores it as-is.
        this.capSignatures(entry);
        this.pruneAttribution(entry);
        const existing = this.queuedBlocks.get(entry.block.hash);
        if (!existing) {
            this.queuedBlocks.set(entry.block.hash, entry);
            this.addHashToCoordinateIndex(
                entry.block.hash,
                entry.block.forkId,
                entry.block.height
            );
            return;
        }

        this.mergeBlockCapped(existing, entry.block);
        existing.firstSeenAt = Math.min(
            existing.firstSeenAt,
            entry.firstSeenAt
        );
        if (entry.overflowedSources) existing.overflowedSources = true;
        // Both sides read the same hash-keyed allowance, so nothing to add.
        existing.recoveryBudgetSpent = this.recoverySpend.get(
            existing.block.hash
        );
        for (const peer of entry.sourcePeers)
            this.addSourcePeer(existing, peer);
        // Only for signatures the capped merge actually kept: attribution for a
        // rejected signature spends a bounded map on a key the block does not
        // hold, and nothing ever reads it.
        const kept = existing.block.allSignatures;
        for (const [signature, peers] of entry.signatureSources) {
            if (!kept.has(signature)) continue;
            for (const peer of peers) {
                this.addSignatureSource(existing, signature, peer);
            }
        }
    }

    // Drop attribution keys for signatures the entry no longer holds.
    private pruneAttribution(entry: QueuedBlockEntry): void {
        const held = entry.block.allSignatures;
        for (const signature of [...entry.signatureSources.keys()]) {
            if (!held.has(signature)) entry.signatureSources.delete(signature);
        }
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
                // The fork is gone, so its recovery allowances are too. This is
                // the only release point: a dequeue must not free one, or the
                // allowance refills every cycle.
                this.recoverySpend.delete(hash);
                removedHashes.push(hash);
            }
            this.blocksByCoordinates.delete(key);
        }
        return removedHashes;
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

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

    // Merge a further copy of a block already held, keeping the confirmation
    // signature set inside the per-entry cap. Signatures already held are free:
    // only novel ones consume budget, so an honest peer resending the same copy
    // never trips the marker. The on-chain timestamp is not capped -- it is a
    // single value read from chain observation, never from a gossiped payload.
    private mergeBlockCapped(entry: QueuedBlockEntry, incoming: Block): void {
        const held = entry.block.confirmationSignatures;
        const novel = [...incoming.confirmationSignatures].filter(
            (signature) => !held.has(signature)
        );
        const room = Math.max(QueueStorage.MAX_ENTRY_SIGNATURES - held.size, 0);
        if (novel.length > room) entry.overflowedSources = true;
        // Recover only what could be kept: a full entry does no crypto work.
        const admitted = novel
            .slice(0, room)
            .filter((signature) => this.isRecoverable(entry, signature));
        entry.block.expandSignatures(admitted);
        const timestamp = incoming.onChainTimestamp;
        if (timestamp !== undefined) entry.block.onChainTimestamp = timestamp;
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
            // The key dimension has to cover every signature the block can
            // retain, or the last retained signatures carry no attribution and
            // their supplier escapes disconnectPeersForSignatures. The block
            // holds at most MAX_ENTRY_SIGNATURES confirmations plus its own
            // original signature. The per-signature peer set below is a
            // different dimension -- how many peers sent the same signature --
            // and stays on the source cap.
            if (
                entry.signatureSources.size >=
                QueueStorage.MAX_ENTRY_SIGNATURES + 1
            ) {
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
