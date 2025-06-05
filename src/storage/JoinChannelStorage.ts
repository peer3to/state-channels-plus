import { BigNumberish, BytesLike, hexlify, toBeHex } from "ethers";
import {
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { IJoinChannelStorageModule } from "./interfaces/IJoinChannelStorage";

export class JoinChannelStorageModule implements IJoinChannelStorageModule {
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

        // Update total deposits
        if (joinChannelBlock && joinChannelBlock.joinChannels.length > 0) {
            this.addToTotalDeposits(joinChannelBlock.joinChannels[0].balance);
        }
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
            data: hexlify(this.totalDeposits.data)
        };
    }

    /**
     * Add to the total deposits
     * Doesn't handle data yet, just the amount
     */
    private addToTotalDeposits(balance: BalanceStruct) {
        //TODO: create a method to add two balances together
        this.totalDeposits.amount += toBeHex(balance.amount);
        console.log(`Total deposits updated: ${this.totalDeposits}`);
    }
}
