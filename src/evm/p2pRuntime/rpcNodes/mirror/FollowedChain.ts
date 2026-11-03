import type { MirrorStateManager } from "./MirrorStateManager";
import { MirrorUnavailableError } from "./MirrorUnavailableError";
import type {
    AccountAddress,
    BlockEnvironment,
    BlockStorageDiff,
    StorageDiffSnapshot
} from "@/utils/storageDiff/storageDiffWire";

/**
 * Applied blocks kept with their `pre` values for a rollback. A reorg
 * deeper than this clears the cache instead.
 */
const MAX_APPLIED_BLOCKS = 128;

/** A block's height. */
export type BlockNumber = bigint;

/** A block of the chain as the mirror follows it; the mirror's head is the one its cached state is at. */
export type MirrorBlock = { number: BlockNumber; hash: string };

/** What the owner of a {@link FollowedChain} does when the chain it follows changes. */
export interface FollowedChainHandlers {
    /** A block was applied: it reached the head. */
    onArrived(number: BlockNumber): void;
    /** The head moved or the chain was cleared: waits on it can look again. */
    onHeadChanged(): void;
    /** The block with this hash is no longer on the chain. */
    onRolledBack(hash: string): void;
    /** All cached state was forgotten. */
    onCleared(): void;
    /** A snapshot made `address` what the feed said. */
    onSnapshotPlaced(address: AccountAddress): void;
    /** Whether `address` is read from the node: the feed's values for it are not kept. */
    isNodeRead(address: AccountAddress): boolean;
    /** Whether `address` is followed, or about to be: records and snapshots of others change nothing. */
    isFollowed(address: AccountAddress): boolean;
}

/**
 * The chain the mirror's cached state follows: the base block, the blocks
 * applied on it with their `pre` values, and the head they reach. It applies
 * a record on its parent or rolls back to it, and places a snapshot on the
 * block it was taken at.
 */
export class FollowedChain {
    private readonly state: MirrorStateManager;
    private readonly handlers: FollowedChainHandlers;
    /** Each tracked address and the head its cached state began at. */
    private readonly trackedSince = new Map<AccountAddress, bigint>();
    /** The block below `applied`; the head when nothing was applied yet. */
    private baseBlock?: MirrorBlock;
    /** The environment of `base`. */
    private baseEnvironment?: BlockEnvironment;
    /** Blocks applied since `base`, oldest first. */
    private applied: BlockStorageDiff[] = [];
    /** Snapshots from a block the head has not reached, by arrival. */
    private pendingSnapshots: StorageDiffSnapshot[] = [];

    constructor(state: MirrorStateManager, handlers: FollowedChainHandlers) {
        this.state = state;
        this.handlers = handlers;
    }

    /** The block below the applied ones, if the mirror is following. */
    get base(): MirrorBlock | undefined {
        return this.baseBlock;
    }

    /** The block the cached state is at, if the mirror is following. */
    get head(): MirrorBlock | undefined {
        if (!this.base) return undefined;
        const newest = this.applied[this.applied.length - 1];
        return newest ? this.toBlock(newest) : this.base;
    }

    /** The environment of the head block. */
    headEnvironment(): BlockEnvironment {
        const environment =
            this.applied[this.applied.length - 1] ?? this.baseEnvironment;
        if (!environment)
            throw new MirrorUnavailableError("Mirror is not following");
        return environment;
    }

    /** Takes `head` as the base, with `tracked` followed from it. */
    begin(head: BlockEnvironment, tracked: Iterable<AccountAddress>): void {
        this.baseBlock = { number: BigInt(head.number), hash: head.hash };
        this.baseEnvironment = head;
        this.applied = [];
        for (const address of tracked)
            this.trackedSince.set(address, this.baseBlock.number);
    }

    /** Notes that the cached state of `addresses` began at block `number`. */
    trackFrom(addresses: AccountAddress[], number: bigint): void {
        for (const address of addresses) this.trackedSince.set(address, number);
    }

    /** Stops following `addresses`: records and snapshots no longer change their state. */
    untrack(addresses: AccountAddress[]): void {
        for (const address of addresses) this.trackedSince.delete(address);
    }

    hashAt(number: bigint): string | undefined {
        if (this.base!.number === number) return this.base!.hash;
        const record = this.applied[Number(number - this.base!.number) - 1];
        return record && BigInt(record.number) === number
            ? record.hash
            : undefined;
    }

    /**
     * Applies `record` on its parent: the head, or an earlier block the
     * mirror rolls back to. False when the parent is not a block it holds.
     */
    attach(record: BlockStorageDiff): boolean {
        const parent = BigInt(record.number) - 1n;
        const holdsParent = this.hashAt(parent) === record.parentHash;
        if (!holdsParent) return false;
        while (this.head!.number > parent) this.rollBack();
        this.applyBlock(record);
        return true;
    }

    /**
     * Makes the snapshot's accounts what it says, then replays the applied
     * blocks after it for them. A snapshot of a block the head has not
     * reached waits for the head; one of a block that is not on the chain the
     * mirror follows is dropped, and the accounts are read as needed.
     */
    placeSnapshot(snapshot: StorageDiffSnapshot): void {
        const number = BigInt(snapshot.block.number);
        if (number > this.head!.number) {
            this.pendingSnapshots.push(snapshot);
            return;
        }
        if (this.hashAt(number) !== snapshot.block.hash) return;
        // an account read from the node, or no longer followed, takes no state from the feed
        const addresses = Object.keys(snapshot.accounts).filter(
            (address) =>
                this.handlers.isFollowed(address) &&
                !this.handlers.isNodeRead(address)
        );
        this.state.applySnapshot(
            Object.fromEntries(
                addresses.map((address) => [
                    address,
                    snapshot.accounts[address]
                ])
            )
        );
        for (const record of this.applied)
            if (BigInt(record.number) > number)
                this.state.replay(record, addresses);
        for (const address of addresses) {
            this.trackedSince.set(address, number);
            this.handlers.onSnapshotPlaced(address);
        }
    }

    /** Forgets all cached state; the next read starts from the service's best head. */
    clear(): void {
        this.state.clearCaches();
        this.baseBlock = undefined;
        this.baseEnvironment = undefined;
        this.applied = [];
        this.trackedSince.clear();
        this.pendingSnapshots = [];
        this.handlers.onCleared();
    }

    private applyBlock(record: BlockStorageDiff): void {
        // what is cached of an account not followed holds at the old head only
        this.state.forgetUnfollowed();
        this.state.fill(
            Object.fromEntries(
                Object.entries(record.post).filter(([address]) =>
                    this.handlers.isFollowed(address)
                )
            )
        );
        this.forgetNodeRead(record);
        this.applied.push(record);
        this.handlers.onArrived(BigInt(record.number));
        if (this.pendingSnapshots.length > 0) {
            const waiting = this.pendingSnapshots;
            this.pendingSnapshots = [];
            for (const snapshot of waiting) this.placeSnapshot(snapshot);
        }
        while (this.applied.length > MAX_APPLIED_BLOCKS) {
            const oldest = this.applied.shift()!;
            this.baseBlock = this.toBlock(oldest);
            this.baseEnvironment = oldest;
        }
        this.handlers.onHeadChanged();
    }

    private rollBack(): void {
        const record = this.applied.pop();
        if (!record) throw new Error("Cannot roll back below the first block");
        this.state.forgetUnfollowed();
        this.state.revertBlock(record);
        this.forgetNodeRead(record);
        // a block rolled back is no longer the chain's: nothing to wait for
        this.handlers.onRolledBack(record.hash);
        const number = BigInt(record.number);
        // an address followed from this block on has no diff to undo it
        for (const [address, since] of this.trackedSince) {
            if (since >= number) {
                this.state.dropToLazy(address);
                this.trackedSince.set(address, number - 1n);
            }
        }
    }

    private toBlock(record: BlockStorageDiff): MirrorBlock {
        return { number: BigInt(record.number), hash: record.hash };
    }

    /**
     * Forgets what `record` changed of the accounts read from the node, so a
     * read of it goes to the node again rather than taking the feed's value.
     */
    private forgetNodeRead(record: BlockStorageDiff): void {
        for (const [address, post] of Object.entries(record.post))
            if (this.handlers.isNodeRead(address))
                this.state.forget(address, post);
    }
}
