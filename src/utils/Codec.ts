import { ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    SignedJoinChannelStruct,
    JoinChannelConfirmationStruct,
    OpenChannelStruct,
    TransactionStruct,
    StateSnapshotStruct,
    ExitChannelBlockStruct,
    BlockConfirmationStruct,
    ExitChannelStruct,
    JoinChannelBlockStruct,
    SnapshotDataStruct,
    SignedBlockStruct,
    MessageBlockStruct,
    BalanceStruct
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
    DisputeConfirmationEthersType,
    JoinChannelEthersType,
    SignedJoinChannelEthersType,
    JoinChannelConfirmationEthersType,
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
    DisputeInvalidStateProofProofEthersType,
    DisputeInvalidBalanceInvariantProofEthersType,
    DisputeOnChainSlashesNotSubsetProofEthersType,
    DisputeLastMilestoneNotFinalAndNoAuditingDataProofEthersType,
    DisputeStateProofHeaderMismatchProofEthersType,
    DisputeInboundHashNotInChainProofEthersType,
    InvalidDisputeReasonProofEthersType,
    TimeoutThresholdProofEthersType,
    TimeoutCalldataPostedProofEthersType,
    TimeoutNotLinkedToLatestStateProofEthersType,
    TimeoutParticipantNotNextProofEthersType,
    TimeoutTooEarlyProofEthersType,
    DisputeInvalidBlockInStateProofApplyFraudProofEthersType,
    DisputeBlockAuthorNotParticipantProofEthersType,
    DisputeInvalidBlockStructureProofEthersType,
    MessageBlockEthersType,
    BalanceEthersType,
    SignedBlockEthersType,
    StateProofEthersType
} from "@/types";
import {
    DisputeStruct,
    DisputeConfirmationStruct,
    DisputeAuditingDataStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Bytes, Timestamp } from "@/types/types";
import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import { SyncPayloadEthersType } from "@/types";
import type { SyncPayload } from "@/types";
import type { ContractExecutionResult } from "@/evm/contractExecutor";
import {
    DisputeInvalidBalanceInvariantStruct,
    DisputeOnChainSlashesNotSubsetStruct,
    DisputeInvalidBlockInStateProofApplyFraudProofStruct,
    DisputeInvalidOutputStateStruct,
    DisputeInvalidStateProofStruct,
    DisputeNotLatestStateStruct,
    TimeoutCalldataPostedStruct,
    TimeoutNotLinkedToLatestStateStruct,
    TimeoutParticipantNotNextStruct,
    TimeoutThresholdStruct,
    TimeoutTooEarlyStruct,
    DisputeLastMilestoneNotFinalAndNoAuditingDataStruct,
    InvalidDisputeReasonStruct,
    DisputeStateProofHeaderMismatchStruct,
    DisputeInvalidBlockStructureStruct,
    DisputeBlockAuthorNotParticipantStruct
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
    | DisputeInvalidStateProofStruct
    | DisputeInvalidBalanceInvariantStruct
    | DisputeOnChainSlashesNotSubsetStruct
    | TimeoutThresholdStruct
    | TimeoutCalldataPostedStruct
    | TimeoutNotLinkedToLatestStateStruct
    | TimeoutParticipantNotNextStruct
    | TimeoutTooEarlyStruct
    | DisputeInvalidBlockInStateProofApplyFraudProofStruct
    | DisputeLastMilestoneNotFinalAndNoAuditingDataStruct
    | InvalidDisputeReasonStruct
    | DisputeStateProofHeaderMismatchStruct
    | DisputeInvalidBlockStructureStruct
    | DisputeBlockAuthorNotParticipantStruct;

type StructType =
    | FraudStruct
    | DisputeFraudStruct
    | BlockStruct
    | { signedBlock: SignedBlockStruct; timestamp: Timestamp }
    | BlockConfirmationStruct
    | JoinChannelStruct
    | SignedJoinChannelStruct
    | JoinChannelConfirmationStruct
    | OpenChannelStruct
    | TransactionStruct
    | DisputeStruct
    | DisputeConfirmationStruct
    | StateSnapshotStruct
    | SnapshotDataStruct
    | JoinChannelBlockStruct
    | ExitChannelBlockStruct
    | ExitChannelStruct
    | DisputeAuditingDataStruct
    | MessageBlockStruct
    | BalanceStruct
    | SignedBlockStruct
    | StateProofStruct
    | SyncPayload;

// Enum for better autocomplete and type safety
export enum Type {
    Block,
    BlockCommitment,
    JoinChannel,
    SignedJoinChannel,
    JoinChannelConfirmation,
    OpenChannel,
    BlockConfirmation,
    Transaction,
    Dispute,
    DisputeConfirmation,
    StateSnapshot,
    SnapshotData,
    JoinChannelBlock,
    ExitChannelBlock,
    ExitChannel,
    DisputeAuditingData,
    MessageBlock,
    Balance,
    SignedBlock,
    StateProof,
    SyncPayload
}

export class Codec {
    private static readonly abiCoder = ethers.AbiCoder.defaultAbiCoder();

    private static readonly structToEthersType = new Map<
        Type | FraudProofType | DisputeFraudProofType,
        string
    >([
        [Type.Block, BlockEthersType],
        [Type.BlockCommitment, BlockCommitmentEthersType],
        [Type.JoinChannel, JoinChannelEthersType],
        [Type.SignedJoinChannel, SignedJoinChannelEthersType],
        [Type.JoinChannelConfirmation, JoinChannelConfirmationEthersType],
        [Type.OpenChannel, OpenChannelEthersType],
        [Type.BlockConfirmation, BlockConfirmationEthersType],
        [Type.Transaction, TransactionEthersType],
        [Type.Dispute, DisputeEthersType],
        [Type.DisputeConfirmation, DisputeConfirmationEthersType],
        [Type.StateSnapshot, StateSnapshotEthersType],
        [Type.SnapshotData, SnapshotDataEthersType],
        [Type.JoinChannelBlock, JoinChannelBlockEthersType],
        [Type.ExitChannelBlock, ExitChannelBlockEthersType],
        [Type.ExitChannel, ExitChannelEthersType],
        [Type.DisputeAuditingData, DisputeAuditingDataEthersType],
        [Type.MessageBlock, MessageBlockEthersType],
        [Type.Balance, BalanceEthersType],
        [Type.SignedBlock, SignedBlockEthersType],
        [Type.StateProof, StateProofEthersType],
        [Type.SyncPayload, SyncPayloadEthersType],
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
            DisputeFraudProofType.DisputeInvalidStateProof,
            DisputeInvalidStateProofProofEthersType
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
        ],
        [
            DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
            DisputeLastMilestoneNotFinalAndNoAuditingDataProofEthersType
        ],
        [
            DisputeFraudProofType.InvalidDisputeReason,
            InvalidDisputeReasonProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeStateProofHeaderMismatch,
            DisputeStateProofHeaderMismatchProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeInboundHashNotInChain,
            DisputeInboundHashNotInChainProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeInvalidBlockStructure,
            DisputeInvalidBlockStructureProofEthersType
        ],
        [
            DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
            DisputeBlockAuthorNotParticipantProofEthersType
        ]
    ]);

    private static readonly abiTypesCache = new Map<
        Type | FraudProofType | DisputeFraudProofType,
        readonly [ethers.ParamType]
    >();

    private static readonly evmAbiTypesCache = new Map<
        string,
        readonly [ethers.ParamType]
    >();

    private static getAbiTypes(
        type: Type | FraudProofType | DisputeFraudProofType
    ): readonly [ethers.ParamType] {
        let abiTypes = this.abiTypesCache.get(type);
        if (!abiTypes) {
            const ethersType = this.structToEthersType.get(type);
            if (!ethersType) {
                throw new Error(`No ethers type mapping found for ${type}`);
            }
            abiTypes = [ethers.ParamType.from(ethersType)];
            this.abiTypesCache.set(type, abiTypes);
        }
        return abiTypes;
    }

    private static getEvmAbiTypes(
        ethersType: string
    ): readonly [ethers.ParamType] {
        let abiTypes = this.evmAbiTypesCache.get(ethersType);
        if (!abiTypes) {
            abiTypes = [ethers.ParamType.from(ethersType)];
            this.evmAbiTypesCache.set(ethersType, abiTypes);
        }
        return abiTypes;
    }

    public static encode(
        struct: StructType,
        type: Type | FraudProofType | DisputeFraudProofType
    ): Bytes {
        try {
            return this.abiCoder.encode(this.getAbiTypes(type), [struct]);
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
        type: Type.SignedJoinChannel
    ): SignedJoinChannelStruct;
    public static decode(
        encoded: Bytes,
        type: Type.JoinChannelConfirmation
    ): JoinChannelConfirmationStruct;
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
        type: Type.DisputeConfirmation
    ): DisputeConfirmationStruct;
    public static decode(
        encoded: Bytes,
        type: Type.DisputeAuditingData
    ): DisputeAuditingDataStruct;
    public static decode(
        encoded: Bytes,
        type: Type.StateSnapshot
    ): StateSnapshotStruct;
    public static decode(
        encoded: Bytes,
        type: Type.SnapshotData
    ): SnapshotDataStruct;
    public static decode(encoded: Bytes, type: Type.SyncPayload): SyncPayload;
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
    public static decode(encoded: Bytes, type: Type.Balance): BalanceStruct;
    public static decode(
        encoded: Bytes,
        type: Type.BlockConfirmation
    ): BlockConfirmationStruct;
    public static decode(
        encoded: Bytes,
        type: Type.SignedBlock
    ): SignedBlockStruct;
    public static decode(
        encoded: Bytes,
        type: Type.StateProof
    ): StateProofStruct;
    public static decode(
        encoded: Bytes,
        type: DisputeFraudProofType.DisputeInvalidBlockStructure
    ): DisputeInvalidBlockStructureStruct;
    public static decode(
        encoded: Bytes,
        type: DisputeFraudProofType.DisputeBlockAuthorNotParticipant
    ): DisputeBlockAuthorNotParticipantStruct;

    public static decode<T extends StructType>(
        encoded: Bytes,
        type: Type | FraudProofType | DisputeFraudProofType
    ): T {
        const decoded = this.abiCoder.decode(this.getAbiTypes(type), encoded);
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
        } catch {
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
        execResult: ContractExecutionResult,
        ethersType: string,
        options: {
            useObjectConversion: boolean;
        } = {
            useObjectConversion: false
        }
    ): T {
        const decoded = this.abiCoder.decode(
            this.getEvmAbiTypes(ethersType),
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
