import { Block } from "@/models";
import { BlockValidationResult, TimeConfig } from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";
import { TimeoutManager } from "@/utils/TimeoutManager";
import Clock from "@/Clock";
import {
    sourcePeersAndAuthor,
    type QueuedBlockEntry
} from "@/storage/QueueStorage";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import type StateManager from "../StateManager";
import type AValidationStrategy from "../validationStrategy/AValidationStrategy";

export type IngestBlockConfirmationOptions = {
    onChainTimestamp?: Timestamp;
    validationStrategy?: AValidationStrategy;
    senderAddress?: Address;
};

export default class BlockQueueManager {
    private readonly timeoutHandles: Map<Hash, ReturnType<typeof setTimeout>> =
        new Map();
    private readonly logger: Logger;

    // Fork-recovery gate. A mismatched block may just mean we're late to reduce
    // our own disputed current fork. Reducing takes the StateManager mutex, so
    // it MUST run detached (ingest can be under that mutex via the dispute
    // pipeline re-ingest paths) - awaiting it inline would deadlock. The gate
    // coalesces a junk-fork flood into one in-flight task per fork and suppresses
    // re-scheduling until the kill period end. Both maps are keyed by the fork
    // being reduced and cleared on transition (`onForkTransition`).
    private readonly recoveryScheduledForFork: Set<ForkId> = new Set();
    private readonly recoverySuppressedUntil: Map<ForkId, Timestamp> =
        new Map();

    constructor(
        private readonly stateManager: StateManager,
        private readonly timeConfig: TimeConfig,
        private readonly timeoutManager: TimeoutManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "BlockQueueManager" });
    }

    public async ingestBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        options?: IngestBlockConfirmationOptions
    ): Promise<boolean> {
        try {
            const strategy =
                options?.validationStrategy ||
                this.stateManager.getActiveValidationStrategy();

            const isAuthentic =
                await this.stateManager.validationService.isBlockConfirmationAuthentic(
                    blockConfirmation
                );

            if (!isAuthentic) {
                const validationResult =
                    await strategy.authenticateBlockFailed(blockConfirmation);
                this.logger.warn(
                    "ingestBlockConfirmation - authentication failed",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockConfirmationStructMetadata(
                            blockConfirmation
                        )
                    }
                );
                return strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            const block = Block.fromBlockConfirmation(
                blockConfirmation,
                options?.onChainTimestamp
            );

            if (this.isBlockStored(block)) {
                this.scheduleStoredBlockConfirmationMerge(
                    this.stateManager.storage.queues.createEntry(block, {
                        senderAddress: options?.senderAddress
                    }),
                    strategy
                );
                return true;
            }

            if (!this.isBlockForThisChannel(block)) {
                this.logger.warn("ingestBlockConfirmation - wrong channel", {
                    expectedChannelId: String(this.stateManager.channelId),
                    blockChannelId: String(block.channelId),
                    senderAddress: options?.senderAddress,
                    block: LoggerUtils.getBlockMetadata(
                        block,
                        this.stateManager.storage
                    )
                });
                return !options?.senderAddress;
            }

            if (
                await this.stateManager.validationService.isDisputedFork(
                    block.forkId,
                    block.channelId
                )
            ) {
                this.clearFork(block.forkId);
                this.logger.verbose(
                    "ingestBlockConfirmation - ignoring unstored block on disputed fork",
                    {
                        block: LoggerUtils.getBlockMetadata(
                            block,
                            this.stateManager.storage
                        )
                    }
                );
                return true;
            }

            if (block.forkId !== this.stateManager.forkId) {
                await this.maybeScheduleForkRecovery(block.channelId);
                this.logger.warn(
                    "ingestBlockConfirmation - block on non-current fork queued",
                    {
                        expectedForkId: String(this.stateManager.forkId),
                        block: LoggerUtils.getBlockMetadata(
                            block,
                            this.stateManager.storage
                        )
                    }
                );
            }

            const hash = this.stateManager.storage.queues.queueBlock(block, {
                senderAddress: options?.senderAddress
            });
            this.scheduleQueueTimeout(hash);
            this.scheduleQueueExecution(block.forkId);

            return true;
        } catch (error) {
            this.logger.error(`Error ingesting block confirmation:`, { error });
            return false;
        }
    }

    public onForkTransition(): void {
        this.recoveryScheduledForFork.clear();
        this.recoverySuppressedUntil.clear();
    }

    public async tryExecuteFromQueue(forkId?: ForkId): Promise<void> {
        const activeForkId = forkId ?? this.stateManager.forkId;
        // A scheduled forkId is not authority - a fork transition may have
        // landed since; the entries drain via the post-transition call.
        if (activeForkId !== this.stateManager.forkId) return;
        const maxHeight =
            this.stateManager.storage.blocks.getNextBlockHeight(activeForkId);

        const entries = this.stateManager.storage.queues.tryDequeuePriority(
            activeForkId,
            maxHeight
        );

        if (entries.length === 0) return;

        if (
            await this.stateManager.validationService.isDisputedFork(
                entries[0].block.forkId,
                entries[0].block.channelId
            )
        ) {
            for (const entry of entries) {
                this.cancelQueueTimeout(entry.block.hash);
            }
            this.clearFork(entries[0].block.forkId);
            this.logger.verbose(
                "tryExecuteFromQueue - discarded queued blocks for disputed fork",
                {
                    forkId: entries[0].block.forkId,
                    removedCount: entries.length
                }
            );
            return;
        }

        for (const entry of entries) {
            this.cancelQueueTimeout(entry.block.hash);
            this.scheduleQueuedEntryExecution(entry);
        }
    }

    public clearFork(forkId: ForkId): void {
        const removedHashes =
            this.stateManager.storage.queues.clearFork(forkId);
        for (const hash of removedHashes) {
            this.cancelQueueTimeout(hash);
        }
        this.logger.verbose("Cleared queued blocks for disputed fork", {
            forkId,
            removedCount: removedHashes.length
        });
    }

    public disconnectPeersForSignatures(
        entry: QueuedBlockEntry,
        signatures: Set<Signature>
    ): void {
        const disconnectedPeers = new Set<Address>();
        for (const signature of signatures) {
            const peers = entry.signatureSources.get(signature);
            if (!peers) continue;
            for (const peer of peers) {
                if (disconnectedPeers.has(peer)) continue;
                disconnectedPeers.add(peer);
                this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    peer
                );
            }
        }
        if (disconnectedPeers.size > 0) {
            this.logger.warn("Disconnected peers for invalid signatures", {
                blockHash: entry.block.hash,
                disconnectedPeers: Array.from(disconnectedPeers)
            });
        }
    }

    public scheduleStoredBlockConfirmationMerge(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): void {
        this.timeoutManager.scheduleTask(
            () => this.handleStoredBlockConfirmationMerge(entry, strategy),
            0,
            `BlockQueueManager.handleStoredBlockConfirmationMerge - fork ${entry.block.forkId} - block ${entry.block.height}`
        );
    }
    /**
     * The ONLY sanctioned way to put a dequeued entry back. Strategy hooks reach
     * this while `onBlockConfirmation` holds the StateManager mutex, so all work
     * here is either synchronous storage mutation or a scheduled task - never an
     * inline timeout (that would re-enter validation on the wrong stack).
     *
     * - If the block became stored while it was out of the queue, merge the
     *   stored confirmation instead of waiting out the timeout, under the
     *   caller's `strategy` (falling back to the active one).
     * - Otherwise restore + (re)arm the remaining-window timeout; if the window
     *   already elapsed, run the timeout logic as an immediate task.
     */
    public restoreQueuedEntry(
        entry: QueuedBlockEntry,
        strategy?: AValidationStrategy
    ): void {
        if (this.isBlockStored(entry.block)) {
            this.scheduleStoredBlockConfirmationMerge(
                entry,
                strategy ?? this.stateManager.getActiveValidationStrategy()
            );
            return;
        }

        this.stateManager.storage.queues.restoreEntry(entry);
        const hash = entry.block.hash;

        if (this.scheduleQueueTimeout(hash)) return;

        // Deadline already crossed while dequeued: evict via a task, not inline.
        this.timeoutManager.scheduleTask(
            () => this.queueTimeout(hash),
            0,
            `BlockQueueManager.queueTimeout (restore past deadline) - ${hash}`
        );
    }

    /**
     * Consult the kill-period cache BEFORE scheduling (avoid task-queue pressure
     * under a junk flood), then hand off to the coalescing gate. Awaited from
     * ingest, but only cheap mirror/cache reads - never the reduction itself.
     */
    private async maybeScheduleForkRecovery(
        channelId: ChannelId
    ): Promise<void> {
        const currentForkId = this.stateManager.forkId;
        if (
            !(await this.stateManager.validationService.isDisputedFork(
                currentForkId,
                channelId
            ))
        )
            return;
        const { isExpired, killPeriodEnd } =
            await this.stateManager.reductionManager.isKillPeriodExpiredCached(
                currentForkId
            );
        if (!isExpired) {
            this.recoverySuppressedUntil.set(currentForkId, killPeriodEnd);
            return;
        }
        this.scheduleForkRecovery(currentForkId);
    }

    private scheduleForkRecovery(forkId: ForkId): void {
        if (this.recoveryScheduledForFork.has(forkId)) return; // coalesce
        const suppressedUntil = this.recoverySuppressedUntil.get(forkId);
        if (
            suppressedUntil !== undefined &&
            Clock.getTimeInSeconds() < suppressedUntil
        ) {
            return;
        }
        this.recoveryScheduledForFork.add(forkId);
        this.timeoutManager.scheduleTask(
            () => {
                DetachedPromises.collect(this.runForkRecovery(forkId));
            },
            0,
            `BlockQueueManager.runForkRecovery - fork ${forkId}`
        );
    }

    private async runForkRecovery(forkId: ForkId): Promise<void> {
        try {
            // Re-check at RUN time, not just schedule time: a transition may have
            // landed, or the fork may no longer be disputed.
            if (forkId !== this.stateManager.forkId) return;
            if (
                !(await this.stateManager.validationService.isDisputedFork(
                    forkId,
                    this.stateManager.channelId
                ))
            ) {
                return;
            }
            const { isExpired, killPeriodEnd } =
                await this.stateManager.reductionManager.isKillPeriodExpiredCached(
                    forkId
                );
            if (!isExpired) {
                this.recoverySuppressedUntil.set(forkId, killPeriodEnd);
                return;
            }
            // Idempotent single-flight: on success `setGenesisState` transitions
            // the fork and the post-transition drain picks up queued blocks.
            await this.stateManager.reductionManager.tryReduce(forkId);
        } catch (error) {
            this.logger.error("runForkRecovery - local reduction failed", {
                forkId: String(forkId),
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        } finally {
            this.recoveryScheduledForFork.delete(forkId);
        }
    }

    private async queueTimeout(blockHash: Hash): Promise<void> {
        this.timeoutHandles.delete(blockHash);
        // Dequeue first: the timeout owns the entry it sees - no race with
        // other tasks. Copies arriving from here on pool into a fresh entry
        // that converges on its own.
        const entry = this.stateManager.storage.queues.removeBlock(blockHash);
        if (!entry) return;

        if (
            await this.stateManager.validationService.isDisputedFork(
                entry.block.forkId,
                entry.block.channelId
            )
        ) {
            this.clearFork(entry.block.forkId);
            return;
        }

        if (this.isBlockStored(entry.block)) {
            this.scheduleStoredBlockConfirmationMerge(
                entry,
                this.stateManager.getActiveValidationStrategy()
            );
            return;
        }

        if (entry.block.forkId !== this.stateManager.forkId) {
            if (
                await this.stateManager.validationService.isKnownStaleFork(
                    entry.block.forkId
                )
            ) {
                // A known-past fork (disputed, or one we hold a genesis snapshot
                // for): we are ahead, and a sync request would blacklist honest
                // stragglers. Drop silently.
                this.logger.verbose(
                    "queueTimeout - dropping entry from a known stale fork",
                    {
                        expectedForkId: String(this.stateManager.forkId),
                        block: LoggerUtils.getBlockMetadata(
                            entry.block,
                            this.stateManager.storage
                        )
                    }
                );
                return;
            }
            // Unknown fork (not disputed, no local genesis for it): ask the
            // suppliers to prove it once; a failed sync punishes them. This is
            // the sole sync-probe site now that arrival-time sync is gone.
            this.logger.verbose(
                "queueTimeout - unknown fork, requesting sync from suppliers",
                {
                    expectedForkId: String(this.stateManager.forkId),
                    block: LoggerUtils.getBlockMetadata(
                        entry.block,
                        this.stateManager.storage
                    )
                }
            );
            this.requestSync(entry);
            return;
        }

        const nextHeight = this.stateManager.storage.blocks.getNextBlockHeight(
            entry.block.forkId
        );

        if (entry.block.height <= nextHeight) {
            this.scheduleQueuedEntryExecution(entry);
            return;
        }

        // Still in the future after the agreement window: discard (already
        // dequeued) and ask the suppliers to sync us up - junk must not
        // accumulate. A block posted as calldata can always be re-read from
        // the chain if it turns out to be needed.
        this.requestSync(entry);
    }

    private disconnectEntrySources(entry: QueuedBlockEntry): void {
        this.stateManager.p2pManager.disconnectAndBlacklistPeers(
            entry.sourcePeers
        );
    }

    /**
     * (Re)schedule the queue timeout for the REMAINDER of the entry's fixed
     * lifetime (`firstSeenAt + agreementTime`) - duplicate copies and
     * restores must not extend it. Returns whether a timeout was scheduled;
     * on false any pre-existing handle is left untouched, so a near-deadline
     * duplicate can't strand the entry by cancelling its only timeout.
     */
    private scheduleQueueTimeout(blockHash: Hash): boolean {
        const entry =
            this.stateManager.storage.queues.getQueuedEntry(blockHash);
        if (!entry) return false;

        const now = Clock.getTimeInSeconds();
        const remainingSeconds =
            this.timeConfig.agreementTime - (now - entry.firstSeenAt);

        if (remainingSeconds <= 0) return false;

        if (this.timeoutHandles.has(blockHash)) {
            this.cancelQueueTimeout(blockHash);
        }

        const timeout = this.timeoutManager.scheduleTask(
            () => this.queueTimeout(blockHash),
            remainingSeconds * 1000,
            `BlockQueueManager.queueTimeout - fork ${entry.block.forkId} - block ${entry.block.height}`
        );
        this.timeoutHandles.set(blockHash, timeout);
        return true;
    }

    private scheduleQueueExecution(forkId: ForkId): void {
        if (forkId !== this.stateManager.forkId) return;
        this.timeoutManager.scheduleTask(
            () => this.tryExecuteFromQueue(forkId),
            0,
            `BlockQueueManager.tryExecuteFromQueue - fork ${forkId}`
        );
    }

    private scheduleQueuedEntryExecution(entry: QueuedBlockEntry): void {
        this.timeoutManager.scheduleTask(
            () => this.executeQueuedEntry(entry),
            0,
            `BlockQueueManager.executeQueuedEntry - fork ${entry.block.forkId} - block ${entry.block.height}`
        );
    }

    private async handleStoredBlockConfirmationMerge(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<void> {
        const validationResult =
            await this.stateManager.storedBlockMergeService.tryMergeStoredBlockConfirmation(
                entry,
                strategy
            );
        if (validationResult === undefined) return;

        const shouldKeepConnection =
            await strategy.interpretFinalValidationResult(validationResult);

        if (!shouldKeepConnection) {
            this.disconnectEntrySources(entry);
        }
        P2pEventHooksUtils.notifyBlockConfirmationProcessed({
            blockHash: entry.block.hash,
            keepConnection: shouldKeepConnection,
            p2pEventHooks: this.stateManager.p2pEventHooks
        });
    }

    private async executeQueuedEntry(entry: QueuedBlockEntry): Promise<void> {
        if (this.isBlockStored(entry.block)) {
            await this.handleStoredBlockConfirmationMerge(
                entry,
                this.stateManager.getActiveValidationStrategy()
            );
            return;
        }

        // The pipeline handles a fork that moved out from under this entry (as a
        // side effect: it restores the entry for a timeout sync, or drops it if
        // we've moved past it) - see `onBlockConfirmation`. A `false` here is a
        // genuine validation failure on the current fork.
        const shouldKeepConnection =
            await this.stateManager.blockIngestService.onBlockConfirmation(
                entry
            );

        if (!shouldKeepConnection) {
            this.logger.warn(
                "tryExecuteFromQueue - queued block failed canonical validation",
                {
                    block: LoggerUtils.getBlockMetadata(
                        entry.block,
                        this.stateManager.storage
                    ),
                    sourcePeers: Array.from(entry.sourcePeers)
                }
            );
        }
    }

    private cancelQueueTimeout(blockHash: Hash): void {
        const timeout = this.timeoutHandles.get(blockHash);
        if (!timeout) return;

        this.timeoutManager.cancelTask(timeout);
        this.timeoutHandles.delete(blockHash);
    }

    private requestSync(entry: QueuedBlockEntry): void {
        const block = entry.block;

        for (const peer of sourcePeersAndAuthor(entry)) {
            void this.stateManager.p2pManager.localRpc.spectateService.sync(
                peer,
                block.channelId,
                block.forkId,
                block.height
            );
        }
    }

    private isBlockForThisChannel(block: Block): boolean {
        return (
            String(block.channelId).toLowerCase() ===
            String(this.stateManager.channelId).toLowerCase()
        );
    }

    private isBlockStored(block: Block): boolean {
        return (
            this.stateManager.storage.blocks.getBlock(block.hash) !== undefined
        );
    }
}
