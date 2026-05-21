import { Block } from "@/models";
import { BlockValidationResult, TimeConfig } from "@/types";
import { Address, ForkId, Hash, Signature, Timestamp } from "@/types/types";
import { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
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

type QueueBlockForLaterOptions = {
    senderAddress?: Address;
};

export default class BlockQueueManager {
    private readonly timeoutHandles: Map<Hash, ReturnType<typeof setTimeout>> =
        new Map();
    private readonly processingEntries: Map<Hash, QueuedBlockEntry> = new Map();
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
                    validationResult: BlockValidationResult[validationResult],
                    block: LoggerUtils.getBlockConfirmationStructMetadata(
                        blockConfirmation
                    )
                }
            );
            return strategy.interpretFinalValidationResult(validationResult);
        }

        const block = Block.fromBlockConfirmation(
            blockConfirmation,
            options?.onChainTimestamp
        );

        if (this.isBlockStored(block)) {
            this.scheduleStoredBlockConfirmationMerge(
                block,
                strategy,
                options?.senderAddress ? [options.senderAddress] : []
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

        this.queueBlock(block, {
            senderAddress: options?.senderAddress
        });

        return true;
    }

    private queueBlock(
        block: Block,
        options?: QueueBlockForLaterOptions
    ): Hash {
        const hash = this.stateManager.storage.queues.queueBlock(
            block,
            options
        );
        this.scheduleQueueTimeout(hash);
        this.scheduleQueueExecution(block.forkId);
        return hash;
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
        const entry =
            this.stateManager.storage.queues.getQueuedEntry(blockHash);
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
            const strategy = this.stateManager.getActiveValidationStrategy();
            this.scheduleStoredBlockConfirmationMerge(
                entry.block,
                strategy,
                Array.from(entry.sourcePeers)
            );
            this.stateManager.storage.queues.removeBlock(blockHash);
            this.cancelQueueTimeout(blockHash);
            return;
        }

        const nextHeight = this.stateManager.storage.blocks.getNextBlockHeight(
            entry.block.forkId
        );

        if (entry.block.height > nextHeight) {
            this.requestSyncIfFuture(entry);
            return;
        }

        this.scheduleQueueExecution(entry.block.forkId);
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
        blockHash: Hash,
        signatures: Set<Signature>
    ): void {
        const disconnectedPeers = new Set<Address>();
        const processingEntry = this.processingEntries.get(blockHash);
        for (const signature of signatures) {
            const peers =
                processingEntry?.signatureSources.get(signature) ??
                this.stateManager.storage.queues.getSignatureSources(
                    blockHash,
                    signature
                );
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
                blockHash,
                disconnectedPeers: Array.from(disconnectedPeers)
            });
        }
    }

    public scheduleStoredBlockConfirmationMerge(
        block: Block,
        strategy: AValidationStrategy,
        sourcePeers: Address[] = []
    ): void {
        this.timeoutManager.scheduleTask(
            () =>
                this.handleStoredBlockConfirmationMerge(
                    block,
                    strategy,
                    sourcePeers
                ),
            0,
            `BlockQueueManager.handleStoredBlockConfirmationMerge - fork ${block.forkId} - block ${block.height}`
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
        block: Block,
        strategy: AValidationStrategy,
        sourcePeers: Address[]
    ): Promise<void> {
        const validationResult =
            await this.stateManager.tryMergeStoredBlockConfirmation(
                block,
                strategy,
                sourcePeers[0]
            );
        if (validationResult === undefined) return;

        const shouldKeepConnection =
            await strategy.interpretFinalValidationResult(validationResult);
        const shouldDisconnect = !shouldKeepConnection;

        if (shouldDisconnect) {
            for (const peer of sourcePeers) {
                this.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    peer
                );
            }
        }
        this.stateManager.notifyBlockConfirmationProcessed(
            block.hash,
            shouldKeepConnection
        );
    }

    private async executeQueuedEntry(entry: QueuedBlockEntry): Promise<void> {
        if (this.isBlockStored(entry.block)) {
            await this.handleStoredBlockConfirmationMerge(
                entry.block,
                this.stateManager.getActiveValidationStrategy(),
                Array.from(entry.sourcePeers)
            );
            return;
        }

        this.processingEntries.set(entry.block.hash, entry);
        try {
            const shouldKeepConnection =
                await this.stateManager.onBlockConfirmation(
                    entry.block.blockConfirmationStruct,
                    {
                        onChainTimestamp: entry.block.onChainTimestamp
                    }
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
        } finally {
            this.processingEntries.delete(entry.block.hash);
        }
    }

    private cancelQueueTimeout(blockHash: Hash): void {
        const timeout = this.timeoutHandles.get(blockHash);
        if (!timeout) return;

        this.timeoutManager.cancelTask(timeout);
        this.timeoutHandles.delete(blockHash);
    }

    private requestSyncIfFuture(entry: QueuedBlockEntry): void {
        const block = entry.block;
        const nextHeight = this.stateManager.storage.blocks.getNextBlockHeight(
            block.forkId
        );
        if (block.height <= nextHeight) return;

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
