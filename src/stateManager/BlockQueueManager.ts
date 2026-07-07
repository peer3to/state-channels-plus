import { Block } from "@/models";
import { BlockValidationResult, TimeConfig } from "@/types";
import { Address, ForkId, Hash, Signature, Timestamp } from "@/types/types";
import { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";
import { TimeoutManager } from "@/utils/TimeoutManager";
import Clock from "@/Clock";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import type StateManager from "./StateManager";
import type AValidationStrategy from "./validationStrategy/AValidationStrategy";

export type IngestBlockConfirmationOptions = {
    onChainTimestamp?: Timestamp;
    validationStrategy?: AValidationStrategy;
    senderAddress?: Address;
};

export default class BlockQueueManager {
    private readonly timeoutHandles: Map<Hash, ReturnType<typeof setTimeout>> =
        new Map();
    private readonly logger: Logger;

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
                await this.stateManager.isBlockConfirmationAuthentic(
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
                await this.stateManager.isForkDisputed(
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

    public async tryExecuteFromQueue(forkId?: ForkId): Promise<void> {
        const activeForkId = forkId ?? this.stateManager.forkId;
        const maxHeight =
            this.stateManager.storage.blocks.getNextBlockHeight(activeForkId);

        const entries = this.stateManager.storage.queues.tryDequeuePriority(
            activeForkId,
            maxHeight
        );

        if (entries.length === 0) return;

        if (
            await this.stateManager.isForkDisputed(
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

    private async queueTimeout(blockHash: Hash): Promise<void> {
        this.timeoutHandles.delete(blockHash);
        // Dequeue first: the timeout owns the entry it sees - no race with
        // other tasks. Copies arriving from here on pool into a fresh entry
        // that converges on its own.
        const entry = this.stateManager.storage.queues.removeBlock(blockHash);
        if (!entry) return;

        if (
            await this.stateManager.isForkDisputed(
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

    private scheduleQueueTimeout(blockHash: Hash): void {
        const entry =
            this.stateManager.storage.queues.getQueuedEntry(blockHash);
        if (!entry) return;

        const now = Clock.getTimeInSeconds();
        const alreadyScheduled = this.timeoutHandles.has(blockHash);
        const canReschedule =
            now - entry.firstSeenAt <= this.timeConfig.agreementTime;

        if (!canReschedule) return;

        if (alreadyScheduled) this.cancelQueueTimeout(blockHash);

        const delayMs = this.timeConfig.agreementTime * 1000;
        const timeout = this.timeoutManager.scheduleTask(
            () => this.queueTimeout(blockHash),
            delayMs,
            `BlockQueueManager.queueTimeout - fork ${entry.block.forkId} - block ${entry.block.height}`
        );
        this.timeoutHandles.set(blockHash, timeout);
    }

    private scheduleQueueExecution(forkId: ForkId): void {
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
            await this.stateManager.tryMergeStoredBlockConfirmation(
                entry,
                strategy
            );
        if (validationResult === undefined) return;

        const shouldKeepConnection =
            await strategy.interpretFinalValidationResult(validationResult);

        if (!shouldKeepConnection) {
            for (const peer of entry.sourcePeers) {
                this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    peer
                );
            }
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

        const shouldKeepConnection =
            await this.stateManager.onBlockConfirmation(entry);

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

        const peers = new Set<Address>();
        for (const sourcePeer of entry.sourcePeers) peers.add(sourcePeer);
        peers.add(block.author);

        for (const peer of peers) {
            this.stateManager.p2pManager.localRpc.spectateService.sync(
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
