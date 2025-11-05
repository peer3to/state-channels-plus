import { StateChannelManagerProxy } from "@typechain-types";
import { ZeroHash } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset } from "@/utils";
import { BlockValidationResult, TimeConfig } from "@/types";
import { Address, ChannelId, ForkId, Timestamp } from "@/types/types";

import FraudProofService from "./utils/FraudProofService";
import AValidationStrategy from "./validationStrategy/AValidationStrategy";
import StateManager from "@/stateManager";

export default class ValidationService {
    private readonly fraudProofService: FraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly stateManager: StateManager
    ) {
        this.fraudProofService = new FraudProofService(this.storage);
    }

    async validateBlockConfirmation(
        block: Block,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult> {
        const forkId = block.forkId;
        const channelId = block.channelId;

        // Check is correct channel
        if (
            !this.stateManager.channelId ||
            block.channelId != this.stateManager.channelId
        )
            return await strategy.wrongChannel(block);

        // Check if channel is open
        if (!this.isChannelOpen(this.stateManager.forkId)) {
            return await strategy.channelNotOpened(block);
        }

        //  Get participants
        const participants = await this.getParticipants(
            block.coordinates,
            channelId
        );

        // Check duplicate blocks
        const duplicateResult = await this.checkDuplicateBlock(
            block,
            participants,
            strategy
        );

        if (duplicateResult !== BlockValidationResult.SUCCESS) {
            return duplicateResult;
        }

        // Author is a participant
        if (!participants.has(block.author)) {
            return await strategy.blockAuthorIsNotParticipant(block);
        }

        // Check conflicting block
        const conflictResult = await this.checkConflictingBlock(
            block,
            strategy
        );
        if (conflictResult !== BlockValidationResult.SUCCESS) {
            return conflictResult;
        }

        if (await this.isDisputedFork(block.forkId, channelId)) {
            return await strategy.blockForkIsDisputed(block);
        }

        // isNext
        if (block.height > this.storage.blocks.getNextBlockHeight(forkId)) {
            return await strategy.blockIsNotNextAndIsInTheFuture(block);
        }

        // Is linked
        if (!this.isLinked(block)) {
            // if first block -> wrong genesis fraud proof
            if (block.height === 0) {
                return await strategy.wrongGenesisDetected(block);
            }
            return await strategy.blockIsNotLinkedAndIsNotFirstBlock(block);
        }

        // isNextLeader
        const nextLeader = await this.diamondStateMachine.getNextToWrite();
        if (nextLeader !== block.author) {
            return await strategy.invalidStateTransitionDetected(block);
        }

        // Time logic
        const timeResult = await this.validateTimeLogic(block, strategy);

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
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    forkId
                );

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

            if (block.onChainTimestamp && !existingBlock.onChainTimestamp) {
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
            return await strategy.doubleSignDetected(conflictingBlock, block);
        }

        // If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
        if (this.isLinked(block)) {
            return await strategy.invalidStateTransitionDetected(block);
        }

        // if first block -> wrong genesis
        if (conflictingBlock.height === 0) {
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
        const isTimestampInTheFuture =
            block.timestamp - previousOriginalTimestamp >= 0;

        // Check if block timestamp is within P2P time window
        const isWithinP2PTimeWindow =
            block.timestamp - previousTimestamp <= this.timeConfig.p2pTime;

        const isValidTimestamp =
            isTimestampInTheFuture && isWithinP2PTimeWindow;

        if (!isValidTimestamp) {
            // if first block or previous block has on-chain timestamp -> we have all the data (best timestamp) -> safe to create a fraud proof
            if (
                // first block
                previousBlock === undefined ||
                //  previous block has on-chain timestamp
                previousBlock.onChainTimestamp !== undefined
            ) {
                // Already has best timestamp - persist InvalidTimestamp fraud proof
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
            return await strategy.objectiveInvalidTimestampDetected(block);
        }

        if (block.onChainTimestamp !== undefined)
            return BlockValidationResult.SUCCESS;

        // SUBJECTIVE: hasOnChainTimestamp check
        const receivedWithinAgreementTime =
            Math.abs(Clock.getTimeInSeconds() - block.timestamp) <=
            this.timeConfig.agreementTime;

        if (!receivedWithinAgreementTime) {
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
