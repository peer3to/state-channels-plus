import { Block, StateSnapshot } from "@/models";
import { BlockValidationResult } from "@/types";
import { Address, Bytes } from "@/types/types";
import { BalanceStruct } from "@typechain-types/contracts/V1/AStateMachine";
import {
    BlockConfirmationStruct,
    ExitChannelBlockStruct
} from "@typechain-types/contracts/V1/StateChannelManagerEvents";

export default abstract class AValidationStrategy {
    public abstract interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean>;

    public abstract authenticateBlockFailed(
        block: BlockConfirmationStruct
    ): Promise<BlockValidationResult>;

    public abstract wrongChannel(block: Block): Promise<BlockValidationResult>;

    public abstract channelNotOpened(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract notAllSingersAreParticipants(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract noNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract goodNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract blockAuthorIsNotParticipant(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract conflictingButNotLinkedBlockDetected(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract blockForkIsDisputed(
        block: Block
    ): Promise<BlockValidationResult>;

    public abstract blockIsNotNextAndIsInTheFuture(
        block: Block
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
