import Storage from "@/storage";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Bytes, Hash, Signature } from "@/types/types";
import { Codec, DisputeFraudStruct, Logger } from "@/utils";
import {
    BlockConfirmationStruct,
    MessageBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    DisputeFraudProofStruct,
    FraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import {
    DisputeInvalidBalanceInvariantStruct,
    DisputeInvalidBlockInStateProofApplyFraudProofStruct,
    DisputeInvalidOutputStateStruct,
    DisputeInvalidStateProofStruct,
    DisputeNotLatestStateStruct,
    DisputeOnChainSlashesNotSubsetStruct,
    TimeoutCalldataPostedStruct,
    TimeoutNotLinkedToLatestStateStruct,
    TimeoutParticipantNotNextStruct,
    TimeoutThresholdStruct,
    TimeoutTooEarlyStruct,
    DisputeLastMilestoneNotFinalAndNoAuditingDataStruct,
    InvalidDisputeReasonStruct
} from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import { BigNumberish, BytesLike } from "ethers";
// ────────────────────── FRAUD PROOF SERVICE ─────────────────────

/**
 * Service class for handling fraud proof creation and validation
 */
export default class DisputeFraudProofService {
    constructor(
        private readonly storage: Storage,
        private readonly logger: Logger
    ) {
        this.logger = logger.child({ component: "DisputeFraudProofService" });
    }

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
        latestStateSnapshot: StateSnapshotStruct,
        latestStateMachineState: Bytes,
        inboundMessageBlocks: MessageBlockStruct[]
    ): Hash {
        const proof: DisputeInvalidOutputStateStruct = {
            latestStateSnapshot,
            latestStateMachineState,
            inboundMessageBlocks
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidOutputState,
            struct: proof
        });
    }

    createDisputeInvalidStateProof(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): Hash {
        const proof: DisputeInvalidStateProofStruct = {
            auditingData
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidStateProof,
            struct: proof
        });
    }
    createDisputeInvalidBalanceInvariant(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct,
        latestStateMachineState: Bytes
    ): Hash {
        const proof: DisputeInvalidBalanceInvariantStruct = {
            latestStateSnapshot,
            latestStateMachineState
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            struct: proof
        });
    }
    createDisputeOnChainSlashesNotSubset(dispute: DisputeStruct): Hash {
        const proof: DisputeOnChainSlashesNotSubsetStruct = {
            __: false
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
            struct: proof
        });
    }
    createTimeoutThreshold(
        dispute: DisputeStruct,
        thresholdBlock: BlockConfirmationStruct,
        latestStateSnapshot: StateSnapshotStruct,
        thresholdStateSnapshot: StateSnapshotStruct
    ): Hash {
        const proof: TimeoutThresholdStruct = {
            thresholdBlock,
            latestStateSnapshot,
            thresholdStateSnapshot
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutThreshold,
            struct: proof
        });
    }
    createTimeoutCalldataPosted(
        dispute: DisputeStruct,
        genesisStateSnapshotData: DisputeAuditingDataStruct["genesisStateSnapshotData"],
        latestStateSnapshot: StateSnapshotStruct,
        latestStateStateMachineState: Bytes,
        postedBlock: SignedBlockStruct,
        onChainTimestamp: BigNumberish,
        previousBlockOnChainTimestamp: BigNumberish,
        previousBlockcalldata: SignedBlockStruct
    ): Hash {
        const proof: TimeoutCalldataPostedStruct = {
            genesisStateSnapshotData,
            latestStateSnapshot,
            latestStateStateMachineState,
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

    createDisputeLastMilestoneNotFinalAndNoAuditingData(
        dispute: DisputeStruct
    ): Hash {
        const proof: DisputeLastMilestoneNotFinalAndNoAuditingDataStruct = {
            __: false
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
            struct: proof
        });
    }

    createTimeoutParticipantNotNext(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct,
        latestStateStateMachineState: Bytes
    ): Hash {
        const proof: TimeoutParticipantNotNextStruct = {
            latestStateSnapshot,
            latestStateStateMachineState
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutParticipantNotNext,
            struct: proof
        });
    }
    createTimeoutTooEarly(
        dispute: DisputeStruct,
        genesisStateSnapshotData: DisputeAuditingDataStruct["genesisStateSnapshotData"],
        previousBlockOnChainTimestampIfExists?: BigNumberish
    ): Hash {
        const proof: TimeoutTooEarlyStruct = {
            genesisStateSnapshotData,
            previousBlockOnChainTimestamp:
                previousBlockOnChainTimestampIfExists || 0
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.TimeoutTooEarly,
            struct: proof
        });
    }

    createInvalidDisputeReason(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct
    ): Hash {
        const proof: InvalidDisputeReasonStruct = {
            latestStateSnapshot
        };

        return this.storeFraudProof(dispute, {
            type: DisputeFraudProofType.InvalidDisputeReason,
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

        const disputeHash =
            this.storage.disputeFraudProofs.storeFraudProof(disputeFraudProof);

        this.logger.debug("Stored dispute fraud proof", {
            forkId: dispute.input.forkId,
            type: DisputeFraudProofType[proof.type]
        });

        return disputeHash;
    }
}
