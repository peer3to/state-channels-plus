import { ethers } from "ethers";
import {
    ExitChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

interface ExitChannelBlockEntry {
    block: ExitChannelBlockStruct;
    totalWithdrawals?: BalanceStruct;
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
        totalWithdrawals?: BalanceStruct,
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

    // [fromBlockHash, toBlockHash) - iterate backwards the blockchain
    *getIterator(
        fromBlockHash: Hash,
        toBlockHash?: Hash
    ): Generator<ExitChannelBlockEntry, void, unknown> {
        if (fromBlockHash == ethers.ZeroHash) return;
        let currentHash = fromBlockHash;
        while (currentHash != ethers.ZeroHash) {
            if (toBlockHash && currentHash === toBlockHash) break;
            const entry = this.blockMap.get(currentHash);
            if (!entry) return;
            yield entry;
            currentHash = entry.block.previousBlockHash;
        }
    }

    /**
     * Get all exit channel blocks in the range [fromBlockHash, toBlockHash)
     * @param fromBlockHash - Iterate the blockchain backwards from this block (including this block)
     * @param toBlockHash - Stop iterating at this block (excluding this block)
     * @returns An array of exit channel blocks in ascending order [Block N, Block N+1 ...]
     */
    getBlocksInRange(
        fromBlockHash: Hash,
        toBlockHash: Hash
    ): ExitChannelBlockStruct[] {
        const blocks: ExitChannelBlockStruct[] = [];
        for (const entry of this.getIterator(fromBlockHash, toBlockHash)) {
            blocks.unshift(entry.block);
        }
        return blocks;
    }
}
