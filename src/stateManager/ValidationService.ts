import {
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import { ZeroHash } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset, hash } from "@/utils";
import { ExecutionFlags, TimeConfig } from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Signature,
    Timestamp,
    BlockOrSnapshot
} from "@/types/types";

import FraudProofService from "./utils/FraudProofService";

export default class ValidationService {
    private readonly fraudProofService: FraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly stateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly localDiamond: LocalDiamond,
        private readonly timeConfig: TimeConfig,
        private readonly channelId: ChannelId,
        private readonly getForkId: () => ForkId
    ) {
        this.fraudProofService = new FraudProofService(this.storage);
    }

    async validateBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<ExecutionFlags> {
        const forkId = this.getForkId();
        const channelId = this.channelId;

        // 1. Check if channel is open
        if (!this.isChannelOpen(forkId)) {
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

        // 5. check conflicting block
        const { conflict, executionFlag } = this.checkConflictingBlock(
            block,
            blockConfirmation.signedBlock
        );
        if (conflict) {
            return executionFlag!;
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

        // previous block or snapshot
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            block.coordinates
        );

        // isNextLeader
        const nextLeader = await this.stateMachine.getNextToWrite();
        if (nextLeader !== block.author) {
            // create invalid state transition proof
            this.fraudProofService.createInvalidStateTransitionProof(
                block.coordinates,
                blockConfirmation.signedBlock
            );
            return ExecutionFlags.DISPUTE;
        }

        // Time logic
        const timeValidationResult = await this.validateTimeLogic(
            block,
            previousBlockOrSnapshot,
            blockConfirmation.signedBlock,
            channelId
        );
        if (timeValidationResult !== null) {
            // this can be NOT_ENOUGH_TIME or DISPUTE
            return timeValidationResult;
        }

        return ExecutionFlags.SUCCESS;
    }

    // ────────────────────── VALIDATION METHODS ─────────────────────
    /**
     * Determine whether the given block properly chains
     * to its predecessor (or genesis snapshot).

     */

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
        signedBlock: SignedBlockStruct
    ): {
        conflict: boolean;
        executionFlag?: ExecutionFlags;
    } {
        // conflicting block ?
        const blockEntry = this.storage.blocks.getBlockEntry(
            block.forkId,
            block.height
        );
        const maybePreExistingBlockConfirmation = blockEntry?.blockConfirmation;

        if (!maybePreExistingBlockConfirmation) {
            return { conflict: false };
        }

        // name change for clarity, it isn't a maybe anymore
        const conflictingSignedBlock =
            maybePreExistingBlockConfirmation.signedBlock;

        const conflictingBlock = Block.decode(
            conflictingSignedBlock.encodedBlock
        );

        if (conflictingBlock.author === block.author) {
            // DOUBLE SIGN
            this.fraudProofService.createDoubleSignProof(
                conflictingSignedBlock,
                signedBlock
            );
            return { conflict: true, executionFlag: ExecutionFlags.DISPUTE };
        }

        // If not linked we can't slash since the peer could have been building on the wrong 'reality' since someone performed a double sign
        if (this.isLinked(block)) {
            this.fraudProofService.createInvalidStateTransitionProof(
                block.coordinates,
                signedBlock
            );
            return { conflict: true, executionFlag: ExecutionFlags.DISPUTE };
        }

        return {
            conflict: true,
            executionFlag: ExecutionFlags.DISCONNECT
        };
    }

    private async isDisputedFork(
        forkId: ForkId,
        channelId: ChannelId
    ): Promise<boolean> {
        return (
            this.storage.disputes.getDisputedFork(forkId) ||
            (await this.localDiamond.isForkDisputed(channelId, forkId))
        );
    }

    /**
     * Ensure block.timestamp is within the allowed
     * p2pTime window of the previous timestamp, optionally
     * fetching a better on-chain timestamp if needed.
     *
     * @param block            – the new block to validate
     * @param previousblockOrSnapshot   – prior block or snapshot data
     * @param signedBlock      – raw SignedBlockStruct
     * @param channelId        – for on-chain lookup
     * @returns ExecutionFlags.NOT_ENOUGH_TIME if time is only OBJECTIVELY invalid, otherwise `null`
     * @throws InvalidTimestampException when timestamp is OBJECTIVELY invalid
     */
    private async validateTimeLogic(
        block: Block,
        previousblockOrSnapshot: BlockOrSnapshot,
        signedBlock: SignedBlockStruct,
        channelId: ChannelId
    ): Promise<ExecutionFlags | null> {
        let previousTimestamp: Timestamp;
        let previousBlock: Block | undefined;
        let previousStateSnapshot: StateSnapshot | undefined;

        if (previousblockOrSnapshot.blockConfirmation) {
            previousBlock = Block.decode(
                previousblockOrSnapshot.blockConfirmation.signedBlock
                    .encodedBlock
            );
            previousTimestamp = previousBlock.getRelevantTimestamp(
                block.author,
                previousblockOrSnapshot.blockConfirmation.signatures
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
                this.fraudProofService.createInvalidTimestampProof(
                    block.coordinates,
                    signedBlock
                );
                return ExecutionFlags.DISPUTE;
            }

            // try to fetch later timestamp from on-chain data
            const onChainTimestamp = await this.fetchOnChainTimestamp(
                previousBlock,
                channelId
            );

            // Early return: Couldn't fetch or not better than current
            if (!onChainTimestamp || onChainTimestamp <= previousTimestamp) {
                this.fraudProofService.createInvalidTimestampProof(
                    block.coordinates,
                    signedBlock
                );
                return ExecutionFlags.DISPUTE;
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
                this.fraudProofService.createInvalidTimestampProof(
                    block.coordinates,
                    signedBlock
                );
                return ExecutionFlags.DISPUTE;
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
