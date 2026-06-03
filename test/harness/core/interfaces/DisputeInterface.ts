import type { Address, ChannelId, ForkId, Hash } from "@/types/types";
import type { DisputeWindowStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    BlockStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { StateProofStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export interface DisputeInterface {
    // --- reads: timeout & confirmation ---

    queryTimeoutForFork(forkId: ForkId): Promise<TimeoutStruct | undefined>;

    queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | undefined>;

    // --- reads: fraud proofs ---

    queryFraudProofForParticipant(addr: Address): Promise<
        | {
              proofType: number;
              participant: Address;
          }
        | undefined
    >;

    queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>>;

    // --- reads: auditing, windows, evidence ---

    queryDisputeAuditingData(req: {
        forkId: ForkId;
        stateProof: StateProofStruct;
        options?: { disputeLatestInboundMessageBlockHash?: Hash };
    }): Promise<DisputeAuditingDataStruct>;

    queryLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{ hasBlock: boolean; latestBlock: BlockStruct }>;

    queryDisputeWindows(req: {
        channelId: ChannelId;
        forkIds: ForkId[];
    }): Promise<DisputeWindowStructOutput[]>;

    queryOutboundMessageBlock(
        hash: Hash
    ): Promise<MessageBlockStruct | undefined>;

    // --- writes ---

    constructDispute(forkId: ForkId): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
        auditingData: DisputeAuditingDataStruct;
        fraudProofsToApply: FraudProofStruct[];
    }>;

    storeTimeout(req: {
        forkId: ForkId;
        timeout: TimeoutStruct;
    }): Promise<void>;

    setForceExit(value: boolean): Promise<void>;
}
