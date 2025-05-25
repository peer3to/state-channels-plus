import { BytesLike, ethers } from "ethers";
import {
    BlockStruct,
    JoinChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/DataTypes";
import {
    BlockEthersType,
    DisputeEthersType,
    JoinChannelEthersType,
    TransactionEthersType
} from "@/types";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";

type StructType =
    | BlockStruct
    | JoinChannelStruct
    | TransactionStruct
    | DisputeStruct;

export type StructTypeName =
    | "Block"
    | "JoinChannel"
    | "Transaction"
    | "Dispute";

export class Codec {
    private static readonly structToEthersType = new Map<string, any>([
        ["BlockStruct", BlockEthersType],
        ["JoinChannelStruct", JoinChannelEthersType],
        ["TransactionStruct", TransactionEthersType],
        ["DisputeStruct", DisputeEthersType],

        // for convenience when decoding
        ["Block", BlockEthersType],
        ["JoinChannel", JoinChannelEthersType],
        ["Transaction", TransactionEthersType],
        ["Dispute", DisputeEthersType]
    ]);

    public static encode(
        struct: StructType,
        explicitType?: StructTypeName
    ): string {
        let ethersType: string | undefined;

        // If explicit type is provided, use it directly
        if (explicitType) {
            ethersType = this.structToEthersType.get(explicitType);
        } else {
            // Try constructor name first
            const structName = struct.constructor.name;
            ethersType = this.structToEthersType.get(structName);

            // Simple fallback for plain objects - try common types
            if (!ethersType && structName === "Object") {
                // Try JoinChannel first (most common)
                if (
                    "channelId" in struct &&
                    "participant" in struct &&
                    "balance" in struct
                ) {
                    ethersType = JoinChannelEthersType;
                }
                // Try Block
                else if ("transaction" in struct && "stateHash" in struct) {
                    ethersType = BlockEthersType;
                }
                // Try Transaction
                else if ("header" in struct && "body" in struct) {
                    ethersType = TransactionEthersType;
                }
                // Try Dispute
                else if ("disputeIndex" in struct && "channelId" in struct) {
                    ethersType = DisputeEthersType;
                }
            }
        }

        if (!ethersType) {
            const availableFields = Object.keys(struct || {}).join(", ");
            const structName = struct.constructor.name;
            throw new Error(
                `Cannot encode struct with constructor name "${structName}". Available fields: [${availableFields}]. Consider using explicit type: Codec.encode(struct, "JoinChannel")`
            );
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
    public static decodeTransaction(encoded: BytesLike): TransactionStruct {
        return this.decode(encoded, "Transaction");
    }
    public static decodeDispute(encoded: BytesLike): DisputeStruct {
        return this.decode(encoded, "Dispute");
    }
}
