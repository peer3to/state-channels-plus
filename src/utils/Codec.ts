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
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct,
    WrongGenesisProofStruct
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
    DisputeAuditingDataEthersType
} from "@/types";
import {
    DisputeStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Bytes, Timestamp } from "@/types/types";
import { FraudProofType } from "@/types/sol-enums";
import { ExecResult } from "@ethereumjs/evm";

export type FraudStruct =
    | BlockDoubleSignProofStruct
    | BlockInvalidStateTransitionProofStruct
    | InvalidTimestampProofStruct
    | WrongGenesisProofStruct;

type StructType =
    | FraudStruct
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
    | DisputeAuditingDataStruct;

// Enum for better autocomplete and type safety
export enum Type {
    Block = "Block",
    BlockCommitment = "BlockCommitment",
    JoinChannel = "JoinChannel",
    OpenChannel = "OpenChannel",
    BlockConfirmation = "BlockConfirmation",
    Transaction = "Transaction",
    Dispute = "Dispute",
    StateSnapshot = "StateSnapshot",
    SnapshotData = "SnapshotData",
    JoinChannelBlock = "JoinChannelBlock",
    ExitChannelBlock = "ExitChannelBlock",
    ExitChannel = "ExitChannel",
    DisputeAuditingData = "DisputeAuditingData"
}

export class Codec {
    private static readonly structToEthersType = new Map<
        Type | FraudProofType,
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
        [FraudProofType.BlockDoubleSign, BlockDoubleSignProofEthersType],
        [
            FraudProofType.BlockInvalidStateTransition,
            BlockInvalidStateTransitionProofEthersType
        ],
        [FraudProofType.InvalidTimestamp, InvalidTimestampProofEthersType],
        [FraudProofType.WrongGenesis, WrongGenesisProofEthersType]
    ]);

    public static encode(
        struct: StructType,
        type: Type | FraudProofType
    ): Bytes {
        const ethersType = this.structToEthersType.get(type);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${type}`);
        }
        return ethers.AbiCoder.defaultAbiCoder().encode([ethersType], [struct]);
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

    public static decode<T extends StructType>(encoded: Bytes, type: Type): T {
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

        if (options.useObjectConversion) {
            return Codec.ethersResultToObjectRecursive(decoded[0]) as T;
        }

        return decoded[0] as T;
    }

    public static convertEthersResultToObject<T>(result: ethers.Result): T {
        return this.ethersResultToObjectRecursive(result) as T;
    }
}
