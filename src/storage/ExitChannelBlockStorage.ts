import { ethers } from "ethers";
import {
    ExitChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

interface ExitChannelBlockEntry {
    block: ExitChannelBlockStruct;
    totalWithdrawals: BalanceStruct;
}

type StoreOptions = {
    hash?: Hash;
};

export class ExitChannelBlockStorage {
    private blockMap: Map<Hash, ExitChannelBlockEntry>;

    constructor() {
        this.blockMap = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeExitChannelBlock(
        block: ExitChannelBlockStruct,
        totalWithdrawals: BalanceStruct,
        options?: StoreOptions
    ): Hash {
        const hash =
            options?.hash ??
            ethers.keccak256(Codec.encode(block, Type.ExitChannelBlock));

        // Check for duplicates
        if (this.blockMap.has(hash)) {
            return hash;
        }

        this.blockMap.set(hash, {
            block,
            totalWithdrawals
        });
        return hash;
    }

    // ====================================
    // READ
    // ====================================

    getExitChannelBlock(blockHash: Hash): ExitChannelBlockStruct | undefined {
        const entry = this.blockMap.get(blockHash);
        return entry?.block;
    }

    getTotalWithdrawals(blockHash: Hash): BalanceStruct | undefined {
        const entry = this.blockMap.get(blockHash);
        return entry?.totalWithdrawals;
    }

    getExitChannelBlockEntry(
        blockHash: Hash
    ): ExitChannelBlockEntry | undefined {
        return this.blockMap.get(blockHash);
    }
}
