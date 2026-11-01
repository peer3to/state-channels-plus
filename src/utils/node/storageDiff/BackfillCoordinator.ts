import type ABackfillBlockSource from "./backfillBlocks/ABackfillBlockSource";
import {
    type AccountAddress,
    type AccountDiffs,
    type BlockHeader,
    type StagedBlock,
    type StorageSlot
} from "./blockStorageDiff";
import {
    ChainMovedError,
    ContractBackfill,
    type BackfilledState,
    type BackfillCost
} from "./ContractBackfill";
import type { PeerHub, StorageDiffPeer } from "./PeerHub";
import { normalizeBalance, StateCache } from "./StateCache";
import {
    UpstreamLostError,
    UpstreamRequestError,
    type UpstreamRpcClient
} from "./UpstreamRpcClient";
import type { Logger } from "@/utils";
import { toQuantity } from "ethers";

/** Rounds a backfill may take to catch up with a head that keeps moving. */
const BACKFILL_ROUNDS = 100;
/** Times a backfill starts over after a reorg moved blocks under it. */
const BACKFILL_RESTARTS = 5;

/** What one contract's backfill cost and found. */
export interface BackfillRecord extends BackfillCost {
    address: AccountAddress;
    /** Block the contract's code first appears at; undefined for an account without code. */
    deployBlock?: string;
    /** Blocks listed, and how many of them were traced. */
    blocks: number;
    tracedBlocks: number;
    /** Slots found written. */
    slots: number;
    /** Requests of the final balance, nonce and code read. */
    stateReads: number;
    milliseconds: number;
}

/** What the coordinator uses of the service whose accounts it backfills. */
export interface BackfillCoordinatorOptions {
    /** Aborted when the service stops. */
    stopping: AbortSignal;
    /** The canonical history, oldest first; it is replaced as the service loads it. */
    canonical: () => StagedBlock[];
    stateCache: StateCache;
    /** Accounts whose backfill found fewer entries than the chain holds. */
    lazyAccounts: Set<AccountAddress>;
    backfillBlocks: ABackfillBlockSource;
    upstream: () => UpstreamRpcClient | undefined;
    request: (method: string, params: unknown[]) => Promise<unknown>;
    /** Starts keeping the values of an account in every record. */
    watch: (address: AccountAddress) => Promise<void>;
    logger: Logger;
    failureReason: (error: unknown) => string;
    /** Runs a job on the service's serialized queue. */
    enqueue: <T>(job: () => Promise<T>) => Promise<T>;
    peerHub: PeerHub;
    retainedIndex: (blockHash: string) => number;
    fetchHeader: (by: "latest" | bigint | string) => Promise<BlockHeader>;
    /** Asks for the cache to be written after a quiet time. */
    scheduleSave: () => void;
}

/** Rebuilds accounts from their history and tells peers when their state is ready, late or not coming. */
export class BackfillCoordinator {
    private readonly stopping: AbortSignal;
    private readonly canonical: () => StagedBlock[];
    private readonly stateCache: StateCache;
    private readonly lazyAccounts: Set<AccountAddress>;
    private readonly backfillBlocks: ABackfillBlockSource;
    private readonly upstream: () => UpstreamRpcClient | undefined;
    private readonly request: (
        method: string,
        params: unknown[]
    ) => Promise<unknown>;
    private readonly watch: (address: AccountAddress) => Promise<void>;
    private readonly logger: Logger;
    private readonly failureReason: (error: unknown) => string;
    private readonly enqueue: <T>(job: () => Promise<T>) => Promise<T>;
    private readonly peerHub: PeerHub;
    private readonly retainedIndex: (blockHash: string) => number;
    private readonly fetchHeader: (
        by: "latest" | bigint | string
    ) => Promise<BlockHeader>;
    private readonly scheduleSave: () => void;
    // Backfills in flight, one per account.
    private readonly backfills = new Map<AccountAddress, Promise<void>>();

    constructor(options: BackfillCoordinatorOptions) {
        this.stopping = options.stopping;
        this.canonical = options.canonical;
        this.stateCache = options.stateCache;
        this.lazyAccounts = options.lazyAccounts;
        this.backfillBlocks = options.backfillBlocks;
        this.upstream = options.upstream;
        this.request = options.request;
        this.watch = options.watch;
        this.logger = options.logger;
        this.failureReason = options.failureReason;
        this.enqueue = options.enqueue;
        this.peerHub = options.peerHub;
        this.retainedIndex = options.retainedIndex;
        this.fetchHeader = options.fetchHeader;
        this.scheduleSave = options.scheduleSave;
    }

    /** Starts rebuilding `address` from its history, unless that is done or running. */
    start(address: AccountAddress): void {
        if (
            this.backfills.has(address) ||
            this.lazyAccounts.has(address) ||
            this.stateCache.isComplete(address)
        )
            return;
        const job = this.runBackfill(address)
            .catch((error) => {
                this.logger.warn(
                    "Backfill failed; the account is read lazily",
                    {
                        address,
                        reason: this.failureReason(error)
                    }
                );
                // tell the subscribers now, so they do not wait for a snapshot
                return this.enqueue(async () => {
                    for (const peer of this.peerHub.peers.values())
                        if (!peer.closing)
                            this.sendSnapshots(
                                peer,
                                [address],
                                new Set([address])
                            );
                });
            })
            .finally(() => this.backfills.delete(address));
        this.backfills.set(address, job);
    }

    /**
     * Reads the contract's history up to the best head, in rounds: the keys
     * its traces name (never their values) up to a block inside the retained
     * window, where the window's own records add the rest. Then the values of
     * all those keys are read at one block, the head, and the records after
     * it are applied. A covered block that a reorg orphaned starts over.
     */
    private async runBackfill(address: AccountAddress): Promise<void> {
        const started = Date.now();
        const upstream = {
            request: (method: string, params: unknown[]) =>
                this.request(method, params),
            requestBatch: (calls: { method: string; params: unknown[] }[]) =>
                this.upstream()
                    ? this.upstream()!.requestBatch(calls)
                    : calls.map(() =>
                          Promise.reject(
                              new UpstreamLostError("Upstream is not open")
                          )
                      )
        };
        // the records keep its values from now on
        await this.watch(address);
        let restarts = 0;
        let covered: { number: bigint; hash: string } | undefined;
        let keys = new Set<StorageSlot>();
        let record: BackfillRecord | undefined;
        const spend = (backfill: ContractBackfill) => {
            const cost = backfill.spent;
            record ??= {
                address,
                codeProbes: 0,
                blockReads: 0,
                rootReads: 0,
                traces: 0,
                stateReads: 0,
                roundTrips: 0,
                blocks: 0,
                tracedBlocks: 0,
                slots: 0,
                milliseconds: 0
            };
            record.codeProbes += cost.codeProbes;
            record.blockReads += cost.blockReads;
            record.rootReads += cost.rootReads;
            record.traces += cost.traces;
            record.stateReads += cost.stateReads;
            record.roundTrips += cost.roundTrips;
        };
        for (let round = 0; round < BACKFILL_ROUNDS; round++) {
            if (this.stopping.aborted) return;
            const tipRecord = this.canonical()[this.canonical().length - 1];
            const tip = {
                number: BigInt(tipRecord.number),
                hash: tipRecord.hash
            };
            const backfill = new ContractBackfill(
                upstream,
                address,
                this.backfillBlocks
            );
            try {
                if (!covered) {
                    const deploy = await backfill.findDeployBlock(tip.number);
                    if (deploy !== undefined) {
                        const found = await backfill.keysThrough(deploy, tip);
                        for (const slot of found.keys) keys.add(slot);
                        spend(backfill);
                        record!.blocks += found.blocks;
                        record!.tracedBlocks += found.tracedBlocks;
                        record!.deployBlock = toQuantity(deploy);
                    } else spend(backfill);
                    covered = tip;
                } else if (tip.number > covered.number) {
                    const found = await backfill.keysThrough(
                        covered.number + 1n,
                        tip,
                        covered.hash
                    );
                    for (const slot of found.keys) keys.add(slot);
                    spend(backfill);
                    record!.blocks += found.blocks;
                    record!.tracedBlocks += found.tracedBlocks;
                    covered = tip;
                }
                const prepared = await this.enqueue(() =>
                    this.prepareBackfill(address, covered!, keys)
                );
                if (prepared === "again") continue;
                if (prepared === "restart")
                    throw new ChainMovedError("Covered block dropped");
                // the values at the head, read outside the queue
                const reader = new ContractBackfill(
                    upstream,
                    address,
                    this.backfillBlocks
                );
                const state = await reader.readState(
                    prepared.anchor.hash,
                    prepared.keys
                );
                spend(reader);
                // a chain that holds other entries than the history named is not backfilled whole
                // (Asset Hub's tracer can omit a constructor's repeated write: paritytech/polkadot-sdk#13663)
                const held = await this.backfillBlocks.countStorageEntries(
                    address,
                    prepared.anchor
                );
                const slots = Object.keys(state.storage).length;
                const complete = held === undefined || held === slots;
                if (!complete)
                    this.logger.warn(
                        "Backfill found fewer storage entries than the chain holds; the account stays lazy",
                        { address, backfilled: slots, onChain: held }
                    );
                const outcome = await this.enqueue(() =>
                    this.commitBackfill(
                        address,
                        prepared.anchor,
                        state,
                        complete
                    )
                );
                if (outcome === "retry") {
                    covered = prepared.anchor;
                    keys = new Set(prepared.keys);
                    continue;
                }
                record!.slots = Object.keys(state.storage).length;
                record!.milliseconds = Date.now() - started;
                this.logger.info("Backfilled an account", { ...record! });
                return;
            } catch (error) {
                // a reorg moved blocks under the read: read the range again
                if (
                    !(
                        error instanceof ChainMovedError ||
                        error instanceof UpstreamRequestError
                    ) ||
                    ++restarts > BACKFILL_RESTARTS
                )
                    throw error;
                covered = undefined;
                keys = new Set();
                record = undefined;
            }
        }
        throw new Error("The chain kept moving under the backfill");
    }

    /**
     * Once the covered block is inside the window, takes the head as the
     * anchor and adds the keys the window's blocks after the covered one
     * touched. "again" asks for one more round of traces, "restart" for a new
     * backfill after a reorg dropped the block.
     */
    private async prepareBackfill(
        address: AccountAddress,
        covered: { number: bigint; hash: string },
        keys: Set<StorageSlot>
    ): Promise<
        | "again"
        | "restart"
        | { anchor: { number: bigint; hash: string }; keys: Set<StorageSlot> }
    > {
        const index = this.retainedIndex(covered.hash);
        if (index < 0) {
            const floor = BigInt(this.canonical()[0].number);
            if (covered.number >= floor) return "restart";
            // below the window: the blocks up to it are still to be read
            const current = await this.fetchHeader(covered.number);
            return current.hash === covered.hash ? "again" : "restart";
        }
        const all = new Set(keys);
        for (let i = index + 1; i < this.canonical().length; i++)
            for (const slot of this.canonical()[i].touches[address]?.slots ??
                [])
                all.add(slot);
        const head = this.canonical()[this.canonical().length - 1];
        return {
            anchor: { number: BigInt(head.number), hash: head.hash },
            keys: all
        };
    }

    /**
     * Makes the account complete from the values read at `anchor`, if that
     * block is still on the chain: the records after it, which hold the
     * account because it is watched, bring it to the head.
     */
    private async commitBackfill(
        address: AccountAddress,
        anchor: { number: bigint; hash: string },
        state: BackfilledState,
        complete: boolean
    ): Promise<"done" | "retry"> {
        const index = this.retainedIndex(anchor.hash);
        if (index < 0) return "retry";
        const scratch = new StateCache();
        scratch.setComplete(
            address,
            {
                balance: normalizeBalance(state.balance),
                nonce: Number(BigInt(state.nonce)),
                code: state.code
            },
            state.storage
        );
        for (let i = index + 1; i < this.canonical().length; i++) {
            scratch.applyForward(this.canonical()[i]);
        }
        const account = scratch.accountOf(address);
        if (complete)
            this.stateCache.setComplete(
                address,
                {
                    balance: account.balance!,
                    nonce: account.nonce!,
                    code: account.code!
                },
                account.storage ?? {}
            );
        else {
            this.lazyAccounts.add(address);
            // what is known is cached; any other slot is fetched when asked for
            for (const kind of ["balance", "nonce", "code"] as const)
                this.stateCache.set({ kind, address }, account[kind]!);
            for (const [slot, word] of Object.entries(account.storage ?? {}))
                this.stateCache.set({ kind: "slot", address, slot }, word);
        }
        for (const peer of this.peerHub.peers.values()) {
            if (!peer.closing) this.sendSnapshots(peer, [address]);
        }
        this.scheduleSave();
        return "done";
    }

    /**
     * Sends `peer` the complete state of those of `addresses` it subscribed
     * to and has no snapshot of yet, at the best head, one message per
     * subscription.
     */
    sendSnapshots(
        peer: StorageDiffPeer,
        addresses: AccountAddress[],
        lazy: ReadonlySet<AccountAddress> = this.lazyAccounts
    ): void {
        const head = this.canonical()[this.canonical().length - 1];
        // a ready account the cache no longer holds complete is late
        this.noteSnapshotsDelayed(
            peer,
            addresses.filter(
                (address) =>
                    peer.promisedReady.has(address) &&
                    !lazy.has(address) &&
                    !this.stateCache.isComplete(address)
            )
        );
        for (const [subscription, subscribed] of peer.subscriptions) {
            const accounts: AccountDiffs = {};
            // accounts no snapshot is coming for: the peer reads them as needed
            const noSnapshot: AccountAddress[] = [];
            for (const address of addresses) {
                if (!subscribed.includes(address)) continue;
                if (lazy.has(address)) noSnapshot.push(address);
                if (
                    peer.snapshotted.has(address) ||
                    !this.stateCache.isComplete(address)
                )
                    continue;
                accounts[address] = this.stateCache.accountOf(address);
                peer.snapshotted.add(address);
                peer.promisedReady.delete(address);
            }
            if (Object.keys(accounts).length === 0 && noSnapshot.length === 0)
                continue;
            this.peerHub.send(peer.socket, {
                jsonrpc: "2.0",
                method: "scp_snapshot",
                params: {
                    subscription,
                    result: {
                        block: { number: head.number, hash: head.hash },
                        accounts,
                        ...(noSnapshot.length > 0 && { lazy: noSnapshot })
                    }
                }
            });
            this.peerHub.dropIfLagging(peer);
        }
    }

    /**
     * Tells `peer` that the snapshots it was promised or sent as `ready` for
     * those of `addresses` it follows are late, one notice per subscription.
     * An account is told once: it is no longer promised.
     */
    noteSnapshotsDelayed(
        peer: StorageDiffPeer,
        addresses: AccountAddress[]
    ): void {
        if (peer.closing || addresses.length === 0) return;
        const head = this.canonical()[this.canonical().length - 1];
        for (const [subscription, subscribed] of peer.subscriptions) {
            const accounts = [...new Set(addresses)].filter((address) =>
                subscribed.includes(address)
            );
            if (accounts.length === 0) continue;
            this.peerHub.pushDelay(peer, {
                reason: "snapshot-delayed",
                subscription,
                block: { number: head.number, hash: head.hash },
                accounts
            });
        }
        for (const address of addresses) peer.promisedReady.delete(address);
    }
}
