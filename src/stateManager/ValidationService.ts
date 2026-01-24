import { StateChannelManagerProxy } from "@typechain-types";
import { ZeroHash } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset, Logger } from "@/utils";
import { BlockValidationResult, TimeConfig } from "@/types";
import { Address, ChannelId, ForkId, Timestamp } from "@/types/types";

import FraudProofService from "./utils/FraudProofService";
import AValidationStrategy from "./validationStrategy/AValidationStrategy";
import type StateManager from "@/stateManager";

export default class ValidationService {
    private readonly fraudProofService: FraudProofService;
    private readonly logger: Logger;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ValidationService" });
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
    }

    async validateBlockConfirmation(
        block: Block,
        strategy: AValidationStrategy,
        senderAddress?: string
    ): Promise<BlockValidationResult> {
        // Check is correct channel
        if (
            !this.stateManager.channelId ||
            block.channelId != this.stateManager.channelId
        ) {
            this.logger.warn("validateBlockConfirmation - wrong channel", {
                blockHash: block.hash,
                stateManagerChannelId: String(this.stateManager.channelId)
            });
            return await strategy.wrongChannel(block);
        }

        // Check if channel is open
        if (!this.isChannelOpen(this.stateManager.forkId)) {
            this.logger.warn("validateBlockConfirmation - channel not opened", {
                stateManagerForkId: String(this.stateManager.forkId)
            });
            return await strategy.channelNotOpened(block);
        }

        //  Get participants
        const participants = await this.getParticipants(
            block.coordinates,
            block.channelId
        );

        // Check duplicate blocks
        const duplicateResult = await this.checkDuplicateBlock(
            block,
            participants,
            strategy
        );

        if (duplicateResult !== BlockValidationResult.SUCCESS) {
            // this.logger.warn("validateBlockConfirmation - duplicate block", {
            //     block
            // });
            return duplicateResult;
        }

        // Author is a participant
        if (!participants.has(block.author)) {
            this.logger.warn(
                "validateBlockConfirmation - author is not participant",
                {
                    block
                }
            );
            return await strategy.blockAuthorIsNotParticipant(block);
        }

        // Check conflicting block
        const conflictResult = await this.checkConflictingBlock(
            block,
            strategy
        );
        if (conflictResult !== BlockValidationResult.SUCCESS) {
            this.logger.warn("validateBlockConfirmation - conflicting block", {
                block
            });
            return conflictResult;
        }

        if (await this.isDisputedFork(block.forkId, block.channelId)) {
            this.logger.warn("validateBlockConfirmation - fork disputed", {
                block
            });
            return await strategy.blockForkIsDisputed(block, senderAddress);
        }

        // isNext
        if (
            block.height > this.storage.blocks.getNextBlockHeight(block.forkId)
        ) {
            this.logger.warn(
                "validateBlockConfirmation - block is in the future",
                {
                    block
                }
            );
            return await strategy.blockIsNotNextAndIsInTheFuture(
                block,
                senderAddress
            );
        }

        // Is linked
        if (!this.isLinked(block)) {
            // if first block -> wrong genesis fraud proof
            if (block.height === 0) {
                this.logger.warn("validateBlockConfirmation - wrong genesis", {
                    block
                });
                return await strategy.wrongGenesisDetected(block);
            }
            this.logger.warn("validateBlockConfirmation - block not linked", {
                block
            });
            return await strategy.blockIsNotLinkedAndIsNotFirstBlock(block);
        }

        // isNextLeader
        const nextLeader = await this.diamondStateMachine.getNextToWrite();
        if (nextLeader !== block.author) {
            this.logger.warn(
                "validateBlockConfirmation - unexpected next leader",
                {
                    block
                }
            );
            return await strategy.invalidStateTransitionDetected(block);
        }

        // Time logic
        const timeResult = await this.validateTimeLogic(block, strategy);

        if (timeResult !== BlockValidationResult.SUCCESS) {
            this.logger.warn("Time validation failed", {
                validationResult:
                    BlockValidationResult[timeResult] ??
                    `UNKNOWN(${timeResult})`,
                blockHeight: block.height
            });
            this.logger.debug("Time validation details", {
                block,
                validationResult:
                    BlockValidationResult[timeResult] ??
                    `UNKNOWN(${timeResult})`,
                isFraud: timeResult === BlockValidationResult.DISPUTE
            });
            return timeResult;
        }
        return timeResult;
    }

    // ────────────────────── INTERNAL ACTION METHODS ─────────────────────

    // ────────────────────── VALIDATION METHODS ─────────────────────

    isChannelOpen(forkId: ForkId): boolean {
        return forkId !== ZeroHash;
    }

    private isLinked(block: Block): boolean {
        const { forkId, height } = block.coordinates;
        if (height === 0) {
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);

            return genesisSnapshot?.hash === block.previousBlockHash;
        }

        const prevBlock = this.storage.blocks.getBlock(forkId, height - 1);
        if (!prevBlock) {
            return false;
        }
        return prevBlock.hash === block.previousBlockHash;
    }

    private async checkDuplicateBlock(
        block: Block,
        participants: Set<Address>,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        // 1. Check if block is in queue
        if (
            this.storage.queues.isBlockQueued(block, {
                hash: block.hash
            })
        ) {
            const signerAddresses = block.confirmationSignerAddresses;
            const areAllParticipants = isSubset(signerAddresses, participants);

            if (!areAllParticipants) {
                this.logger.warn(
                    "BlockConfirmation - checkDuplicateBlock - not all signers are participants"
                );
                return await strategy.notAllSingersAreParticipants(block);
            }

            // Store in queue (handles signature merging automatically)
            this.storage.queues.queueBlock(block);
            return BlockValidationResult.SUCCESS;
        }

        // 2. Check if block is in block storage
        const existingBlock = this.storage.blocks.getBlock(block.hash);
        if (existingBlock !== undefined) {
            const existingSignatures = existingBlock.confirmationSignatures;
            const incomingSignatures = block.confirmationSignatures;
            const newSignatures = difference(
                incomingSignatures,
                existingSignatures
            );

            if (block.onChainTimestamp) {
                // Update the existing block's onChainTimestamp
                this.storage.blocks.setOnChainTimestamp(
                    block.hash,
                    block.onChainTimestamp
                );
            }

            // no new signatures
            if (newSignatures.size === 0) {
                return await strategy.noNewSignaturesOnExistingBlock(block);
            }

            // Validate new signatures are from participants
            const newSignerAddresses: Set<Address> = new Set(
                Array.from(newSignatures).map((sig) =>
                    block.signatureToAddress(sig)
                )
            );

            const areNewSignersParticipants = isSubset(
                newSignerAddresses,
                participants
            );

            if (!areNewSignersParticipants) {
                this.logger.warn(
                    "BlockConfirmation - checkDuplicateBlock - not all new signers are participants"
                );
                return await strategy.notAllSingersAreParticipants(block);
            }

            return await strategy.goodNewSignaturesOnExistingBlock(block);
        }

        return BlockValidationResult.SUCCESS;
    }

    private async checkConflictingBlock(
        block: Block,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        // conflicting block ?
        const maybePreExistingBlock = this.storage.blocks.getBlock(
            block.forkId,
            block.height
        );

        if (!maybePreExistingBlock) {
            return BlockValidationResult.SUCCESS;
        }

        // name change for clarity, it isn't a maybe anymore
        const conflictingBlock = maybePreExistingBlock;

        if (conflictingBlock.author === block.author) {
            this.logger.warn("checkConflictingBlock - double sign detected", {
                block
            });
            return await strategy.doubleSignDetected(conflictingBlock, block);
        }

        // If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
        if (this.isLinked(block)) {
            this.logger.warn(
                "checkConflictingBlock - isLinked but conflict detected",
                {
                    block
                }
            );
            return await strategy.invalidStateTransitionDetected(block);
        }

        // if first block -> wrong genesis
        if (conflictingBlock.height === 0) {
            this.logger.warn("checkConflictingBlock - wrong genesis detected", {
                block
            });
            return await strategy.wrongGenesisDetected(block);
        }

        return await strategy.conflictingButNotLinkedBlockDetected(block);
    }

    private async isDisputedFork(
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
     * Ensure block.timestamp is within the allowed
     * p2pTime window of the previous timestamp, optionally
     * fetching a better on-chain timestamp if needed.
     */
    private async validateTimeLogic(
        block: Block,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        const nowSeconds = Clock.getTimeInSeconds();

        const logTimeFailure = (args: {
            validationResult: BlockValidationResult;
            checkType: "objective" | "subjective";
            allowedSkewSeconds: number;
            violatedRule: string;
            previousTimestamp?: Timestamp;
            previousOriginalTimestamp?: Timestamp;
        }) => {
            const blockTimestamp = block.timestamp;
            const differenceSeconds = Math.abs(nowSeconds - blockTimestamp);
            const excessSeconds = Math.max(
                0,
                differenceSeconds - args.allowedSkewSeconds
            );
            const validationResultString =
                BlockValidationResult[args.validationResult] ??
                `UNKNOWN(${args.validationResult})`;
            const logData: Record<string, any> = {
                checkType: args.checkType,
                violatedRule: args.violatedRule,
                validationResult: validationResultString,
                blockHeight: block.height,
                nowSeconds,
                blockTimestamp,
                differenceSeconds,
                allowedSkewSeconds: args.allowedSkewSeconds,
                excessSeconds
            };
            // Add previous timestamp context for objective checks
            if (
                args.checkType === "objective" &&
                args.previousTimestamp !== undefined
            ) {
                logData.previousTimestamp = args.previousTimestamp;
                if (args.previousOriginalTimestamp !== undefined) {
                    logData.previousOriginalTimestamp =
                        args.previousOriginalTimestamp;
                }
            }
            this.logger.warn(
                "Time validation failed – block timestamp outside allowed window",
                logData
            );
        };

        // Calculate previousTimestamp
        let previousTimestamp: Timestamp;
        let previousOriginalTimestamp: Timestamp;
        let previousBlock: Block | undefined;
        let previousStateSnapshot: StateSnapshot | undefined;
        // previous block or snapshot
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            block.coordinates
        );
        if (previousBlockOrSnapshot.block) {
            previousBlock = previousBlockOrSnapshot.block;
            previousTimestamp = previousBlock.getRelevantTimestamp(
                block.author
            );
            previousOriginalTimestamp = previousBlock.timestamp;
        } else {
            previousStateSnapshot = previousBlockOrSnapshot.stateSnapshot;
            previousTimestamp = previousStateSnapshot!.timestamp;
            previousOriginalTimestamp = previousStateSnapshot!.timestamp;
        }

        // OBJECTIVE: isValidTimestamp check

        // Check if block timestamp is not in the past
        const isNotInPast = block.timestamp - previousOriginalTimestamp >= 0;

        // Check if block timestamp is within P2P time window
        const isWithinP2PTimeWindow =
            block.timestamp - previousTimestamp <= this.timeConfig.p2pTime;

        const isValidTimestamp = isNotInPast && isWithinP2PTimeWindow;

        if (!isValidTimestamp) {
            // Determine which rule was violated
            let violatedRule: string;
            if (!isNotInPast) {
                violatedRule = "timestamp >= previousOriginalTimestamp";
            } else if (!isWithinP2PTimeWindow) {
                violatedRule = "timestamp <= previousTimestamp + p2pTime";
            } else {
                violatedRule =
                    "timestamp >= previousOriginalTimestamp && timestamp <= previousTimestamp + p2pTime";
            }

            // if first block or previous block has on-chain timestamp -> we have all the data (best timestamp) -> safe to create a fraud proof
            if (
                // first block
                previousBlock === undefined ||
                //  previous block has on-chain timestamp
                previousBlock.onChainTimestamp !== undefined
            ) {
                // Already has best timestamp - persist InvalidTimestamp fraud proof
                logTimeFailure({
                    validationResult: BlockValidationResult.DISPUTE,
                    checkType: "objective",
                    allowedSkewSeconds: this.timeConfig.p2pTime,
                    violatedRule,
                    previousTimestamp,
                    previousOriginalTimestamp
                });
                return await strategy.objectiveInvalidTimestampDetected(block);
            }

            // Try on-chain query to update previous block on-chain timestamp
            const previousBlockOnChainTimestamp = (
                await this.stateManager.fetchUpdatedOnChainBlock(
                    previousBlock.forkId,
                    previousBlock.height,
                    previousBlock.author
                )
            )?.onChainTimestamp;

            // if previousBlockOnChainTimestamp not set/updated or less than previousTimestamp -> we have the best timestamp already -> safe to create a fraud proof
            if (
                !previousBlockOnChainTimestamp ||
                previousBlockOnChainTimestamp <= previousTimestamp
            ) {
                // False - persist InvalidTimestamp fraud proof
                // Re-check which rule was violated (previousTimestamp may have changed, but we already computed violatedRule above)
                logTimeFailure({
                    validationResult: BlockValidationResult.DISPUTE,
                    checkType: "objective",
                    allowedSkewSeconds: this.timeConfig.p2pTime,
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
            return this.validateTimeLogic(block, strategy);
        }

        // OBJECTIVE: Check if block was posted too late on-chain
        if (await this.isPostedOnChainTooLate(previousTimestamp, block)) {
            // Block posted too late - create InvalidTimestamp fraud proof
            logTimeFailure({
                validationResult: BlockValidationResult.DISPUTE,
                checkType: "objective",
                allowedSkewSeconds: this.timeConfig.p2pTime,
                violatedRule:
                    "onChainTimestamp <= previousTimestamp + p2pTime + agreementTime + chainFallbackTime",
                previousTimestamp,
                previousOriginalTimestamp
            });
            return await strategy.objectiveInvalidTimestampDetected(block);
        }

        if (block.onChainTimestamp !== undefined)
            return BlockValidationResult.SUCCESS;

        // SUBJECTIVE: hasOnChainTimestamp check
        const receivedWithinAgreementTime =
            Math.abs(nowSeconds - block.timestamp) <=
            this.timeConfig.agreementTime;

        if (!receivedWithinAgreementTime) {
            logTimeFailure({
                validationResult: BlockValidationResult.NOT_ENOUGH_TIME,
                checkType: "subjective",
                allowedSkewSeconds: this.timeConfig.agreementTime,
                violatedRule: "abs(now - blockTimestamp) <= agreementTime"
            });
            return await strategy.subjectiveInvalidTimestampDetected(block);
        }

        return BlockValidationResult.SUCCESS;
    }

    // ────────────────────── Helpers ─────────────────────

    private async getParticipants(
        blockCoordinates: BlockCoordinates,
        channelId: ChannelId
    ): Promise<Set<Address>> {
        let participants = new Set(
            this.storage.getParticipants(blockCoordinates)
        );

        if (participants.size === 0) {
            // get participants from chain
            const [participantsFromChain, pendingParticipants] =
                await Promise.all([
                    this.stateChannelManagerContract.getParticipants(channelId),
                    this.stateChannelManagerContract.getPendingParticipants(
                        channelId
                    )
                ]);
            participants = new Set([
                ...participantsFromChain,
                ...pendingParticipants
            ]);
        }

        return participants;
    }

    private async isPostedOnChainTooLate(
        previousTimestamp: Timestamp,
        block: Block
    ): Promise<boolean> {
        // if doesn't have on-chain timestamp try and fetch it
        if (!block.onChainTimestamp) {
            const onChainTimestamp = (
                await this.stateManager.fetchUpdatedOnChainBlock(
                    block.forkId,
                    block.height,
                    block.author
                )
            )?.onChainTimestamp;
            // if still doesn't have on-chain timestamp return false - not posted at all
            if (!onChainTimestamp) return false;
            block.onChainTimestamp = onChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                block.hash,
                onChainTimestamp
            );
        }

        // => Block has on-chain timestamp

        const maxAllowedTimestamp =
            previousTimestamp +
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime;

        return block.onChainTimestamp > maxAllowedTimestamp;
    }
}
