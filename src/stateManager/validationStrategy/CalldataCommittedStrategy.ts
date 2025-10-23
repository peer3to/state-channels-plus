import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import P2PManager from "@/P2PManager";
import DisputeManager from "@/disputeManager";
import BlockValidationStrategy from "./BlockValidationStrategy";

export default class CalldataCommittedStrategy extends AValidationStrategy {
    constructor(
        private readonly disputeManager: DisputeManager,
        private readonly blockValidationStrategy: BlockValidationStrategy
    ) {
        super();
    }
    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        return this.blockValidationStrategy.interpretFinalValidationResult(
            blockValidationResult
        );
    }
    public async authenticateBlockFailed(
        block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        // The block is committed on-chain by a participant (otherwise we're not interested in the calldata) -> the participant created an objective fault
        // TODO - fraud proof for this
        return BlockValidationResult.DISPUTE;
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - wrongChannel should not be collected"
        );
    }
    public async channelNotOpened(
        block: Block
    ): Promise<BlockValidationResult> {
        // not ready
        return this.blockValidationStrategy.channelNotOpened(block);
    }
    public async notAllSingersAreParticipants(
        _block: Block
    ): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - notAllSingersAreParticipants should not be relevant/called"
        );
    }
    public async noNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.noNewSignaturesOnExistingBlock(
            _block
        );
    }
    public async goodNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - goodNewSignaturesOnExistingBlock should not be relevant/called"
        );
    }
    public async blockAuthorIsNotParticipant(
        _block: Block
    ): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - blockAuthorIsNotParticipant should not be collected"
        );
    }
    public async doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult> {
        // DOUBLE SIGN
        return this.blockValidationStrategy.doubleSignDetected(
            conflictingBlock,
            block
        );
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.invalidStateTransitionDetected(
            block
        );
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.wrongGenesisDetected(block);
    }
    public async conflictingButNotLinkedBlockDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.conflictingButNotLinkedBlockDetected(
            _block
        );
    }
    public async blockForkIsDisputed(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.blockForkIsDisputed(block);
    }
    public async blockIsNotNextAndIsInTheFuture(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.blockIsNotNextAndIsInTheFuture(
            block
        );
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        // TODO - this one is anyoing since we have to treat this as `junk` even though peers are maybe colluding to perform a double sign or invalid state transition - we don't have the data for that
        // We have to FORCE TIMEOUT this - the force timeout challenge HAS TO require that presenting this calldata on-chain is linked to the dispute.StateProof for the disputeFraudProof to be accepted,
        // otherwise our dispute.StateProof will reveal information for the timeout peer to do a dispute containing a double sign or invalid state transition fraud proof, which when reduce will cancel the timeout
        return this.blockValidationStrategy.blockIsNotLinkedAndIsNotFirstBlock(
            _block
        );
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockValidationStrategy.objectiveInvalidTimestampDetected(
            block
        );
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        throw new Error(
            "CalldataCommittedStrategy - subjectiveInvalidTimestampDetected should not be relevant/called"
        );
    }
}
