import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import { StateChannelManagerProxy } from "@typechain-types";
import { ZeroHash } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset, hash } from "@/utils";
import { BlockValidationAction, TimeConfig } from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Timestamp,
    BlockOrSnapshot
} from "@/types/types";

import FraudProofService from "./utils/FraudProofService";

export type ValidationResult = {
    shouldDisconnect?: boolean;
    action?: BlockValidationAction;
};

export default class ValidationService {
    private readonly fraudProofService: FraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly channelId: ChannelId,
        private readonly getForkId: () => ForkId
    ) {
        this.fraudProofService = new FraudProofService(this.storage);
    }

    async validateBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<ValidationResult> {
        const forkId = this.getForkId();
        const channelId = this.channelId;

        // 1. Check if channel is open
        if (!this.isChannelOpen(forkId)) {
            // not ready
            this.queueForLater(blockConfirmation);
            return { shouldDisconnect: false };
        }
        // 2. Authenticate the block
        const block = this.authenticateBlock(blockConfirmation, channelId);
        if (!block) {
            return { shouldDisconnect: true };
        }

        //  get participants
        const participants = await this.getParticipants(
            block.coordinates,
            channelId
        );

        // 3. check duplicate blocks
        const duplicateResult = this.checkDuplicateBlock(block, participants);

        if (duplicateResult !== undefined) {
            return duplicateResult;
        }

        // 4. author is a participant
        if (!participants.has(block.author)) {
            return { shouldDisconnect: true };
        }

        // 5. check conflicting block
        const conflictResult = this.checkConflictingBlock(block);
        if (conflictResult !== undefined) {
            return conflictResult;
        }

        if (await this.isDisputedFork(block.forkId, channelId)) {
            // not ready
            this.queueForLater(block);
            return { shouldDisconnect: false };
        }

        // isNext
        if (block.height > this.storage.blocks.getNextBlockHeight(forkId)) {
            // not ready
            this.queueForLater(block);
            return { shouldDisconnect: false };
        }

        // Is linked
        if (!this.isLinked(block)) {
            return { shouldDisconnect: true };
        }

        // previous block or snapshot
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            block.coordinates
        );

        // isNextLeader
        const nextLeader = await this.diamondStateMachine.getNextToWrite();
        if (nextLeader !== block.author) {
            // create invalid state transition proof
            this.fraudProofService.createInvalidStateTransitionProof(block);
            return {
                shouldDisconnect: true,
                action: BlockValidationAction.DISPUTE
            };
        }

        // Time logic
        const timeResult = await this.validateTimeLogic(
            block,
            previousBlockOrSnapshot,
            channelId
        );

        if (timeResult) {
            return timeResult;
        }

        return {
            action: BlockValidationAction.SUCCESS
        };
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
    ): ValidationResult | undefined {
        // 1. Check if block is in queue
        if (
            this.storage.queues.isBlockQueued(block, {
                hash: block.hash
            })
        ) {
            const signerAddresses = block.confirmationSignerAddresses;
            const areAllParticipants = isSubset(signerAddresses, participants);

            if (!areAllParticipants) {
                return { shouldDisconnect: true };
            }

            // Store in queue (handles signature merging automatically)
            this.queueForLater(block);
            return;
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
                return { shouldDisconnect: false };
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
                return { shouldDisconnect: true };
            }

            // Store new signatures and indicate broadcast
            this.storage.blocks.storeBlock(block);
            return { action: BlockValidationAction.BROADCAST };
        }

        return;
    }

    private checkConflictingBlock(block: Block): ValidationResult | undefined {
        // conflicting block ?
        const blockEntry = this.storage.blocks.getBlockEntry(
            block.forkId,
            block.height
        );
        const maybePreExistingBlock = blockEntry?.block;

        if (!maybePreExistingBlock) {
            return;
        }

        // name change for clarity, it isn't a maybe anymore
        const conflictingBlock = maybePreExistingBlock;

        if (conflictingBlock.author === block.author) {
            // DOUBLE SIGN
            this.fraudProofService.createDoubleSignProof(
                conflictingBlock,
                block
            );
            return {
                shouldDisconnect: true,
                action: BlockValidationAction.DISPUTE
            };
        }

        // If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
        if (this.isLinked(block)) {
            this.fraudProofService.createInvalidStateTransitionProof(block);
            return {
                shouldDisconnect: true,
                action: BlockValidationAction.DISPUTE
            };
        }

        return { shouldDisconnect: true };
    }

    private async isDisputedFork(
        forkId: ForkId,
        channelId: ChannelId
    ): Promise<boolean> {
        return (
            this.storage.disputes.didIDispute(forkId) ||
            (await this.diamondStateMachine.isForkDisputed(channelId, forkId))
        );
    }

    /**
     * Ensure block.timestamp is within the allowed
     * p2pTime window of the previous timestamp, optionally
     * fetching a better on-chain timestamp if needed.
     */
    private async validateTimeLogic(
        block: Block,
        previousblockOrSnapshot: BlockOrSnapshot,
        channelId: ChannelId
    ): Promise<ValidationResult | undefined> {
        let previousTimestamp: Timestamp;
        let previousBlock: Block | undefined;
        let previousStateSnapshot: StateSnapshot | undefined;

        if (previousblockOrSnapshot.block) {
            previousBlock = previousblockOrSnapshot.block;
            previousTimestamp = previousBlock.getRelevantTimestamp(
                block.author
            );
        } else {
            previousStateSnapshot = previousblockOrSnapshot.stateSnapshot;
            previousTimestamp = previousStateSnapshot!.timestamp;
        }

        const isValidTimestamp =
            block.timestamp >= previousTimestamp &&
            block.timestamp <= previousTimestamp + this.timeConfig.p2pTime;

        if (!isValidTimestamp) {
            if (
                block.height <= 0 || // genesis block
                previousBlock === undefined || // no previous block == genesis block
                previousBlock.onChainTimestamp !== undefined
            ) {
                // already has best timestamp
                // no point in trying to update the timestamp => fraud proof
                this.fraudProofService.createInvalidTimestampProof(block);
                return {
                    shouldDisconnect: true,
                    action: BlockValidationAction.DISPUTE
                };
            }

            // try to fetch later timestamp from on-chain data
            const onChainTimestamp = await this.fetchOnChainTimestamp(
                previousBlock,
                channelId
            );

            // Early return: Couldn't fetch or not better than current
            if (!onChainTimestamp || onChainTimestamp <= previousTimestamp) {
                this.fraudProofService.createInvalidTimestampProof(block);
                return {
                    shouldDisconnect: true,
                    action: BlockValidationAction.DISPUTE
                };
            }

            // Update the previous block with the on-chain timestamp
            previousBlock.onChainTimestamp = onChainTimestamp;
            this.storage.blocks.setOnChainTimestamp(
                previousBlock.forkId,
                previousBlock.height,
                onChainTimestamp
            );

            // Re-validate with updated timestamp
            const isValidTimestamp =
                block.timestamp >= onChainTimestamp &&
                block.timestamp <= onChainTimestamp + this.timeConfig.p2pTime;

            if (!isValidTimestamp) {
                this.fraudProofService.createInvalidTimestampProof(block);
                return {
                    shouldDisconnect: true,
                    action: BlockValidationAction.DISPUTE
                };
            }
            // If valid, continue with rest of validation

            if (
                block.onChainTimestamp === undefined ||
                block.onChainTimestamp <= block.timestamp
            ) {
                if (
                    Math.abs(Clock.getTimeInSeconds() - block.timestamp) >=
                    this.timeConfig.agreementTime
                ) {
                    return {
                        shouldDisconnect: false,
                        action: BlockValidationAction.NOT_ENOUGH_TIME
                    };
                }
            }
        }

        return; // Time validation passed
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
        blk: Block | undefined,
        channelId: ChannelId
    ): Promise<Timestamp | undefined> {
        if (blk === undefined) {
            return undefined;
        }
        try {
            // Check if commitment exists on-chain
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    channelId,
                    blk.forkId,
                    blk.height,
                    blk.author
                );

            if (!commitmentResult.found) {
                return undefined;
            }

            // filter BlockCalldataPosted calls by channelId and author
            const filter =
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    channelId,
                    blk.author
                );

            // best will be to get exact block number from on-chain data
            // but idk how to AND it is added complexity
            // assumptoin here is that the block is within the recent 3 blocks (recent, recent-1, recent-2)
            const logs = await this.stateChannelManagerContract.queryFilter(
                filter,
                -2, // from block
                "latest" // to block
            );

            // Find matching log

            for (let i = logs.length - 1; i >= 0; i--) {
                const log = logs[i];
                if (hash(log.args.signedBlock.encodedBlock) === blk.hash) {
                    return Number(log.args.timestamp);
                }
            }
            return undefined;
        } catch (error) {
            console.error("Error fetching on-chain timestamp:", error);
            return undefined;
        }
    }
}
