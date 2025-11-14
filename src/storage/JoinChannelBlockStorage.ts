import { ethers } from "ethers";
import {
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

interface JoinChannelBlockEntry {
    block: JoinChannelBlockStruct;
    totalDeposits?: BalanceStruct;
}

type StoreOptions = {
    hash?: Hash;
};

export class JoinChannelBlockStorage {
    private blockMap: Map<Hash, JoinChannelBlockEntry>;

    constructor() {
        this.blockMap = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeJoinChannelBlock(
        block: JoinChannelBlockStruct,
        totalDeposits?: BalanceStruct,
        options?: StoreOptions
    ): Hash {
        const hash =
            options?.hash ??
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
    // [fromBlockHash, toBlockHash) - iterate backwards the blockchain
    *getIterator(
        fromBlockHash: Hash,
        toBlockHash?: Hash
    ): Generator<JoinChannelBlockEntry, void, unknown> {
        if (fromBlockHash == ethers.ZeroHash) return;
        let currentHash = fromBlockHash;
        while (currentHash != ethers.ZeroHash) {
            if (toBlockHash && currentHash === toBlockHash) break;
            const entry = this.getJoinChannelBlockEntry(currentHash);
            if (!entry)
                throw new Error(
                    `Block hash ${currentHash} not found in storage`
                );
            yield entry;
            currentHash = entry.block.previousBlockHash;
        }
    }
    /**
     * Get all join channel blocks in the range [fromBlockHash, toBlockHash)
     * @param fromBlockHash - Iterate the blockchain backwards from this block (including this block)
     * @param toBlockHash - Stop iterating at this block (excluding this block)
     * @returns An array of join channel blocks in ascending order [Block N, Block N+1 ...]
     */
    getBlocksInRange(
        fromBlockHash: Hash,
        toBlockHash: Hash
    ): JoinChannelBlockStruct[] {
        const blocks: JoinChannelBlockStruct[] = [];
        for (const entry of this.getIterator(fromBlockHash, toBlockHash)) {
            blocks.unshift(entry.block);
        }
        return blocks;
    }
}
