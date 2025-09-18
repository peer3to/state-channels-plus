import { ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
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
    Type,
    TYPE_TO_ETHERS_TYPE_MAP,
    FraudProofType
} from "./generated-codec";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Bytes, Timestamp } from "@/types/types";
import { ExecResult } from "@ethereumjs/evm";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

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
    | TransactionStruct
    | DisputeStruct
    | StateSnapshotStruct
    | SnapshotDataStruct
    | JoinChannelBlockStruct
    | ExitChannelBlockStruct
    | ExitChannelStruct
    | DisputeAuditingDataStruct;

// Export the generated Type enum
export { Type } from "./generated-codec";

const CUSTOM_TYPE_MAPPINGS: Record<string, string> = {
    // Example custom mappings
    // "MyCustomType": "tuple(address,uint256)",
    // "MyStruct": "tuple(string,bool,uint256[])",
};

export class Codec {
    private static readonly structToEthersType = TYPE_TO_ETHERS_TYPE_MAP;

    private static getEthersType(type: Type | FraudProofType | string): string {
        if (typeof type === "string") {
            const customType = CUSTOM_TYPE_MAPPINGS[type];
            if (customType) {
                return customType;
            }
            throw new Error(
                `No ethers type mapping found for custom type ${type}`
            );
        }

        const ethersType = this.structToEthersType.get(type);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${type}`);
        }
        return ethersType;
    }

    public static encode(
        struct: StructType,
        type: Type | FraudProofType
    ): Bytes;
    public static encode(struct: any, type: string): Bytes;
    public static encode(
        struct: any,
        type: Type | FraudProofType | string
    ): Bytes {
        const ethersType = this.getEthersType(type);
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
        type: Type.ExitChannel
    ): ExitChannelStruct;
    public static decode(
        encoded: Bytes,
        type: Type.Transaction
    ): TransactionStruct;
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
    public static decode<T = any>(encoded: Bytes, type: string): T;

    public static decode<T extends StructType>(encoded: Bytes, type: Type): T;
    public static decode<T = any>(encoded: Bytes, type: Type | string): T {
        const ethersType = this.getEthersType(type as any);

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
}
