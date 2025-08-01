import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

// TypeChain types - Contract interfaces
import { StateChannelManagerProxy } from "@typechain-types";

// TypeChain types - Fraud proof types
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";

// Core components
import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset, hash } from "@/utils";
import { ExecutionFlags, FraudType, TimeConfig } from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Signature,
    Timestamp
} from "@/types/types";

import {
    isChannelOpen,
    getPreviousBlockOrSnapshot,
    PreviousEntity
} from "./utils/channelValidation";
import {
    ValidationFraudException,
    DoubleSignException,
    InvalidStateTransitionException,
    InvalidTimestampException,
    InvalidLeaderException,
    FraudProofService
} from "./utils/FraudProofService";

export default class ValidationService {
    constructor(
        private readonly storage: Storage,
        private readonly fraudProofService: FraudProofService,
        private readonly stateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly channelId: ChannelId,
        private readonly getForkId: () => ForkId
    ) {}

    async validateBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<ExecutionFlags> {
        const forkId = this.getForkId();
        const channelId = this.channelId;

        try {
            // 1. Check if channel is open
            if (!isChannelOpen(forkId)) {
                this.storage.queues.queueConfirmation(blockConfirmation);
                return ExecutionFlags.NOT_READY;
            }

            // 2. Authenticate the block and get participants
            const block = this.authenticateBlock(blockConfirmation, channelId);
            if (!block) {
                return ExecutionFlags.DISCONNECT;
            }
            const participants = await this.getParticipants(
                block.coordinates,
                channelId
            );

            // 3. check duplicate blocks
            const duplicateBlockFlag = this.checkDuplicateBlock(
                blockConfirmation,
                participants
            );
            // could be DISCONNECT, DUPLICATE, BROADCAST or undefined
            if (duplicateBlockFlag !== null) {
                return duplicateBlockFlag;
            }

            // 4. author is a participant
            if (!participants.has(block.author)) {
                return ExecutionFlags.DISCONNECT;
            }

            // previous block or snapshot
            const previousEntity = getPreviousBlockOrSnapshot(
                block.coordinates,
                this.storage
            );

            // 5. check conflicting block
            const blockEntry = this.storage.blocks.getBlockEntry(
                block.forkId,
                block.height
            );
            const maybePreExistingBlockConfirmation =
                blockEntry?.blockConfirmation;

            const { conflict, fraudType } = this.checkConflictingBlock(
                block,
                maybePreExistingBlockConfirmation?.signedBlock
            );
            if (conflict) {
                if (fraudType === FraudType.DOUBLE_SIGN) {
                    throw new DoubleSignException(
                        blockEntry!.blockConfirmation.signedBlock,
                        blockConfirmation.signedBlock
                    );
                }
                if (fraudType === FraudType.INVALID_STATE_TRANSITION) {
                    throw new InvalidStateTransitionException(
                        previousEntity,
                        blockConfirmation.signedBlock
                    );
                }

                return ExecutionFlags.DISCONNECT;
            }

            if (await this.isDisputedFork(block.forkId, channelId)) {
                this.storage.queues.queueConfirmation(blockConfirmation);
                return ExecutionFlags.NOT_READY;
            }
            // isNext
            if (block.height > this.storage.blocks.getNextBlockHeight(forkId)) {
                this.storage.queues.queueConfirmation(blockConfirmation);
                return ExecutionFlags.NOT_READY;
            }

            // Is linked
            if (!this.isLinked(block)) {
                return ExecutionFlags.DISCONNECT;
            }

            // isNextLeader
            const nextLeader = await this.stateMachine.getNextToWrite();
            if (nextLeader !== block.author) {
                // create invalid state transition proof
                throw new InvalidLeaderException(
                    previousEntity,
                    blockConfirmation.signedBlock
                );
            }

            // Time logic
            const timeValidationResult = await this.validateTimeLogic(
                block,
                previousEntity,
                blockConfirmation.signedBlock,
                channelId
            );
            if (timeValidationResult !== null) {
                // this can only be NOT_ENOUGH_TIME, other validation errors are OBJECTIVE and have thrown an exception
                return timeValidationResult;
            }

            return ExecutionFlags.SUCCESS;
        } catch (error) {
            if (error instanceof ValidationFraudException) {
                const fraudProof =
                    this.fraudProofService.createFraudProof(error);
                // TODO: Persist fraud proof to storage
                return ExecutionFlags.DISPUTE;
            }
            throw error; // Re-throw non-fraud exceptions
        }
    }

    // ────────────────────── VALIDATION METHODS ─────────────────────
    /**
     * Determine whether the given block properly chains
     * to its predecessor (or genesis snapshot).

     */
    private isLinked(block: Block): boolean {
        const { forkId, height } = block.coordinates;
        if (height === 0) {
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    forkId
                );
            if (!genesisSnapshot) {
                return false;
            }

            return genesisSnapshot.hash === block.previousBlockHash;
        }

        const prevBlockEntry = this.storage.blocks.getBlockEntry(
            forkId,
            height - 1
        );
        if (!prevBlockEntry) {
            return false;
        }
        const prevBlockHash = hash(
            prevBlockEntry.blockConfirmation.signedBlock.encodedBlock
        );
        return prevBlockHash === block.previousBlockHash;
    }

    private authenticateBlock(
        blockConfirmation: BlockConfirmationStruct,
        channelId: ChannelId
    ): Block | null {
        let block: Block;

        try {
            block = Block.decode(blockConfirmation.signedBlock.encodedBlock);
            if (block.channelId !== channelId) {
                return null;
            }
            if (
                block.getSignerAddress(
                    blockConfirmation.signedBlock.signature
                ) !== block.author
            ) {
                return null;
            }
        } catch (error) {
            return null;
        }

        return block;
    }

    private checkDuplicateBlock(
        blockConfirmation: BlockConfirmationStruct,
        participants: Set<Address>
    ): ExecutionFlags | null {
        const block = Block.decode(blockConfirmation.signedBlock.encodedBlock);

        // 1. Check if block is in queue
        if (
            this.storage.queues.isBlockQueued(blockConfirmation, {
                hash: block.hash
            })
        ) {
            const signerAddresses = block.getSignerAddresses(
                blockConfirmation.signatures as Signature[]
            );
            const areAllParticipants = isSubset(signerAddresses, participants);

            if (!areAllParticipants) {
                return ExecutionFlags.DISCONNECT;
            }

            // Store in queue (handles signature merging automatically)
            this.storage.queues.queueConfirmation(blockConfirmation);
            return ExecutionFlags.DUPLICATE;
        }

        // 2. Check if block is in block storage
        const existingBlockEntry = this.storage.blocks.getBlockEntry(
            block.hash
        );
        if (existingBlockEntry !== undefined) {
            const existingSignatures = new Set(
                this.storage.blocks.getSignatures(block.hash) as Signature[]
            );
            const incomingSignatures = new Set(
                blockConfirmation.signatures as Signature[]
            );
            const newSignatures = difference(
                incomingSignatures,
                existingSignatures
            );

            // no new signatures
            if (newSignatures.size === 0) {
                return ExecutionFlags.DUPLICATE;
            }

            // Validate new signatures are from participants
            const newSignerAddresses: Set<Address> = block.getSignerAddresses(
                Array.from(newSignatures)
            );
            const areNewSignersParticipants = isSubset(
                newSignerAddresses,
                participants
            );

            if (!areNewSignersParticipants) {
                return ExecutionFlags.DISCONNECT;
            }

            // Store (handles signature merging automatically)
            this.storage.blocks.storeBlockConfirmation(blockConfirmation);
            return ExecutionFlags.BROADCAST;
        }

        return null;
    }

    private checkConflictingBlock(
        block: Block,
        maybePreExistingSignedBlock: SignedBlockStruct | undefined
    ): {
        conflict: boolean;
        fraudType?: FraudType;
    } {
        // conflicting block ?
        if (!maybePreExistingSignedBlock) {
            return { conflict: false };
        }

        // name change for calirty, it isn't a maybe anymore
        const conflictingSignedBlock = maybePreExistingSignedBlock;

        const conflictingBlock = Block.decode(
            conflictingSignedBlock.encodedBlock
        );

        if (conflictingBlock.author === block.author) {
            // DOUBLE SIGN
            return {
                conflict: true,
                fraudType: FraudType.DOUBLE_SIGN
            };
        }
        return {
            conflict: true,
            //If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
            fraudType: this.isLinked(block)
                ? FraudType.INVALID_STATE_TRANSITION
                : undefined
        };
    }

    private async isDisputedFork(
        forkId: ForkId,
        channelId: ChannelId
    ): Promise<boolean> {
        return (
            this.storage.disputes.getDisputedFork(forkId) ||
            (await this.stateChannelManagerContract.isForkDisputed(
                channelId,
                forkId
            ))
        );
    }

    /**
     * Ensure block.timestamp is within the allowed
     * p2pTime window of the previous timestamp, optionally
     * fetching a better on-chain timestamp if needed.
     *
     * @param block            – the new block to validate
     * @param previousEntity   – prior block or snapshot data
     * @param signedBlock      – raw SignedBlockStruct
     * @param channelId        – for on-chain lookup
     * @returns ExecutionFlags.NOT_ENOUGH_TIME if time is only OBJECTIVELY invalid, otherwise `null`
     * @throws InvalidTimestampException when timestamp is OBJECTIVELY invalid
     */
    private async validateTimeLogic(
        block: Block,
        previousEntity: PreviousEntity,
        signedBlock: SignedBlockStruct,
        channelId: ChannelId
    ): Promise<ExecutionFlags | null> {
        let previousTimestamp: Timestamp;
        let previousBlock: Block | undefined;
        let previousStateSnapshot: StateSnapshot | undefined;

        if (previousEntity.blockConfirmation) {
            previousBlock = Block.decode(
                previousEntity.blockConfirmation.signedBlock.encodedBlock
            );
            previousTimestamp = previousBlock.getRelevantTimestamp(
                block.author,
                previousEntity.blockConfirmation.signatures
            );
        } else {
            previousStateSnapshot = previousEntity.stateSnapshot;
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
                throw new InvalidTimestampException(
                    previousEntity,
                    signedBlock
                );
            }

            // try to fetch later timestamp from on-chain data
            const onChainTimestamp = await this.fetchOnChainTimestamp(
                previousBlock,
                channelId
            );

            // Early return: Couldn't fetch or not better than current
            if (!onChainTimestamp || onChainTimestamp <= previousTimestamp) {
                throw new InvalidTimestampException(
                    previousEntity,
                    signedBlock
                );
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
                throw new InvalidTimestampException(
                    previousEntity,
                    signedBlock
                );
            }
            // If valid, continue with rest of validation

            if (
                block.onChainTimestamp === undefined ||
                block.onChainTimestamp <= block.timestamp
            ) {
                if (
                    Math.abs(Clock.getTimeInSeconds() - block.timestamp) >=
                    this.timeConfig.agreementTime
                )
                    return ExecutionFlags.NOT_ENOUGH_TIME;
            }
        }

        return null; // Time validation passed
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
