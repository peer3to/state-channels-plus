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
        totalDeposits: BalanceStruct,
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

    *getIterator(
        fromBlockHash: Hash,
        toBlockHash?: Hash
    ): Generator<JoinChannelBlockEntry, void, unknown> {
        if (fromBlockHash == ethers.ZeroHash) return;
        let currentHash = fromBlockHash;
        while (
            currentHash != ethers.ZeroHash &&
            (!toBlockHash || currentHash != toBlockHash)
        ) {
            const entry = this.blockMap.get(currentHash);
            if (!entry) return;
            yield entry;
            currentHash = entry.block.previousBlockHash;
        }
    }

    getBlocksInRange(
        fromBlockHash: Hash,
        toBlockHash: Hash
    ): JoinChannelBlockStruct[] {
        const blocks: JoinChannelBlockStruct[] = [];
        for (const entry of this.getIterator(fromBlockHash, toBlockHash)) {
            blocks.push(entry.block);
        }
        return blocks;
    }
}
