import { Block } from "@/models";
import { BlockValidationResult, Hash } from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import DisputeFraudProofService from "../utils/DisputeFraudProofService";
import {
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Logger } from "@/utils";

export default class DisputeValidationStrategy extends AValidationStrategy {
    readonly fraudProofService: FraudProofService;
    readonly disputeFraudProofService: DisputeFraudProofService;
    private readonly logger: Logger;

    constructor(
        private readonly storage: Storage,
        private readonly dispute: DisputeStruct,
        private readonly blockIndexInUnfinalizedPartOfStateProof: number,
        logger: Logger
    ) {
        super();
        this.logger = logger.child({ component: "DisputeValidation" });
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage,
            this.logger
        );
    }

    private createDisputeInvalidBlockInStateProofApplyFraudProof(
        fraudProofHash: Hash
    ): void {
        const fraudProof =
            this.storage.fraudProofs.getFraudProofByHash(fraudProofHash)!;
        this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
            this.dispute,
            fraudProof,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
    }

    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        switch (blockValidationResult) {
            case BlockValidationResult.SUCCESS:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.NOT_READY:
                return false;
            case BlockValidationResult.DUPLICATE:
                return true;
            case BlockValidationResult.NOT_ENOUGH_TIME:
                throw new Error(
                    "NOT_ENOUGH_TIME result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DISCONNECT:
                return false;
            case BlockValidationResult.BROADCAST:
                throw new Error(
                    "BROADCAST result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DISPUTE:
                return false;
            default:
                throw new Error(
                    "Unknown BlockValidationResult in DisputeValidationStrategy"
                );
        }
    }
    public async authenticateBlockFailed(
        _block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async channelNotOpened(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async notAllSingersAreParticipants(
        _block: Block
    ): Promise<BlockValidationResult> {
        /**
         * StateProof milestones check and require that signers are participants so this should never fail there.
         * This can be called only if stateProof.signedBlocks are not from participants, in which case we'll let this pipeline continue and fail on the STF since only a participant can autor a block
         */
        return BlockValidationResult.SUCCESS;
    }
    public async noNewSignaturesOnExistingBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DUPLICATE;
    }
    public async goodNewSignaturesOnExistingBlock(
        block: Block
    ): Promise<BlockValidationResult> {
        // Store new signatures and success
        this.storage.blocks.storeBlock(block);
        return BlockValidationResult.DUPLICATE;
    }
    public async blockAuthorIsNotParticipant(
        _block: Block
    ): Promise<BlockValidationResult> {
        // TODO - DisputeFraudProof - previousStateSnapshot.participants does not contain block author -> kill dispute
        // let it fail on invalid STF or prior
        return BlockValidationResult.SUCCESS;
    }
    public async doubleSignDetected(
        conflictingBlock: Block,
        block: Block
    ): Promise<BlockValidationResult> {
        // Create and apply normal fraud proof to slash the offender + DEFER creating a new dispute - this dispute may still be honest, so continute validation
        this.fraudProofService.createDoubleSignProof(conflictingBlock, block);
        // TODO - apply the fraud proof without creating a new dispute
        // await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.SUCCESS; // so we continue 'syncing' and checking new blocks
    }
    public async invalidStateTransitionDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - here we have to kill the dispute, since the dispute contains incorrect state
        const hash =
            this.fraudProofService.createInvalidStateTransitionProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        // await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - here we have to kill the dispute, since the dispute contains incorrect state
        const hash = this.fraudProofService.createWrongGenesisProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        // await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async forgedInboundMessageBlockDetected(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        const hash =
            this.fraudProofService.createForgedInboundMessageBlockProof(
                block,
                messageBlock
            );
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        return this.blockIsNotLinkedAndIsNotFirstBlock(block);
    }
    public async blockForkIsDisputed(
        _block: Block,
        _senderAddress?: string
    ): Promise<BlockValidationResult> {
        // continue syncing
        return BlockValidationResult.SUCCESS;
    }
    public async blockIsNotNextAndIsInTheFuture(
        _block: Block,
        _senderAddress?: string
    ): Promise<BlockValidationResult> {
        return BlockValidationResult.DISCONNECT;
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        block: Block
    ): Promise<BlockValidationResult> {
        const hash =
            this.fraudProofService.createInvalidStateTransitionProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        return BlockValidationResult.DISPUTE;
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - here we have to kill the dispute, since the dispute contains incorrect state
        // TODO - think about this - can this change over time? i.e. can onChainTimestamp or the presence of calldata change things
        const hash = this.fraudProofService.createInvalidTimestampProof(block);
        this.createDisputeInvalidBlockInStateProofApplyFraudProof(hash);
        // await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async subjectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        // This is not relevant here - just continue and accept the block
        return BlockValidationResult.SUCCESS;
    }
}
