import { Block, StateSnapshot } from "@/models";
import { BlockValidationResult, Signature } from "@/types";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";

export type ParticipantSnapshots = {
    previous: StateSnapshot;
    resulting: StateSnapshot;
};

export default abstract class AValidationStrategy {
    public get name(): string {
        return this.constructor.name;
    }

    public abstract interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean>;

    public abstract authenticateBlockFailed(
        block: BlockConfirmationStruct
    ): Promise<BlockValidationResult>;

    public abstract wrongChannel(block: Block): Promise<BlockValidationResult>;

    public abstract channelNotOpened(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult>;

    /**
     * Signatures on the block recover to addresses outside the block's
     * previous/resulting participant union. The strategy owns the side effects
     * (filtering, disconnecting the byzantine senders, fraud proofs); SUCCESS
     * means the block should continue through the pipeline with the stray
     * signatures removed. The suppliers of the stray signatures resolve from
     * the entry's signature -> source map. Signers are derivable O(1) via
     * `entry.block.signatureToAddress` (cached).
     */
    public abstract notAllSingersAreParticipants(
        entry: QueuedBlockEntry,
        unexpectedSignatures: Set<Signature>,
        participantSnapshots?: ParticipantSnapshots
    ): Promise<BlockValidationResult>;

    public abstract noNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract goodNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract blockAuthorIsNotParticipant(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult>;

    public abstract doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult>;

    /**
     * A height-0 block that doesn't link to the fork's genesis snapshot.
     * Takes the entry (not just the block) so strategies can attribute the
     * block to its source peers when the genesis snapshot is missing
     * entirely — that case can't produce a fraud proof.
     */
    public abstract wrongGenesisDetected(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult>;

    public abstract conflictingButNotLinkedBlockDetected(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract blockForkIsDisputed(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult>;

    public abstract blockIsNotNextAndIsInTheFuture(
        entry: QueuedBlockEntry
    ): Promise<BlockValidationResult>;

    public abstract blockIsNotLinkedAndIsNotFirstBlock(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract subjectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult>;
}
