import { BytesLike, ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    TransactionStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockEthersType,
    DisputeEthersType,
    JoinChannelEthersType,
    TransactionEthersType,
    StateSnapshotEthersType
} from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

type StructType =
    | BlockStruct
    | JoinChannelStruct
    | TransactionStruct
    | DisputeStruct
    | StateSnapshotStruct;

// Enum for better autocomplete and type safety
export enum Type {
    Block,
    JoinChannel,
    Transaction,
    Dispute,
    StateSnapshot
}

export class Codec {
    private static readonly structToEthersType = new Map<Type, string>([
        [Type.Block, BlockEthersType],
        [Type.JoinChannel, JoinChannelEthersType],
        [Type.Transaction, TransactionEthersType],
        [Type.Dispute, DisputeEthersType],
        [Type.StateSnapshot, StateSnapshotEthersType]
    ]);

    public static encode(struct: StructType, type: Type): string {
        const ethersType = this.structToEthersType.get(type);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${type}`);
        }
        return ethers.AbiCoder.defaultAbiCoder().encode([ethersType], [struct]);
    }

    // Function overloads for type safety
    public static decode(encoded: BytesLike, type: Type.Block): BlockStruct;
    public static decode(
        encoded: BytesLike,
        type: Type.JoinChannel
    ): JoinChannelStruct;
    public static decode(
        encoded: BytesLike,
        type: Type.Transaction
    ): TransactionStruct;
    public static decode(encoded: BytesLike, type: Type.Dispute): DisputeStruct;
    public static decode(
        encoded: BytesLike,
        type: Type.StateSnapshot
    ): StateSnapshotStruct;

    public static decode<T extends StructType>(
        encoded: BytesLike,
        type: Type
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
            for (let key in obj) {
                if (key == "_") obj = result.toArray();
                cnt++;
            }
            if (cnt == 0) obj = result.toArray();
        } catch (e) {
            obj = result.toArray();
        }
        for (let key in obj) {
            if (
                obj[key] instanceof ethers.Result &&
                Object.getPrototypeOf(obj[key]) === ethers.Result.prototype
            ) {
                obj[key] = this.ethersResultToObjectRecursive(obj[key]);
            }
        }
        return obj;
    }
}
