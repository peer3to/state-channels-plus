import { Block } from "@/models";
import { BlockValidationResult } from "@/types";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Logger } from "@/utils";
import Storage from "@/storage";

import DisputeValidationStrategy from "./DisputeValidationStrategy";

export default class MilestoneValidationStrategy extends DisputeValidationStrategy {
    constructor(
        storage: Storage,
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct,
        logger: Logger
    ) {
        // pass -1 as a sentinel — it is never read since all methods are overridden.
        super(storage, dispute, -1, auditingData, logger);
    }

    public async invalidStateTransitionDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
            this.dispute,
            this.auditingData
        );
        return BlockValidationResult.DISPUTE;
    }

    public async wrongGenesisDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
            this.dispute,
            this.auditingData
        );
        return BlockValidationResult.DISPUTE;
    }

    public async forgedInboundMessageBlockDetected(
        _block: Block,
        _messageBlock: MessageBlockStruct
    ): Promise<BlockValidationResult> {
        this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
            this.dispute,
            this.auditingData
        );
        return BlockValidationResult.DISPUTE;
    }

    public async objectiveInvalidTimestampDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
            this.dispute,
            this.auditingData
        );
        return BlockValidationResult.DISPUTE;
    }

    public async conflictingButNotLinkedBlockDetected(
        _block: Block
    ): Promise<BlockValidationResult> {
        this.disputeFraudProofService.createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
            this.dispute,
            this.auditingData
        );
        return BlockValidationResult.DISPUTE;
    }
}
