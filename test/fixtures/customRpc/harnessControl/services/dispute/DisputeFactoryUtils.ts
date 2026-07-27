import { ethers } from "ethers";
import type {
    BlockStruct,
    TransactionHeaderStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export const randomHash = (): `0x${string}` =>
    ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;

/** Copy of `blockStruct` with `transaction.header` shallow-merged with `header`. */
export function blockStructWithTransactionHeader(
    block: BlockStruct,
    header: Partial<TransactionHeaderStruct>
): BlockStruct {
    return {
        transaction: {
            header: { ...block.transaction.header, ...header },
            body: { ...block.transaction.body }
        },
        stateSnapshotHash: block.stateSnapshotHash,
        previousBlockHash: block.previousBlockHash,
        messageBlocks: [...block.messageBlocks]
    };
}
