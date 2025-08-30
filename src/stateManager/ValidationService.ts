import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import { ZeroHash } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset, hash } from "@/utils";
import { BlockValidationResult, TimeConfig } from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Timestamp,
    BlockOrSnapshot
} from "@/types/types";

import FraudProofService from "./utils/FraudProofService";

export default class ValidationService {
    private readonly fraudProofService: FraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly channelId: ChannelId,
        private readonly getForkId: () => ForkId,
        private readonly localDiamondContract: LocalDiamond
    ) {
        this.fraudProofService = new FraudProofService(this.storage);
    }

    async validateBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        const forkId = this.getForkId();
        const channelId = this.channelId;

        // 1. Check if channel is open
        if (!this.isChannelOpen(forkId)) {
            // not ready
            this.queueForLater(blockConfirmation);
            return BlockValidationResult.DISCONNECT;
        }
        // 2. Authenticate the block
        const block = this.authenticateBlock(blockConfirmation, channelId);
        if (!block) {
            return BlockValidationResult.DISCONNECT;
        }

        //  get participants
        const participants = await this.getParticipants(
            block.coordinates,
            channelId
        );

        // 3. check duplicate blocks
        const duplicateResult = this.checkDuplicateBlock(block, participants);

        if (duplicateResult !== BlockValidationResult.SUCCESS) {
            return duplicateResult;
        }

        // 4. author is a participant
        if (!participants.has(block.author)) {
            return BlockValidationResult.DISCONNECT;
        }

        // 5. check conflicting block
        const conflictResult = this.checkConflictingBlock(block);
        if (conflictResult !== BlockValidationResult.SUCCESS) {
            return conflictResult;
        }

        if (await this.isDisputedFork(block.forkId, channelId)) {
            // not ready
            this.queueForLater(block);
            return BlockValidationResult.NOT_READY;
        }

        // isNext
        if (block.height > this.storage.blocks.getNextBlockHeight(forkId)) {
            // not ready
            this.queueForLater(block);
            return BlockValidationResult.NOT_READY;
        }

        // Is linked
        if (!this.isLinked(block)) {
            // if first block -> wrong genesis fraud proof
            if (block.height === 0) {
                //TODO
                throw new Error("Not implemented");
                return BlockValidationResult.DISPUTE;
            }
            return BlockValidationResult.DISCONNECT;
        }

        // isNextLeader
        const nextLeader = await this.diamondStateMachine.getNextToWrite();
        if (nextLeader !== block.author) {
            // create invalid state transition proof
            this.fraudProofService.createInvalidStateTransitionProof(block);
            return BlockValidationResult.DISPUTE;
        }

        // Time logic
        const timeResult = await this.validateTimeLogic(block);

        return timeResult;
    }

    // ────────────────────── INTERNAL ACTION METHODS ─────────────────────

    private queueForLater(
        blockConfirmation: Block | BlockConfirmationStruct
    ): void {
        const block =
            blockConfirmation instanceof Block
                ? blockConfirmation
                : Block.fromBlockConfirmation(blockConfirmation);
        this.storage.queues.queueBlock(block);
    }

    // ────────────────────── VALIDATION METHODS ─────────────────────

    isChannelOpen(forkId: ForkId): boolean {
        return forkId !== ZeroHash;
    }

    private isLinked(block: Block): boolean {
        const { forkId, height } = block.coordinates;
        if (height === 0) return true;

        const prevBlockEntry = this.storage.blocks.getBlockEntry(
            forkId,
            height - 1
        );
        if (!prevBlockEntry) {
            return false;
        }
        return prevBlockEntry.block.hash === block.previousBlockHash;
    }

    private authenticateBlock(
        blockConfirmation: BlockConfirmationStruct,
        channelId: ChannelId
    ): Block | undefined {
        let block: Block;

        try {
            block = Block.fromBlockConfirmation(blockConfirmation);
            if (block.channelId !== channelId) return;
            if (block.signerAddress !== block.author) return;
        } catch (error) {
            return;
        }

        return block;
    }

    private checkDuplicateBlock(
        block: Block,
        participants: Set<Address>
    ): BlockValidationResult {
        // 1. Check if block is in queue
        if (
            this.storage.queues.isBlockQueued(block, {
                hash: block.hash
            })
        ) {
            const signerAddresses = block.confirmationSignerAddresses;
            const areAllParticipants = isSubset(signerAddresses, participants);

            if (!areAllParticipants) {
                return BlockValidationResult.DISCONNECT;
            }

            // Store in queue (handles signature merging automatically)
            this.queueForLater(block);
            return BlockValidationResult.SUCCESS;
        }

        // 2. Check if block is in block storage
        const existingBlockEntry = this.storage.blocks.getBlockEntry(
            block.hash
        );
        if (existingBlockEntry !== undefined) {
            const existingSignatures =
                existingBlockEntry.block.confirmationSignatures;
            const incomingSignatures = block.confirmationSignatures;
            const newSignatures = difference(
                incomingSignatures,
                existingSignatures
            );

            // no new signatures
            if (newSignatures.size === 0) {
                return BlockValidationResult.DUPLICATE;
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
                return BlockValidationResult.DISCONNECT;
            }

            // Store new signatures and indicate broadcast
            this.storage.blocks.storeBlock(block);
            return BlockValidationResult.BROADCAST;
        }

        return BlockValidationResult.SUCCESS;
    }

    private checkConflictingBlock(block: Block): BlockValidationResult {
        // conflicting block ?
        const blockEntry = this.storage.blocks.getBlockEntry(
            block.forkId,
            block.height
        );
        const maybePreExistingBlock = blockEntry?.block;

        if (!maybePreExistingBlock) {
            return BlockValidationResult.SUCCESS;
        }

        // name change for clarity, it isn't a maybe anymore
        const conflictingBlock = maybePreExistingBlock;

        if (conflictingBlock.author === block.author) {
            // DOUBLE SIGN
            this.fraudProofService.createDoubleSignProof(
                conflictingBlock,
                block
            );
            return BlockValidationResult.DISPUTE;
        }

        // If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
        if (this.isLinked(block)) {
            this.fraudProofService.createInvalidStateTransitionProof(block);
            return BlockValidationResult.DISPUTE;
        }

        // if first block -> wrong genesis
        if (conflictingBlock.height === 0) {
            //TODO
            throw new Error("Not implemented");
            return BlockValidationResult.DISPUTE;
        }

        return BlockValidationResult.DISCONNECT;
    }

    private async isDisputedFork(
        forkId: ForkId,
        channelId: ChannelId
    ): Promise<boolean> {
        return (
            this.storage.disputes.didIDispute(forkId) ||
            (await this.localDiamondContract.isForkDisputed(channelId, forkId))
        );
    }

    /**
     * Ensure block.timestamp is within the allowed
     * p2pTime window of the previous timestamp, optionally
     * fetching a better on-chain timestamp if needed.
     */
    private async validateTimeLogic(
        block: Block
    ): Promise<BlockValidationResult> {
        // Calculate previousTimestamp
        let previousTimestamp: Timestamp;
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
        } else {
            previousStateSnapshot = previousBlockOrSnapshot.stateSnapshot;
            previousTimestamp = previousStateSnapshot!.timestamp;
        }

        // OBJECTIVE: isValidTimestamp check
        const isValidTimestamp =
            block.timestamp >= previousTimestamp &&
            block.timestamp <= previousTimestamp + this.timeConfig.p2pTime;

        if (!isValidTimestamp) {
            // if first block or previous block has on-chain timestamp -> we have all the data (best timestamp) -> safe to create a fraud proof
            if (
                // first block
                previousBlock === undefined ||
                //  previous block has on-chain timestamp
                previousBlock.onChainTimestamp !== undefined
            ) {
                // Already has best timestamp - persist InvalidTimestamp fraud proof
                this.fraudProofService.createInvalidTimestampProof(block);
                return BlockValidationResult.DISPUTE;
            }

            // Try on-chain query to update previous block on-chain timestamp
            const previousBlockOnChainTimestamp =
                await this.fetchOnChainTimestamp(previousBlock);

            // if previousBlockOnChainTimestamp not set/updated or less than previousTimestamp -> we have the best timestamp already -> safe to create a fraud proof
            if (
                !previousBlockOnChainTimestamp ||
                previousBlockOnChainTimestamp <= previousTimestamp
            ) {
                // False - persist InvalidTimestamp fraud proof
                this.fraudProofService.createInvalidTimestampProof(block);
                return BlockValidationResult.DISPUTE;
            }

            // True - Update the previous block with the on-chain timestamp
            previousBlock.onChainTimestamp = previousBlockOnChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                previousBlock.forkId,
                previousBlock.height,
                previousBlockOnChainTimestamp
            );

            // previousBlockOnChainTimestamp set - rerun validation - this time we have all the data to deduct the result
            return this.validateTimeLogic(block);
        }

        // OBJECTIVE: Check if block was posted too late on-chain
        if (await this.isPostedOnChainTooLate(previousTimestamp, block)) {
            // Block posted too late - create InvalidTimestamp fraud proof
            this.fraudProofService.createInvalidTimestampProof(block);
            return BlockValidationResult.DISPUTE;
        }

        if (block.onChainTimestamp !== undefined)
            return BlockValidationResult.SUCCESS;

        // SUBJECTIVE: hasOnChainTimestamp check
        const receivedWithinAgreementTime =
            Math.abs(Clock.getTimeInSeconds() - block.timestamp) <=
            this.timeConfig.agreementTime;

        if (!receivedWithinAgreementTime) {
            return BlockValidationResult.NOT_ENOUGH_TIME;
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

    private async fetchOnChainTimestamp(
        block: Block | undefined
    ): Promise<Timestamp | undefined> {
        if (block === undefined) {
            return undefined;
        }
        try {
            // Check if commitment exists on-chain
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    block.channelId,
                    block.forkId,
                    block.height,
                    block.author
                );

            if (!commitmentResult.found) {
                return undefined;
            }

            // filter BlockCalldataPosted calls by channelId and blockCalldataCommitment
            const filter =
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    block.channelId,
                    commitmentResult.blockCalldataCommitment
                );

            // Calculate how many blocks back should we look for the log on-chain
            let avgBlockTime = Clock.getAverageOnChainBlockTime();
            let maxTime =
                this.timeConfig.p2pTime +
                this.timeConfig.agreementTime +
                this.timeConfig.chainFallbackTime;
            const blocksToLookBack = Math.ceil(maxTime / avgBlockTime) * 2; // *2 to be safe and account for some delay/failure

            const logs = await this.stateChannelManagerContract.queryFilter(
                filter,
                -blocksToLookBack, // from block
                "latest" // to block
            );

            // There should be a single log if the commitment exists or none
            if (logs.length == 0) {
                return undefined;
            }
            if (logs.length > 1) {
                throw new Error(
                    `Multiple logs found for commitment: ${commitmentResult.blockCalldataCommitment} - logs: ${logs}`
                );
            }
            return Number(logs[0].args.timestamp);
        } catch (error) {
            console.error("Error fetching on-chain timestamp:", error);
            return undefined;
        }
    }

    private async isPostedOnChainTooLate(
        previousTimestamp: Timestamp,
        block: Block
    ): Promise<boolean> {
        // if doesn't have on-chain timestamp try and fetch it
        if (!block.onChainTimestamp) {
            let onChainTimestamp = await this.fetchOnChainTimestamp(block);
            // if still doesn't have on-chain timestamp return false - not posted at all
            if (!onChainTimestamp) return false;
            block.onChainTimestamp = onChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                block.forkId,
                block.height,
                onChainTimestamp
            );
        }

        // => Block has on-chain timestamp

        const maxAllowedTimestamp =
            previousTimestamp +
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime;

        if (block.onChainTimestamp > maxAllowedTimestamp) {
            return true;
        }
        return false;
    }
}
