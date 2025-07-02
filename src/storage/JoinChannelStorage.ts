import { BigNumberish, BytesLike, hexlify, toBeHex } from "ethers";
import {
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export class JoinChannelStorageModule {
    //map [blockHash] => JoinChannelBlockStruct
    private joinChannelBlockMap: Map<string, JoinChannelBlockStruct>;
    //TODO: check if BytesLike is more efficient than string
    // we can either store the hash or the key to the joinChannelBlockHashesMap data
    private latestJoinChannelBlockHash: BytesLike;

    private totalDeposits: BalanceStruct;

    constructor() {
        this.joinChannelBlockMap = new Map();
        this.latestJoinChannelBlockHash = "0x00";
        this.totalDeposits = {
            amount: BigInt(0),
            data: "0x"
        };
    }

    /**
     * Store the block hash for a join channel block
     */
    storeJoinChannelBlockHash(
        blockHash: string,
        joinChannelBlock: JoinChannelBlockStruct
    ) {
        this.joinChannelBlockMap.set(blockHash, joinChannelBlock);
        this.latestJoinChannelBlockHash = blockHash;
    }

    /**
     * Retrieve the block hash for a join channel block
     */
    getJoinChannelBlock(blockHash: string): JoinChannelBlockStruct | undefined {
        return this.joinChannelBlockMap.get(blockHash);
    }

    getLatestJoinChannelBlockHash(): string {
        return hexlify(this.latestJoinChannelBlockHash);
    }

    /**
     * Get the total deposits
     */
    getTotalDeposits(): { amount: BigNumberish; data: string } {
        return {
            amount: this.totalDeposits.amount,
            data: this.totalDeposits.data.toString()
        };
    }

    /**
     * Add to the total deposits
     * Doesnt handle data yet, just the amount
     */
    private addToTotalDeposits(balance: BalanceStruct) {
        this.totalDeposits.amount =
            BigInt(this.totalDeposits.amount) + BigInt(balance.amount);
    }
}
