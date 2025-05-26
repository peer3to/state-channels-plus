import { BytesLike, ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    ExitChannelBlockStruct,
    ExitChannelStruct,
    TransactionStruct,
    JoinChannelBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import {
    BlockEthersType,
    DisputeEthersType,
    JoinChannelEthersType,
    JoinChannelBlockEthersType,
    TransactionEthersType,
    ExitChannelEthersType,
    ExitChannelBlockEthersType
} from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";

type StructType =
    | BlockStruct
    | JoinChannelBlockStruct
    | JoinChannelStruct
    | TransactionStruct
    | DisputeStruct
    | ExitChannelBlockStruct
    | ExitChannelStruct;

export type StructTypeName =
    | "Block"
    | "JoinChannel"
    | "Transaction"
    | "Dispute";

export class Codec {
    private static readonly structToEthersType = new Map<string, any>([
        ["BlockStruct", BlockEthersType],
        ["JoinChannelStruct", JoinChannelEthersType],
        ["JoinChannelBlockStruct", JoinChannelBlockEthersType],
        ["TransactionStruct", TransactionEthersType],
        ["DisputeStruct", DisputeEthersType],
        ["ExitChannelStruct", ExitChannelEthersType],
        ["ExitChannelBlockStruct", ExitChannelBlockEthersType],

        // for convenience when decoding
        ["Block", BlockEthersType],
        ["JoinChannel", JoinChannelEthersType],
        ["JoinChannelBlock", JoinChannelEthersType],
        ["Transaction", TransactionEthersType],
        ["Dispute", DisputeEthersType],
        ["ExitChannel", ExitChannelEthersType],
        ["ExitChannelBlock", ExitChannelBlockEthersType]
    ]);

    public static encode(struct: StructType): string {
        let ethersType: string | undefined;

        const structName = struct.constructor.name;
        ethersType = this.structToEthersType.get(structName);

        if (!ethersType) {
            const availableFields = Object.keys(struct || {}).join(", ");
            const structName = struct.constructor.name;
            throw new Error(
                `Cannot encode struct with constructor name "${structName}". Available fields: [${availableFields}]. Consider using explicit type: Codec.encode(struct, "JoinChannel")`
            );
        }

        return ethers.AbiCoder.defaultAbiCoder().encode([ethersType], [struct]);
    }

    public static encodeWithExplicitType(
        struct: StructType,
        explicitType: StructTypeName
    ): string {
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

    // for types
    public static decodeBlock(encoded: BytesLike): BlockStruct {
        return this.decode(encoded, "Block");
    }
    public static decodeJoinChannel(encoded: BytesLike): JoinChannelStruct {
        return this.decode(encoded, "JoinChannel");
    }
    public static decodeJoinChannelBlock(
        encoded: BytesLike
    ): JoinChannelBlockStruct {
        return this.decode(encoded, "JoinChannelBlock");
    }
    public static decodeTransaction(encoded: BytesLike): TransactionStruct {
        return this.decode(encoded, "Transaction");
    }
    public static decodeDispute(encoded: BytesLike): DisputeStruct {
        return this.decode(encoded, "Dispute");
    }
    public static decodeExitChannelBlock(
        encoded: BytesLike
    ): ExitChannelBlockStruct {
        return this.decode(encoded, "ExitChannelBlock");
    }
}
