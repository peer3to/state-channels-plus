import EventSyncService from "../eventSync/EventSyncService";
import FraudProofService from "../utils/FraudProofService";
import AValidationStrategy from "../validationStrategy/AValidationStrategy";
import ADiamondStateMachine from "@/ADiamondStateMachine";

import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import type StateManager from "@/stateManager";
import Storage from "@/storage";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import {
    BlockValidationResult,
    TimeConfig,
    firstBlockGrace,
    timeoutWaitTime
} from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Timestamp,
    Signature
} from "@/types/types";
import { Codec, hash, Logger, Type } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { ZeroHash } from "ethers";

export enum OnChainPostTiming {
    NOT_POSTED,
    ON_TIME,
    TOO_LATE
}

export default class ValidationService {
    private readonly fraudProofService: FraudProofService;
    private readonly logger: Logger;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerInterface,
        private readonly timeConfig: TimeConfig,
        private readonly eventSyncService: EventSyncService,
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ValidationService" });
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
    }

    public async normalizeConfirmationSignatures(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        const malformed = new Set<Signature>();
        for (const signature of entry.block.confirmationSignatures) {
            try {
                entry.block.signatureToAddress(signature);
            } catch {
                malformed.add(signature);
            }
        }
        return malformed.size
            ? strategy.malformedConfirmationSignatures(entry, malformed)
            : BlockValidationResult.SUCCESS;
    }

    public async validateBlockConfirmation(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        // Check is correct channel
        if (
            !this.stateManager.channelId ||
            block.channelId != this.stateManager.channelId
        ) {
            this.logger.warn("validateBlockConfirmation - wrong channel", {
                strategy: strategy.name,
                stateManagerChannelId: String(this.stateManager.channelId),
                blockChannelId: String(block.channelId),
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return await strategy.wrongChannel(block);
        }

        // Check if channel is open
        if (!this.isChannelOpen(this.stateManager.forkId)) {
            this.logger.warn("validateBlockConfirmation - channel not opened", {
                strategy: strategy.name,
                stateManagerForkId: String(this.stateManager.forkId),
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return await strategy.channelNotOpened(entry);
        }

        // Author is a participant; SUCCESS continues the remaining checks
        if (!(await this.isBlockAuthorParticipant(entry))) {
            this.logger.warn(
                "validateBlockConfirmation - author is not participant",
                {
                    strategy: strategy.name,
                    block: LoggerUtils.getBlockMetadata(block, this.storage)
                }
            );
            const authorResult =
                await strategy.blockAuthorIsNotParticipant(entry);
            if (authorResult !== BlockValidationResult.SUCCESS)
                return authorResult;
        }

        // Check conflicting block
        const conflictResult = await this.checkConflictingBlock(
            entry,
            strategy
        );
        if (conflictResult !== BlockValidationResult.SUCCESS) {
            this.logger.warn("validateBlockConfirmation - conflicting block", {
                strategy: strategy.name,
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return conflictResult;
        }

        if (
            strategy.enforcesLiveForkAndOrderingGates &&
            (await this.isDisputedFork(block.forkId, block.channelId))
        ) {
            this.logger.warn("validateBlockConfirmation - fork disputed", {
                strategy: strategy.name,
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return await strategy.blockForkIsDisputed(entry);
        }

        // isNext
        const expectedNextHeight = this.storage.blocks.getNextBlockHeight(
            block.forkId
        );
        if (
            strategy.enforcesLiveForkAndOrderingGates &&
            block.height > expectedNextHeight
        ) {
            this.logger.warn(
                "validateBlockConfirmation - block is in the future",
                {
                    strategy: strategy.name,
                    expectedNextHeight,
                    block: LoggerUtils.getBlockMetadata(block, this.storage)
                }
            );
            return await strategy.blockIsNotNextAndIsInTheFuture(entry);
        }

        // A free height below the installed history: a compact sync proof
        // skipped it, so the block is inconclusive, not misbehaviour - drop it
        if (
            strategy.enforcesLiveForkAndOrderingGates &&
            block.height < expectedNextHeight &&
            !this.storage.blocks.getBlock(block.forkId, block.height)
        ) {
            this.logger.verbose(
                "validateBlockConfirmation - free height below the installed history",
                {
                    strategy: strategy.name,
                    expectedNextHeight,
                    block: LoggerUtils.getBlockMetadata(block, this.storage)
                }
            );
            return await strategy.blockIsBelowInstalledHistory(entry);
        }

        // Is linked
        if (!this.isLinked(block, this.previousOf(entry))) {
            // if first block -> wrong genesis fraud proof
            if (block.height === 0) {
                this.logger.warn("validateBlockConfirmation - wrong genesis", {
                    strategy: strategy.name,
                    block: LoggerUtils.getBlockMetadata(block, this.storage)
                });
                return await strategy.wrongGenesisDetected(entry);
            }
            this.logger.warn("validateBlockConfirmation - block not linked", {
                strategy: strategy.name,
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return await strategy.blockIsNotLinkedAndIsNotFirstBlock(entry);
        }

        // isNextLeader - the state machine holds the block's predecessor state
        // (dispute replay positions it in BlockIngestService)
        const nextLeader = await this.diamondStateMachine.getNextToWrite();
        if (nextLeader !== block.author) {
            this.logger.warn(
                "validateBlockConfirmation - unexpected next leader",
                {
                    strategy: strategy.name,
                    block: LoggerUtils.getBlockMetadata(block, this.storage),
                    expectedNextLeader: nextLeader,
                    expectedNextHeight,
                    expectedForkId: this.stateManager.forkId
                }
            );
            return await strategy.invalidStateTransitionDetected(block);
        }

        // Time logic
        const timeResult = await this.validateTimeLogic(entry, strategy);

        if (timeResult !== BlockValidationResult.SUCCESS) {
            this.logger.warn("Time validation failed", {
                strategy: strategy.name,
                validationResult: LoggerUtils.enumToString(
                    BlockValidationResult,
                    timeResult
                ),
                blockHeight: block.height
            });
            return timeResult;
        }
        return timeResult;
    }

    // ────────────────────── VALIDATION METHODS ─────────────────────

    public isChannelOpen(forkId: ForkId): boolean {
        return forkId !== ZeroHash;
    }

    public async isDisputedFork(
        forkId: ForkId,
        channelId: ChannelId
    ): Promise<boolean> {
        return (
            this.storage.disputes.didIDispute(forkId) ||
            (await this.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                forkId
            ))
        );
    }

    /**
     * Is `forkId` a fork in our canonical past - one we've moved past and can
     * safely drop a late block on - rather than an unknown/malicious fork we
     * should sync-probe? Callers only ask about a NON-current fork.
     *
     * O(1), no chain walk: a non-current fork is "known past" if it is disputed
     * (we are leaving it) OR we already hold its genesis snapshot or any of its
     * blocks locally (we've seen it in our history). Anything we don't recognize
     * is treated as unknown → sync (never a silent drop on ambiguity).
     */
    public async isKnownStaleFork(forkId: ForkId): Promise<boolean> {
        const sm = this.stateManager;
        if (forkId === sm.forkId || forkId === ZeroHash) return false;
        if (await this.isDisputedFork(forkId, sm.channelId)) return true;
        return (
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId) !==
                undefined ||
            this.storage.blocks.getLatestBlock(forkId) !== undefined
        );
    }

    /**
     * Did the author invent an inbound message block? A carried inbound block
     * is legitimate only if we already store it locally or the chain has it.
     */
    public async detectForgedInboundMessageBlock(
        block: Block
    ): Promise<MessageBlockStruct | undefined> {
        if (block.messageBlocks.length === 0) {
            return undefined;
        }

        for (const inboundBlock of block.messageBlocks) {
            const inboundBlockHash = hash(
                Codec.encode(inboundBlock, Type.MessageBlock)
            );

            const existsLocally =
                this.storage.inboundMessages.getMessageBlock(inboundBlockHash);
            if (existsLocally) {
                continue;
            }

            const existsOnChain =
                await this.stateChannelManagerContract.hasInboundMessageBlock(
                    this.stateManager.channelId,
                    inboundBlockHash
                );

            if (existsOnChain) {
                continue;
            }

            return inboundBlock;
        }

        return undefined;
    }

    public findBrokenInboundMessageChainBlock(
        previousStateSnapshot: StateSnapshot,
        inboundMessageBlocks: MessageBlockStruct[]
    ): MessageBlockStruct | undefined {
        if (inboundMessageBlocks.length === 0) {
            return undefined;
        }

        let expectedPreviousHash =
            previousStateSnapshot.snapshotData.latestInboundMessageBlockHash ??
            ZeroHash;
        let expectedHeight = BigInt(
            previousStateSnapshot.snapshotData
                .latestInboundMessageBlockHeight ?? 0n
        );

        for (const inboundBlock of inboundMessageBlocks) {
            if (inboundBlock.previousBlockHash !== expectedPreviousHash) {
                return inboundBlock;
            }
            expectedHeight += 1n;
            if (BigInt(inboundBlock.blockHeight ?? 0n) !== expectedHeight) {
                return inboundBlock;
            }
            expectedPreviousHash = hash(
                Codec.encode(inboundBlock, Type.MessageBlock)
            );
        }

        return undefined;
    }

    // ────────────────────── Helpers ─────────────────────

    /** What `entry` is judged from: its replay predecessor, else the stored history below it. */
    private previousOf(entry: QueuedBlockEntry): {
        block?: Block;
        snapshot?: StateSnapshot;
    } {
        return (
            entry.predecessor ??
            this.storage.getPreviousBlockAndSnapshot(entry.block.coordinates)
        );
    }

    private async isBlockAuthorParticipant(
        entry: QueuedBlockEntry
    ): Promise<boolean> {
        const { block } = entry;
        const channelId = block.channelId;
        const previousSnapshot = this.previousOf(entry).snapshot;

        if (!previousSnapshot) {
            // No local anchor to bind against - fall back to the on-chain union.
            const [participantsFromChain, pendingParticipants] =
                await Promise.all([
                    this.stateChannelManagerContract.getParticipants(channelId),
                    this.stateChannelManagerContract.getPendingParticipants(
                        channelId
                    )
                ]);
            return new Set<Address>([
                ...participantsFromChain,
                ...pendingParticipants
            ]).has(block.author);
        }

        // The author counts if it is in the previous snapshot, or in the block's
        // declared resulting snapshot bound to the block's coordinates.
        const resultingSnapshot =
            this.storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            );
        // No declared snapshot in storage -> an empty snapshot contributes no
        // participants, so the check degrades to the previous snapshot alone.
        return await this.diamondStateMachine.localDiamondContract.isBlockAuthorParticipant(
            block.blockStruct,
            previousSnapshot.toStruct(),
            (resultingSnapshot ?? StateSnapshot.empty()).toStruct()
        );
    }

    private async getOnChainPostTiming(
        previousTimestamp: Timestamp,
        block: Block
    ): Promise<OnChainPostTiming> {
        const storedOnChainTimestamp = this.getStoredOnChainTimestamp(block);
        if (storedOnChainTimestamp !== undefined) {
            block.onChainTimestamp = storedOnChainTimestamp;
        }

        // if doesn't have on-chain timestamp try and fetch it
        if (block.onChainTimestamp === undefined) {
            await this.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                block.forkId,
                block.height,
                block.author
            );

            const onChainTimestamp = this.getStoredOnChainTimestamp(block);

            if (onChainTimestamp === undefined) {
                return OnChainPostTiming.NOT_POSTED;
            }
            block.onChainTimestamp = onChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                block.hash,
                onChainTimestamp
            );
        }

        // => Block has on-chain timestamp

        const maxAllowedTimestamp =
            previousTimestamp + timeoutWaitTime(this.timeConfig, block.height);

        if (block.onChainTimestamp > maxAllowedTimestamp) {
            return OnChainPostTiming.TOO_LATE;
        }

        return OnChainPostTiming.ON_TIME;
    }

    private getStoredOnChainTimestamp(block: Block): Timestamp | undefined {
        return (
            this.storage.blocks.getBlock(block.hash)?.onChainTimestamp ??
            this.storage.blockCalldata.getMatchingBlockCalldata(block)
                ?.onChainTimestamp ??
            block.onChainTimestamp
        );
    }

    /** `block` extends `previous`: its block, or at height 0 the fork genesis. */
    private isLinked(
        block: Block,
        previous: { block?: Block; snapshot?: StateSnapshot }
    ): boolean {
        if (block.height === 0)
            return previous.snapshot?.hash === block.previousBlockHash;
        return previous.block?.hash === block.previousBlockHash;
    }

    private async checkConflictingBlock(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        const block = entry.block;
        // conflicting block ?
        const maybePreExistingBlock = this.storage.blocks.getBlock(
            block.forkId,
            block.height
        );

        // an identical stored block (dispute replay re-judges it) is no conflict
        if (
            !maybePreExistingBlock ||
            maybePreExistingBlock.hash === block.hash
        ) {
            return BlockValidationResult.SUCCESS;
        }

        // name change for clarity, it isn't a maybe anymore
        const conflictingBlock = maybePreExistingBlock;

        if (conflictingBlock.author === block.author) {
            this.logger.warn("checkConflictingBlock - double sign detected", {
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return await strategy.doubleSignDetected(conflictingBlock, block);
        }

        // If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
        if (
            this.isLinked(
                block,
                this.storage.getPreviousBlockAndSnapshot(block.coordinates)
            )
        ) {
            this.logger.warn(
                "checkConflictingBlock - isLinked but conflict detected",
                {
                    block: LoggerUtils.getBlockMetadata(block, this.storage)
                }
            );
            return await strategy.invalidStateTransitionDetected(block);
        }

        // if first block -> wrong genesis
        if (conflictingBlock.height === 0) {
            this.logger.warn("checkConflictingBlock - wrong genesis detected", {
                block: LoggerUtils.getBlockMetadata(block, this.storage)
            });
            return await strategy.wrongGenesisDetected(entry);
        }

        return await strategy.conflictingButNotLinkedBlockDetected(entry);
    }

    /**
     * Ensure block.timestamp is within the allowed
     * p2pTime window of the previous timestamp, optionally
     * fetching a better on-chain timestamp if needed.
     */
    private async validateTimeLogic(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        const { block } = entry;
        const nowSeconds = Clock.getTimeInSeconds();

        // Calculate previousTimestamp
        let previousTimestamp: Timestamp;
        let previousOriginalTimestamp: Timestamp;
        let previousBlock: Block | undefined;
        let previousStateSnapshot: StateSnapshot | undefined;
        // previous block or snapshot
        const previous = this.previousOf(entry);
        if (previous.block) {
            previousBlock = previous.block;
            previousTimestamp = previousBlock.getRelevantTimestamp(
                block.author
            );
            previousOriginalTimestamp = previousBlock.timestamp;
        } else {
            previousStateSnapshot = previous.snapshot;
            previousTimestamp = previousStateSnapshot!.timestamp;
            previousOriginalTimestamp = previousStateSnapshot!.timestamp;
        }

        // OBJECTIVE: isValidTimestamp check
        const invalidTimestampProof =
            this.fraudProofService.buildInvalidTimestampProof(block, previous);
        const isValidTimestamp =
            !(await this.diamondStateMachine.localDiamondContract.hasInvalidTimestamp.staticCall(
                invalidTimestampProof
            ));

        if (!isValidTimestamp) {
            const graceSeconds = firstBlockGrace(this.timeConfig, block.height);
            const violatedRule =
                block.height === 0
                    ? "timestamp >= previousOriginalTimestamp && timestamp <= previousTimestamp + evidenceTime + p2pTime"
                    : "timestamp >= previousOriginalTimestamp && timestamp <= previousTimestamp + p2pTime";

            // if first block or previous block has on-chain timestamp -> we have all the data (best timestamp) -> safe to create a fraud proof
            if (
                // first block
                previousBlock === undefined ||
                //  previous block has on-chain timestamp
                previousBlock.onChainTimestamp !== undefined
            ) {
                // Already has best timestamp - persist InvalidTimestamp fraud proof
                LoggerUtils.logTimeValidationFailed(this.logger, {
                    block,
                    nowSeconds,
                    validationResult: BlockValidationResult.DISPUTE,
                    checkType: "objective",
                    allowedSkewSeconds: graceSeconds + this.timeConfig.p2pTime,
                    violatedRule,
                    previousTimestamp,
                    previousOriginalTimestamp
                });
                return await strategy.objectiveInvalidTimestampDetected(block);
            }

            // Try on-chain query to schedule validation for the previous block.
            await this.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                previousBlock.forkId,
                previousBlock.height,
                previousBlock.author
            );

            const recoveredPreviousCalldata =
                this.storage.blockCalldata.getMatchingBlockCalldata(
                    previousBlock
                );
            if (recoveredPreviousCalldata) {
                previousBlock.onChainTimestamp =
                    recoveredPreviousCalldata.onChainTimestamp;
                this.storage.blocks.setOnChainTimestamp(
                    previousBlock.hash,
                    recoveredPreviousCalldata.onChainTimestamp
                );
            }

            const previousBlockOnChainTimestamp =
                this.storage.blocks.getBlock(previousBlock.hash)
                    ?.onChainTimestamp ?? previousBlock.onChainTimestamp;

            // if previousBlockOnChainTimestamp not set/updated or less than previousTimestamp -> we have the best timestamp already -> safe to create a fraud proof
            if (
                !previousBlockOnChainTimestamp ||
                previousBlockOnChainTimestamp <= previousTimestamp
            ) {
                // False - persist InvalidTimestamp fraud proof
                // Re-check which rule was violated (previousTimestamp may have changed, but we already computed violatedRule above)
                LoggerUtils.logTimeValidationFailed(this.logger, {
                    block,
                    nowSeconds,
                    validationResult: BlockValidationResult.DISPUTE,
                    checkType: "objective",
                    allowedSkewSeconds: graceSeconds + this.timeConfig.p2pTime,
                    violatedRule,
                    previousTimestamp,
                    previousOriginalTimestamp
                });
                return await strategy.objectiveInvalidTimestampDetected(block);
            }

            // True - Update the previous block with the on-chain timestamp
            previousBlock.onChainTimestamp = previousBlockOnChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                previousBlock.hash,
                previousBlockOnChainTimestamp
            );

            // previousBlockOnChainTimestamp set - rerun validation - this time we have all the data to deduct the result
            return this.validateTimeLogic(entry, strategy);
        }

        // OBJECTIVE: Check if block was posted too late on-chain
        const onChainPostTiming = await this.getOnChainPostTiming(
            previousTimestamp,
            block
        );
        if (onChainPostTiming === OnChainPostTiming.TOO_LATE) {
            // Block posted too late - create InvalidTimestamp fraud proof
            LoggerUtils.logTimeValidationFailed(this.logger, {
                block,
                nowSeconds,
                validationResult: BlockValidationResult.DISPUTE,
                checkType: "objective",
                allowedSkewSeconds: timeoutWaitTime(
                    this.timeConfig,
                    block.height
                ),
                violatedRule:
                    block.height === 0
                        ? "onChainTimestamp <= previousTimestamp + evidenceTime + p2pTime + agreementTime + chainFallbackTime"
                        : "onChainTimestamp <= previousTimestamp + p2pTime + agreementTime + chainFallbackTime",
                previousTimestamp,
                previousOriginalTimestamp
            });
            return await strategy.objectiveInvalidTimestampDetected(block);
        }

        if (onChainPostTiming === OnChainPostTiming.ON_TIME) {
            LoggerUtils.logSubjectiveTimeValidationSucceeded(this.logger, {
                block,
                strategyName: strategy.name,
                validationPath: "on-chain-post-on-time",
                nowSeconds,
                agreementTimeSeconds: this.timeConfig.agreementTime
            });
            return BlockValidationResult.SUCCESS;
        }

        // SUBJECTIVE: hasOnChainTimestamp check. A block replayed from a
        // verified synchronization proof is proven history, not a live
        // arrival: the agreement-window judgment does not apply to it, or a
        // suffix older than one window could never be applied.
        const receivedWithinAgreementTime =
            Math.abs(nowSeconds - block.timestamp) <=
            this.timeConfig.agreementTime;

        if (!receivedWithinAgreementTime) {
            return await strategy.subjectiveInvalidTimestampDetected(block);
        }

        LoggerUtils.logSubjectiveTimeValidationSucceeded(this.logger, {
            block,
            strategyName: strategy.name,
            validationPath: "subjective-window",
            nowSeconds,
            agreementTimeSeconds: this.timeConfig.agreementTime
        });

        return BlockValidationResult.SUCCESS;
    }
}
