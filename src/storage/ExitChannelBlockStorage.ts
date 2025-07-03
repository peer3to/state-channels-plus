import { ethers } from "ethers";
import {
    ExitChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

export class ExitChannelBlockStorage {
    private blockMap: Map<Hash, ExitChannelBlockStruct>;
    private _latestBlockHash: Hash;
    private _totalWithdrawals: BalanceStruct;

    constructor() {
        this.blockMap = new Map();
        this._latestBlockHash = ethers.ZeroHash;
        this._totalWithdrawals = {
            amount: BigInt(0),
            data: "0x"
        };
    }

    // ====================================
    // CREATE
    // ====================================

    // Exit Channel Block

    /** [OVERLOAD 1] Store exit channel block with auto-computed hash */
    storeExitChannelBlock(block: ExitChannelBlockStruct): Hash;

    /** [OVERLOAD 2] Store exit channel block with provided hash */
    storeExitChannelBlock(block: ExitChannelBlockStruct, blockHash: Hash): Hash;

    storeExitChannelBlock(
        block: ExitChannelBlockStruct,
        blockHash?: Hash
    ): Hash {
        const hash =
            blockHash ??
            ethers.keccak256(Codec.encode(block, Type.ExitChannelBlock));

        // Check for duplicates
        if (this.blockMap.has(hash)) {
            throw new Error(
                `Exit channel block with hash ${hash} already exists`
            );
        }

        this.blockMap.set(hash, block);
        this._latestBlockHash = hash;
        return hash;
    }

    // ====================================

    // Total Withdrawals

    setTotalWithdrawals(value: BalanceStruct) {
        this._totalWithdrawals = value;
    }

    // ====================================
    // READ
    // ====================================

    getExitChannelBlock(blockHash: Hash): ExitChannelBlockStruct | undefined {
        return this.blockMap.get(blockHash);
    }

    getLatestExitChannelBlockHash(): Hash {
        return this._latestBlockHash;
    }

    getLatestExitChannelBlock(): ExitChannelBlockStruct | undefined {
        return this.blockMap.get(this._latestBlockHash);
    }

    getTotalWithdrawals(): BalanceStruct {
        return this._totalWithdrawals;
    }
}
