// External libraries
import { ethers } from "ethers";

// TypeChain types - Data types
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

// Models
import { Block, BlockCoordinates, StateSnapshot } from "@/models";

// Utils
import { difference, isSubset, hash } from "@/utils";

// Types
import { ExecutionFlags, FraudType, TimeConfig } from "@/types";
import {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";

const NULL = "0x00";

type PreviousEntity = {
    blockConfirmation?: BlockConfirmationStruct;
    stateSnapshot?: StateSnapshot;
};

// Custom exception classes for dispute creation
abstract class ValidationFraudException extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

class DoubleSignException extends ValidationFraudException {
    constructor(
        public readonly block1: SignedBlockStruct,
        public readonly block2: SignedBlockStruct
    ) {
        super("Double sign fraud detected");
    }
}

class InvalidStateTransitionException extends ValidationFraudException {
    constructor(
        public readonly previousEntity: PreviousEntity,
        public readonly invalidBlock: SignedBlockStruct
    ) {
        super("Invalid state transition fraud detected");
    }
}

class InvalidTimestampException extends ValidationFraudException {
    constructor(
        public readonly previousEntity: PreviousEntity,
        public readonly invalidBlock: SignedBlockStruct
    ) {
        super("Invalid timestamp fraud detected");
    }
}

class InvalidLeaderException extends ValidationFraudException {
    constructor(
        public readonly previousEntity: PreviousEntity,
        public readonly invalidBlock: SignedBlockStruct
    ) {
        super("Invalid leader fraud detected");
    }
}

export default class ValidationService {
    constructor(
        private readonly storage: Storage,
        private readonly stateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly channelId: ChannelId,
        private readonly getForkId: () => ForkId
    ) {}

    public async validateBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<ExecutionFlags> {
        try {
            // 1. Check if channel is open
            if (!this.isChannelOpen()) {
                this.storage.queues.queueConfirmation(blockConfirmation);
                return ExecutionFlags.NOT_READY;
            }

            // 2. Authenticate the block and get participants
            const block = this.authenticateBlock(blockConfirmation);
            if (!block) {
                return ExecutionFlags.DISCONNECT;
            }
            const participants = await this.getParticipants(block.coordinates);

            // 3. check duplicate blocks
            const duplicateBlockFlag = this.checkDuplicateBlock(
                blockConfirmation,
                participants
            );
            // could be DISCONNECT, DUPLICATE, BROADCAST or undefined
            if (duplicateBlockFlag !== undefined) {
                return duplicateBlockFlag;
            }

            // 4. author is a participant
            if (!participants.has(block.author)) {
                return ExecutionFlags.DISCONNECT;
            }

            // previous block or snapshot
            const previousEntity = this.getPreviousBlockOrSnapshot(
                block.coordinates
            );

            // 5. check conflicting block
            const maybePreExistingBlockConfirmation =
                this.storage.blocks.getBlockEntry(
                    block.forkId,
                    block.height
                )?.blockConfirmation;

            const { conflict, fraudType } = this.checkConflictingBlock(
                block,
                maybePreExistingBlockConfirmation?.signedBlock
            );
            if (conflict) {
                if (fraudType === FraudType.DOUBLE_SIGN) {
                    throw new DoubleSignException(
                        this.storage.blocks.getBlockEntry(
                            block.forkId,
                            block.height
                        )!.blockConfirmation.signedBlock,
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

            if (await this.isDisputedFork(block.forkId)) {
                this.storage.queues.queueConfirmation(blockConfirmation);
                return ExecutionFlags.NOT_READY;
            }
            // isNext
            if (
                block.height >
                this.storage.blocks.getNextBlockHeight(this.getForkId())
            ) {
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
            const timeValidationFlag = await this.validateTimeLogic(
                block,
                previousEntity
            );
            if (timeValidationFlag !== undefined) {
                return timeValidationFlag;
            }

            return ExecutionFlags.SUCCESS;
        } catch (error) {
            if (error instanceof ValidationFraudException) {
                if (error instanceof DoubleSignException) {
                    const fraudProof: BlockDoubleSignProofStruct = {
                        block1: error.block1,
                        block2: error.block2
                    };
                    // TODO: Persist fraud proof to storage
                    return ExecutionFlags.DISPUTE;
                } else if (error instanceof InvalidStateTransitionException) {
                    const fraudProof = this.createInvalidStateTransitionProof(
                        error.previousEntity,
                        error.invalidBlock
                    );
                    // TODO: Persist fraud proof to storage
                    return ExecutionFlags.DISPUTE;
                } else if (error instanceof InvalidTimestampException) {
                    const fraudProof = this.createInvalidStateTransitionProof(
                        error.previousEntity,
                        error.invalidBlock
                    );
                    // TODO: Persist fraud proof to storage
                    return ExecutionFlags.DISPUTE;
                } else if (error instanceof InvalidLeaderException) {
                    const fraudProof = this.createInvalidStateTransitionProof(
                        error.previousEntity,
                        error.invalidBlock
                    );
                    // TODO: Persist fraud proof to storage
                    return ExecutionFlags.DISPUTE;
                }
            }
            throw error; // Re-throw non-fraud exceptions
        }
    }

    // Validation method specifically for state transitions (used after transaction application)
    public validateStateTransition(
        encodedState: string,
        previousStateHash: Hash,
        previousEntity: PreviousEntity,
        blockConfirmation: BlockConfirmationStruct
    ): ExecutionFlags {
        try {
            if (!this.isValidStateTransition(encodedState, previousStateHash)) {
                throw new InvalidStateTransitionException(
                    previousEntity,
                    blockConfirmation.signedBlock
                );
            }
            return ExecutionFlags.SUCCESS;
        } catch (error) {
            if (error instanceof InvalidStateTransitionException) {
                const fraudProof = this.createInvalidStateTransitionProof(
                    error.previousEntity,
                    error.invalidBlock
                );
                // TODO: Persist fraud proof to storage
                return ExecutionFlags.DISPUTE;
            }
            throw error;
        }
    }

    // Preserved from old ValidationService
    public async fetchOnChainTimestamp(
        blk: Block | undefined
    ): Promise<Timestamp | undefined> {
        if (blk === undefined) {
            return undefined;
        }
        try {
            // Check if commitment exists on-chain
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    this.channelId,
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
                    this.channelId,
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

    // ────────────────────── VALIDATION METHODS ─────────────────────

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

    private isChannelOpen(): boolean {
        return (
            this.getForkId() !== ethers.ZeroHash && this.getForkId() !== NULL
        );
    }

    private authenticateBlock(
        blockConfirmation: BlockConfirmationStruct
    ): Block | undefined {
        let block: Block;

        try {
            block = Block.decode(blockConfirmation.signedBlock.encodedBlock);
            if (block.channelId !== this.channelId) {
                throw new Error(
                    "Block channelId does not match current channelId"
                );
            }
            if (
                block.getSignerAddress(
                    blockConfirmation.signedBlock.signature
                ) !== block.author
            ) {
                throw new Error("Block signature does not match block author");
            }
        } catch (error) {
            console.error("Invalid block confirmation", error);
            return undefined;
        }

        return block;
    }

    private checkDuplicateBlock(
        blockConfirmation: BlockConfirmationStruct,
        participants: Set<Address>
    ): ExecutionFlags | undefined {
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
        if (this.storage.blocks.getBlockEntry(block.hash) !== undefined) {
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

        return undefined;
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

    private async isDisputedFork(forkId: ForkId): Promise<boolean> {
        return (
            this.storage.disputes.getDisputedFork(forkId) ||
            (await this.stateChannelManagerContract.isForkDisputed(
                this.channelId,
                forkId
            ))
        );
    }

    // Assumes the previous data exists (called after isLinked check).
    private getPreviousBlockOrSnapshot({
        forkId,
        height
    }: BlockCoordinates): PreviousEntity {
        if (height > 0) {
            const prevBlockEntry = this.storage.blocks.getBlockEntry(
                forkId,
                height - 1
            )!;

            return { blockConfirmation: prevBlockEntry.blockConfirmation };
        }
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId)!;

        return { stateSnapshot: genesisSnapshot };
    }

    private createInvalidStateTransitionProof(
        previousEntity: PreviousEntity,
        signedBlock: SignedBlockStruct
    ): BlockInvalidStateTransitionProofStruct {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;

        if (previousEntity.blockConfirmation) {
            // Height > 0 case - we have a previous block
            prevSignedBlock = previousEntity.blockConfirmation.signedBlock;
            const prevBlock = Block.decode(prevSignedBlock!.encodedBlock);
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = NULL as unknown as SignedBlockStruct;
            prevStateSnapshot = previousEntity.stateSnapshot!;
        }

        return {
            invalidBlock: signedBlock,
            previousBlock: prevSignedBlock,
            previousBlockStateSnapshot: prevStateSnapshot.toStruct(),
            previousStateStateMachineState:
                this.storage.stateMachineStates.getStateMachineState(
                    prevStateSnapshot.stateMachineStateHash
                )!
        };
    }

    private async validateTimeLogic(
        block: Block,
        previousEntity: PreviousEntity
    ): Promise<ExecutionFlags | undefined> {
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

                // TODO: Create Invalid Timestamp Fraud Proof
                // TODO: Persist fraud proof to storage
                return ExecutionFlags.DISPUTE;
            }

            // try to fetch later timestamp from on-chain data
            const onChainTimestamp =
                await this.fetchOnChainTimestamp(previousBlock);

            // Early return: Couldn't fetch or not better than current
            if (!onChainTimestamp || onChainTimestamp <= previousTimestamp) {
                // TODO: Create Invalid Timestamp Fraud Proof
                // TODO: Persist fraud proof to storage
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
                // TODO: Create Invalid Timestamp Fraud Proof
                // TODO: Persist fraud proof to storage
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

        return undefined; // Time validation passed
    }

    private isValidStateTransition(
        encodedState: string,
        previousStateHash: Hash
    ): boolean {
        // state did not change
        if (hash(encodedState) === previousStateHash) {
            return false;
        }

        return true;
    }

    // ────────────────────── Helpers ─────────────────────

    private async getParticipants(
        blockCoordinates: BlockCoordinates
    ): Promise<Set<Address>> {
        let participants = new Set(
            this.storage.getParticipants(blockCoordinates)
        );

        if (participants.size === 0) {
            // get participants from chain
            const [participantsFromChain, pendingParticipants] =
                await Promise.all([
                    this.stateChannelManagerContract.getParticipants(
                        this.channelId
                    ),
                    this.stateChannelManagerContract.getPendingParticipants(
                        this.channelId
                    )
                ]);
            participants = new Set([
                ...participantsFromChain,
                ...pendingParticipants
            ]);
        }

        return participants;
    }
}
