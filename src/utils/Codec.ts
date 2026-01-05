import { ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    OpenChannelStruct,
    TransactionStruct,
    StateSnapshotStruct,
    ExitChannelBlockStruct,
    BlockConfirmationStruct,
    ExitChannelStruct,
    JoinChannelBlockStruct,
    SnapshotDataStruct,
    SignedBlockStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct,
    WrongGenesisProofStruct,
    ForgedInboundMessageBlockProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";
import {
    BlockEthersType,
    BlockCommitmentEthersType,
    DisputeEthersType,
    JoinChannelEthersType,
    OpenChannelEthersType,
    TransactionEthersType,
    StateSnapshotEthersType,
    JoinChannelBlockEthersType,
    ExitChannelEthersType,
    ExitChannelBlockEthersType,
    BlockConfirmationEthersType,
    SnapshotDataEthersType,
    BlockDoubleSignProofEthersType,
    BlockInvalidStateTransitionProofEthersType,
    InvalidTimestampProofEthersType,
    WrongGenesisProofEthersType,
    ForgedInboundMessageBlockProofEthersType,
    DisputeAuditingDataEthersType,
    DisputeNotLatestStateProofEthersType,
    DisputeInvalidOutputStateProofEthersType,
    DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedProofEthersType,
    DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedProofEthersType,
    DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksProofEthersType,
    DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedProofEthersType,
    DisputeInvalidBalanceInvariantProofEthersType,
    DisputeOnChainSlashesNotSubsetProofEthersType,
    TimeoutThresholdProofEthersType,
    TimeoutCalldataPostedProofEthersType,
    TimeoutNotLinkedToLatestStateProofEthersType,
    TimeoutParticipantNotNextProofEthersType,
    TimeoutTooEarlyProofEthersType,
    DisputeInvalidBlockInStateProofApplyFraudProofEthersType,
    MessageBlockEthersType
} from "@/types";
import {
    DisputeStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Bytes, Timestamp } from "@/types/types";
import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import { ExecResult } from "@ethereumjs/evm";
import {
    DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksStruct,
    DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedStruct,
    DisputeInvalidBalanceInvariantStruct,
    DisputeOnChainSlashesNotSubsetStruct,
    DisputeInvalidBlockInStateProofApplyFraudProofStruct,
    DisputeInvalidOutputStateStruct,
    DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedStruct,
    DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedStruct,
    DisputeNotLatestStateStruct,
    TimeoutCalldataPostedStruct,
    TimeoutNotLinkedToLatestStateStruct,
    TimeoutParticipantNotNextStruct,
    TimeoutThresholdStruct,
    TimeoutTooEarlyStruct
} from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";

export type FraudStruct =
    | BlockDoubleSignProofStruct
    | BlockInvalidStateTransitionProofStruct
    | InvalidTimestampProofStruct
    | WrongGenesisProofStruct
    | ForgedInboundMessageBlockProofStruct;

export type DisputeFraudStruct =
    | DisputeNotLatestStateStruct
    | DisputeInvalidOutputStateStruct
    | DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedStruct
    | DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedStruct
    | DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksStruct
    | DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedStruct
    | DisputeInvalidBalanceInvariantStruct
    | DisputeOnChainSlashesNotSubsetStruct
    | TimeoutThresholdStruct
    | TimeoutCalldataPostedStruct
    | TimeoutNotLinkedToLatestStateStruct
    | TimeoutParticipantNotNextStruct
    | TimeoutTooEarlyStruct
    | DisputeInvalidBlockInStateProofApplyFraudProofStruct;

type StructType =
    | FraudStruct
    | DisputeFraudStruct
    | BlockStruct
    | { signedBlock: SignedBlockStruct; timestamp: Timestamp }
    | BlockConfirmationStruct
    | JoinChannelStruct
    | OpenChannelStruct
    | TransactionStruct
    | DisputeStruct
    | StateSnapshotStruct
    | SnapshotDataStruct
    | JoinChannelBlockStruct
    | ExitChannelBlockStruct
    | ExitChannelStruct
    | DisputeAuditingDataStruct
    | MessageBlockStruct;

// Enum for better autocomplete and type safety
export enum Type {
    Block,
    BlockCommitment,
    JoinChannel,
    OpenChannel,
    BlockConfirmation,
    Transaction,
    Dispute,
    StateSnapshot,
    SnapshotData,
    JoinChannelBlock,
    ExitChannelBlock,
    ExitChannel,
    DisputeAuditingData,
    MessageBlock
}

export class Codec {
    private static readonly structToEthersType = new Map<
        Type | FraudProofType | DisputeFraudProofType,
        string
    >([
        [Type.Block, BlockEthersType],
        [Type.BlockCommitment, BlockCommitmentEthersType],
        [Type.JoinChannel, JoinChannelEthersType],
        [Type.OpenChannel, OpenChannelEthersType],
        [Type.BlockConfirmation, BlockConfirmationEthersType],
        [Type.Transaction, TransactionEthersType],
        [Type.Dispute, DisputeEthersType],
        [Type.StateSnapshot, StateSnapshotEthersType],
        [Type.SnapshotData, SnapshotDataEthersType],
        [Type.JoinChannelBlock, JoinChannelBlockEthersType],
        [Type.ExitChannelBlock, ExitChannelBlockEthersType],
        [Type.ExitChannel, ExitChannelEthersType],
        [Type.DisputeAuditingData, DisputeAuditingDataEthersType],
        [Type.MessageBlock, MessageBlockEthersType],
        // Fraud proofs
        [FraudProofType.BlockDoubleSign, BlockDoubleSignProofEthersType],
        [
            FraudProofType.BlockInvalidStateTransition,
            BlockInvalidStateTransitionProofEthersType
        ],
        [FraudProofType.InvalidTimestamp, InvalidTimestampProofEthersType],
        [FraudProofType.WrongGenesis, WrongGenesisProofEthersType],
        [
            FraudProofType.ForgedInboundMessageBlock,
            ForgedInboundMessageBlockProofEthersType
        ],
        // Dispute fraud proofs
        [
            DisputeFraudProofType.DisputeNotLatestState,
            DisputeNotLatestStateProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeInvalidOutputState,
            DisputeInvalidOutputStateProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeInvalidStateProofWithoutAuditingDataIntegrityVerified,
            DisputeInvalidStateProofWithoutAuditingDataIntegrityVerifiedProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeInvalidStateProofWithAuditingDataIntegrityVerified,
            DisputeInvalidStateProofWithAuditingDataIntegrityVerifiedProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocks,
            DisputeIncorrectAuditingDataCommitmentWithValidStateProofAndValidOutboundMessageBlocksProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerified,
            DisputeIncorrectAuditingDataWithAuditingDataIntegrityVerifiedProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            DisputeInvalidBalanceInvariantProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
            DisputeOnChainSlashesNotSubsetProofEthersType
        ],
        [
            DisputeFraudProofType.TimeoutThreshold,
            TimeoutThresholdProofEthersType
        ],
        [
            DisputeFraudProofType.TimeoutCalldataPosted,
            TimeoutCalldataPostedProofEthersType
        ],
        [
            DisputeFraudProofType.TimeoutNotLinkedToLatestState,
            TimeoutNotLinkedToLatestStateProofEthersType
        ],
        [
            DisputeFraudProofType.TimeoutParticipantNotNext,
            TimeoutParticipantNotNextProofEthersType
        ],
        [DisputeFraudProofType.TimeoutTooEarly, TimeoutTooEarlyProofEthersType],
        [
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            DisputeInvalidBlockInStateProofApplyFraudProofEthersType
        ]
    ]);

    public static encode(
        struct: StructType,
        type: Type | FraudProofType | DisputeFraudProofType
    ): Bytes {
        const ethersType = this.structToEthersType.get(type);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${type}`);
        }
        try {
            return ethers.AbiCoder.defaultAbiCoder().encode(
                [ethersType],
                [struct]
            );
        } catch (error) {
            const preview =
                typeof struct === "object"
                    ? JSON.stringify(
                          struct,
                          (_key, value) =>
                              typeof value === "bigint"
                                  ? value.toString()
                                  : value,
                          2
                      )
                    : String(struct);
            const typeName =
                typeof type === "number" && Type[type]
                    ? `Type.${Type[type]}`
                    : String(type);
            throw new Error(
                `Codec.encode failed for ${typeName}: ${(error as Error).message}. value=${preview}`
            );
        }
    }

    // Function overloads for type safety
    public static decode(encoded: Bytes, type: Type.Block): BlockStruct;
    public static decode(
        encoded: Bytes,
        type: Type.JoinChannel
    ): JoinChannelStruct;
    public static decode(
        encoded: Bytes,
        type: Type.OpenChannel
    ): OpenChannelStruct;
    public static decode(
        encoded: Bytes,
        type: Type.ExitChannel
    ): ExitChannelStruct;
    public static decode(
        encoded: Bytes,
        type: Type.Transaction
    ): TransactionStruct;
    public static decode(encoded: Bytes, type: Type.Dispute): DisputeStruct;
    public static decode(
        encoded: Bytes,
        type: Type.StateSnapshot
    ): StateSnapshotStruct;
    public static decode(
        encoded: Bytes,
        type: Type.SnapshotData
    ): SnapshotDataStruct;
    public static decode(
        encoded: Bytes,
        type: Type.JoinChannelBlock
    ): JoinChannelBlockStruct;
    public static decode(
        encoded: Bytes,
        type: Type.ExitChannelBlock
    ): ExitChannelBlockStruct;
    public static decode(
        encoded: Bytes,
        type: Type.MessageBlock
    ): MessageBlockStruct;

    public static decode<T extends StructType>(
        encoded: Bytes,
        type: Type | FraudProofType | DisputeFraudProofType
    ): T {
        const ethersType = this.structToEthersType.get(type);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${type}`);
        }

        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [ethersType],
            encoded
        );
        return this.ethersResultToObjectRecursive(decoded[0]) as T;
    }

    public static ethersResultToObjectRecursive(result: ethers.Result) {
        let obj: Record<string, any> = {};
        try {
            obj = result.toObject();
            let cnt = 0;
            for (const key in obj) {
                if (key == "_") obj = result.toArray();
                cnt++;
            }
            if (cnt == 0) obj = result.toArray();
        } catch (e) {
            obj = result.toArray();
        }
        for (const key in obj) {
            if (
                obj[key] instanceof ethers.Result &&
                Object.getPrototypeOf(obj[key]) === ethers.Result.prototype
            ) {
                obj[key] = this.ethersResultToObjectRecursive(obj[key]);
            }
        }
        return obj;
    }

    public static decodeEvmResult<T>(
        execResult: ExecResult,
        ethersType: string,
        options: {
            useObjectConversion: boolean;
        } = {
            useObjectConversion: false
        }
    ): T {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [ethersType],
            execResult.returnValue
        );

        const value = decoded[0];
        const shouldConvert =
            options.useObjectConversion ||
            (value instanceof ethers.Result &&
                Object.getPrototypeOf(value) === ethers.Result.prototype);

        if (shouldConvert) {
            return Codec.ethersResultToObjectRecursive(value) as T;
        }

        return value as T;
    }

    public static convertEthersResultToObject<T>(result: ethers.Result): T {
        return this.ethersResultToObjectRecursive(result) as T;
    }
}
