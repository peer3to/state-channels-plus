import { ethers } from "ethers";
import {
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";

export class JoinChannelBlockStorage {
    private blockMap: Map<Hash, JoinChannelBlockStruct>;
    private _latestBlockHash: Hash;
    private _totalDeposits: BalanceStruct;

    constructor() {
        this.blockMap = new Map();
        this._latestBlockHash = ethers.ZeroHash;
        this._totalDeposits = {
            amount: BigInt(0),
            data: "0x"
        };
    }

    // ====================================
    // CREATE
    // ====================================

    // Join Channel Block

    /** [OVERLOAD 1] Store join channel block with auto-computed hash */
    storeJoinChannelBlock(block: JoinChannelBlockStruct): Hash;

    /** [OVERLOAD 2] Store join channel block with provided hash */
    storeJoinChannelBlock(block: JoinChannelBlockStruct, blockHash: Hash): Hash;

    storeJoinChannelBlock(
        block: JoinChannelBlockStruct,
        blockHash?: Hash
    ): Hash {
        const hash =
            blockHash ??
            ethers.keccak256(Codec.encode(block, Type.JoinChannelBlock));

        // Check for duplicates - throw if exists
        if (this.blockMap.has(hash)) {
            throw new Error(
                `Join channel block with hash ${hash} already exists`
            );
        }

        this.blockMap.set(hash, block);
        this._latestBlockHash = hash;
        return hash;
    }

    // ====================================

    // Total Deposits

    setTotalDeposits(value: BalanceStruct) {
        this._totalDeposits = value;
    }

    // ====================================
    // READ
    // ====================================

    getJoinChannelBlock(blockHash: Hash): JoinChannelBlockStruct | undefined {
        return this.blockMap.get(blockHash);
    }

    getLatestJoinChannelBlockHash(): Hash {
        return this._latestBlockHash;
    }

    getLatestJoinChannelBlock(): JoinChannelBlockStruct | undefined {
        return this.blockMap.get(this._latestBlockHash);
    }

    getTotalDeposits(): BalanceStruct {
        return this._totalDeposits;
    }
}
