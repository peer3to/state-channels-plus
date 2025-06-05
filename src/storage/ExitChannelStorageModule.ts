import { BigNumberish, BytesLike, hexlify, toBeHex } from "ethers";
import {
    ExitChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { IExitChannelStorageModule } from "./interfaces/IExitChannelStorageModule";

export class ExitChannelStorageModule implements IExitChannelStorageModule {
    //map [blockHash] => ExitChannelBlockStruct
    private exitChannelBlockMap: Map<string, ExitChannelBlockStruct>;
    //TODO: check if BytesLike is more efficient than string
    // we can either store the hash or the key to the exitChannelBlockHashesMap data
    private latestExitChannelBlockHash: BytesLike;

    private totalWithdrawals: BalanceStruct;

    constructor() {
        this.exitChannelBlockMap = new Map();
        this.latestExitChannelBlockHash = "0x00";
        this.totalWithdrawals = {
            amount: BigInt(0),
            data: "0x"
        };
    }

    /**
     * Store the block hash for an exit channel block
     */
    storeExitChannelBlockHash(
        blockHash: string,
        exitChannelBlock: ExitChannelBlockStruct
    ) {
        this.exitChannelBlockMap.set(blockHash, exitChannelBlock);
        this.latestExitChannelBlockHash = blockHash;

        // Update total withdrawals
        if (exitChannelBlock && exitChannelBlock.exitChannels.length > 0) {
            this.addToTotalWithdrawals(
                exitChannelBlock.exitChannels[0].balance
            );
        }
    }

    /**
     * Retrieve the block hash for an exit channel block
     */
    getExitChannelBlock(blockHash: string): ExitChannelBlockStruct | undefined {
        return this.exitChannelBlockMap.get(blockHash);
    }

    getLatestExitChannelBlockHash(): string {
        return hexlify(this.latestExitChannelBlockHash);
    }

    /**
     * Get the total withdrawals
     */
    getTotalWithdrawals(): { amount: BigNumberish; data: string } {
        return {
            amount: this.totalWithdrawals.amount,
            data: hexlify(this.totalWithdrawals.data)
        };
    }

    /**
     * Add to the total withdrawals
     * Doesnt handle data yet, just the amount
     */
    private addToTotalWithdrawals(balance: BalanceStruct) {
        this.totalWithdrawals.amount += toBeHex(balance.amount);
        console.log(`Total withdrawals updated: ${this.totalWithdrawals}`);
    }
}
