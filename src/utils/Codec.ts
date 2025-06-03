import { BytesLike, ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    TransactionStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/DataTypes";
import {
    BlockEthersType,
    DisputeEthersType,
    JoinChannelEthersType,
    TransactionEthersType,
    StateSnapshotEthersType
} from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";

type StructType =
    | BlockStruct
    | JoinChannelStruct
    | TransactionStruct
    | DisputeStruct
    | StateSnapshotStruct;

// Enum for better autocomplete and type safety
export enum Type {
    Block = "Block",
    JoinChannel = "JoinChannel",
    Transaction = "Transaction",
    Dispute = "Dispute",
    StateSnapshot = "StateSnapshot"
}

export class Codec {
    private static readonly structToEthersType = new Map<string, any>([
        [Type.Block, BlockEthersType],
        [Type.JoinChannel, JoinChannelEthersType],
        [Type.Transaction, TransactionEthersType],
        [Type.Dispute, DisputeEthersType],
        [Type.StateSnapshot, StateSnapshotEthersType]
    ]);

    // Only support explicit type encoding for better reliability
    public static encode(struct: any, explicitType: Type): string {
        const ethersType = this.structToEthersType.get(explicitType);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${explicitType}`);
        }
        return ethers.AbiCoder.defaultAbiCoder().encode([ethersType], [struct]);
    }

    public static decode<T extends StructType>(
        encoded: BytesLike,
        structName: string
    ): T {
        const ethersType = this.structToEthersType.get(structName);
        if (!ethersType) {
            throw new Error(`No ethers type mapping found for ${structName}`);
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

    // Convenience methods with explicit types
    public static decodeBlock(encoded: BytesLike): BlockStruct {
        return this.decode(encoded, Type.Block);
    }
    public static decodeJoinChannel(encoded: BytesLike): JoinChannelStruct {
        return this.decode(encoded, Type.JoinChannel);
    }
    public static decodeTransaction(encoded: BytesLike): TransactionStruct {
        return this.decode(encoded, Type.Transaction);
    }
    public static decodeDispute(encoded: BytesLike): DisputeStruct {
        return this.decode(encoded, Type.Dispute);
    }
    public static decodeStateSnapshot(encoded: BytesLike): StateSnapshotStruct {
        return this.decode(encoded, Type.StateSnapshot);
    }
}
