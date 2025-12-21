import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import AValidationStrategy from "./AValidationStrategy";
import FraudProofService from "../utils/FraudProofService";
import Storage from "@/storage";
import ATransport from "@/transport/ATransport";
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
    public async interpretFinalValidationResult(
        blockValidationResult: BlockValidationResult
    ): Promise<boolean> {
        switch (blockValidationResult) {
            case BlockValidationResult.SUCCESS:
                // do nothing, do not disconnect
                return true;
            case BlockValidationResult.NOT_READY:
                // should not happen since stateProof is valid
                throw new Error(
                    "NOT_READY result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DUPLICATE:
                return true;
            case BlockValidationResult.NOT_ENOUGH_TIME:
                throw new Error(
                    "NOT_ENOUGH_TIME result in DisputeValidationStrategy"
                );
            case BlockValidationResult.DISCONNECT:
                // should be a DISPUTE since it's objective failure - it's commited in the stateProof
                throw new Error(
                    "DISCONNECT result in DisputeValidationStrategy"
                );
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
        block: BlockConfirmationStruct
    ): Promise<BlockValidationResult> {
        // This should never be the case, since stateProof is valid
        throw new Error("authenticateBlockFailed in DisputeValidationStrategy");
    }
    public async wrongChannel(_block: Block): Promise<BlockValidationResult> {
        // This should never be the case, since we should observe only our channel
        throw new Error("wrongChannel in DisputeValidationStrategy");
    }
    public async channelNotOpened(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - should not be the case, but have to think about it - can someone create junk disputes while the channel is not open and what to do in that case - probably abort channel opening if dispute window for genesis for exists
        throw new Error("channelNotOpened in DisputeValidationStrategy");
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
        const fraudProof = this.storage.fraudProofs.getFraudProofByHash(hash)!;
        this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
            this.dispute,
            fraudProof,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
        // await this.disputeManager.dispute(block.forkId);
        return BlockValidationResult.DISPUTE;
    }
    public async wrongGenesisDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - here we have to kill the dispute, since the dispute contains incorrect state
        const hash = this.fraudProofService.createWrongGenesisProof(block);
        const fraudProof = this.storage.fraudProofs.getFraudProofByHash(hash)!;
        this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
            this.dispute,
            fraudProof,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
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
        const fraudProof = this.storage.fraudProofs.getFraudProofByHash(hash)!;
        this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
            this.dispute,
            fraudProof,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
        return BlockValidationResult.DISPUTE;
    }
    public async conflictingButNotLinkedBlockDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        // This should never be the case, since stateProof is valid
        throw new Error(
            "conflictingButNotLinkedBlockDetected in DisputeValidationStrategy"
        );
    }
    public async blockForkIsDisputed(
        block: Block,
        _senderAddress?: string
    ): Promise<BlockValidationResult> {
        // continue syncing
        return BlockValidationResult.SUCCESS;
    }
    public async blockIsNotNextAndIsInTheFuture(
        block: Block,
        _senderAddress?: string
    ): Promise<BlockValidationResult> {
        // This should never be the case, since stateProof is valid
        throw new Error(
            "blockIsNotNextAndIsInTheFuture in DisputeValidationStrategy"
        );
    }
    public async blockIsNotLinkedAndIsNotFirstBlock(
        _block: Block
    ): Promise<BlockValidationResult> {
        // This should never be the case, since stateProof is valid
        throw new Error(
            "blockIsNotLinkedAndIsNotFirstBlock in DisputeValidationStrategy"
        );
    }
    public async objectiveInvalidTimestampDetected(
        block: Block
    ): Promise<BlockValidationResult> {
        // TODO - here we have to kill the dispute, since the dispute contains incorrect state
        // TODO - think about this - can this change over time? i.e. can onChainTimestamp or the presence of calldata change things
        const hash = this.fraudProofService.createInvalidTimestampProof(block);
        const fraudProof = this.storage.fraudProofs.getFraudProofByHash(hash)!;
        this.disputeFraudProofService.createDisputeInvalidBlockInStateProofApplyFraudProof(
            this.dispute,
            fraudProof,
            this.blockIndexInUnfinalizedPartOfStateProof
        );
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
