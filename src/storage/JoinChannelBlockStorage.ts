import { ethers } from "ethers";
import {
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

interface JoinChannelBlockEntry {
    block: JoinChannelBlockStruct;
    totalDeposits: BalanceStruct;
}

export class JoinChannelBlockStorage {
    private blockMap: Map<Hash, JoinChannelBlockEntry>;

    constructor() {
        this.blockMap = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    // Join Channel Block

    /** [OVERLOAD 1] Store join channel block with auto-computed hash */
    storeJoinChannelBlock(
        block: JoinChannelBlockStruct,
        totalDeposits: BalanceStruct
    ): Hash;

    /** [OVERLOAD 2] Store join channel block with provided hash */
    storeJoinChannelBlock(
        block: JoinChannelBlockStruct,
        totalDeposits: BalanceStruct,
        blockHash: Hash
    ): Hash;

    storeJoinChannelBlock(
        block: JoinChannelBlockStruct,
        totalDeposits: BalanceStruct,
        blockHash?: Hash
    ): Hash {
        const hash =
            blockHash ??
            ethers.keccak256(Codec.encode(block, Type.JoinChannelBlock));

        // Check for duplicates
        if (this.blockMap.has(hash)) {
            return hash;
        }

        this.blockMap.set(hash, {
            block,
            totalDeposits
        });
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    getJoinChannelBlock(blockHash: Hash): JoinChannelBlockStruct | undefined {
        const entry = this.blockMap.get(blockHash);
        return entry?.block;
    }

    getTotalDeposits(blockHash: Hash): BalanceStruct | undefined {
        const entry = this.blockMap.get(blockHash);
        return entry?.totalDeposits;
    }

    getJoinChannelBlockEntry(
        blockHash: Hash
    ): JoinChannelBlockEntry | undefined {
        return this.blockMap.get(blockHash);
    }
}
