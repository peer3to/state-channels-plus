import Storage from "@/storage";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Hash, Signature } from "@/types/types";
import { Codec, DisputeFraudStruct, Logger } from "@/utils";
import { FraudProofStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/FraudProofFacet";
import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import {
    DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksStruct,
    DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedStruct,
    DisputeInvalidBalanceInvariantStruct,
    DisputeInvalidBlockInStateProofApplyFraudProofStruct,
    DisputeInvalidOutputStateStruct,
    DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedStruct,
    DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedStruct,
    DisputeNotLatestStateStruct,
    DisputeOnChainSlashesNotSubsetStruct,
    TimeoutCalldataPostedStruct,
    TimeoutNotLinkedToLatestStateStruct,
    TimeoutParticipantNotNextStruct,
    TimeoutThresholdStruct,
    TimeoutTooEarlyStruct
} from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import { BigNumberish, BytesLike } from "ethers";

// ────────────────────── FRAUD PROOF SERVICE ─────────────────────

/**
 * Service class for handling fraud proof creation and validation
 */
export default class DisputeFraudProofService {
    constructor(
        private readonly storage: Storage,
        private readonly logger?: Logger
    ) {}

    createDisputeNotLatestState(
        dispute: DisputeStruct,
        encodedBlock: BytesLike,
        signature: Signature
    ): Hash {
        const proof: DisputeNotLatestStateStruct = {
            encodedBlock,
            signature: signature as BytesLike
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeNotLatestState,
            struct: proof
        });
    }

    createDisputeInvalidOutputState(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeInvalidOutputStateStruct = {
            auditingData
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidOutputState,
            struct: proof
        });
    }

    createDisputeInvalidStateProofWithoutAuditingDataIntegrityVerified(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedStruct =
            {
                auditingData
            };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified,
            struct: proof
        });
    }
    createDisputeInvalidStateProofWithAuditingDataIntegrityVerified(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedStruct =
            {
                auditingData
            };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidStateProofWithAuditingDataIntegrityVerified,
            struct: proof
        });
    }

    createDisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksStruct =
            {
                auditingData
            };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks,
            struct: proof
        });
    }
    createDisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedStruct =
            {
                auditingData
            };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified,
            struct: proof
        });
    }
    createDisputeInvalidBalanceInvariant(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeInvalidBalanceInvariantStruct = {
            auditingData
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            struct: proof
        });
    }
    createDisputeOnChainSlashesNotSubset(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeOnChainSlashesNotSubsetStruct = {
            auditingData
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
            struct: proof
        });
    }
    createTimeoutThreshold(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct,
        thresholdBlock: BlockConfirmationStruct
    ): Hash {
        const proof: TimeoutThresholdStruct = {
            thresholdBlock,
            auditingData
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutThreshold,
            struct: proof
        });
    }
    createTimeoutCalldataPosted(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct,
        postedBlock: SignedBlockStruct,
        onChainTimestamp: BigNumberish,
        previousBlockOnChainTimestamp: BigNumberish,
        previousBlockcalldata: SignedBlockStruct
    ): Hash {
        const proof: TimeoutCalldataPostedStruct = {
            auditingData,
            postedBlock,
            onChainTimestamp,
            previousBlockOnChainTimestamp,
            previousBlockcalldata
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutCalldataPosted,
            struct: proof
        });
    }
    createTimeoutNotLinkedToLatestState(dispute: DisputeStruct): Hash {
        const proof: TimeoutNotLinkedToLatestStateStruct = {
            __: false
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutNotLinkedToLatestState,
            struct: proof
        });
    }
    createTimeoutParticipantNotNext(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: TimeoutParticipantNotNextStruct = {
            auditingData
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutParticipantNotNext,
            struct: proof
        });
    }
    createTimeoutTooEarly(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct,
        previousBlockOnChainTimestampIfExists?: BigNumberish
    ): Hash {
        const proof: TimeoutTooEarlyStruct = {
            auditingData,
            previousBlockOnChainTimestamp:
                previousBlockOnChainTimestampIfExists || 0
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutTooEarly,
            struct: proof
        });
    }

    createDisputeInvalidBlockInStateProofApplyFraudProof(
        dispute: DisputeStruct,
        fraudProof: FraudProofStruct,
        blockIndexInUnfinalizedPartOfStateProof: number
    ): Hash {
        const proof: DisputeInvalidBlockInStateProofApplyFraudProofStruct = {
            fraudProof,
            blockIndexInUnfinalizedPartOfStateProof
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            struct: proof
        });
    }

    private storeFraudProof(
        dispute: DisputeStruct,
        proof: { type: DisputeFraudProofType; struct: DisputeFraudStruct }
    ): Hash {
        const disputeFraudProof: DisputeFraudProofStruct = {
            proofType: toSolidityDisputeFraudProofType(proof.type),
            participant: dispute.input.disputer,
            dispute: dispute,
            encodedProof: Codec.encode(proof.struct, proof.type)
        };

        const proofHash =
            this.storage.disputeFraudProofs.storeFraudProof(disputeFraudProof);

        this.logger?.warn("Stored dispute fraud proof", {
            forkId: dispute.input.forkId,
            type: DisputeFraudProofType[proof.type]
        });

        return proofHash;
    }
}
