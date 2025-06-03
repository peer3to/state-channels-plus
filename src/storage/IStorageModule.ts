import { BigNumberish } from "ethers";

/**
 * Interface for storage module that provides access to blockchain data
 * This should be implemented to access your actual storage backend
 */
export interface IStorageModule {
    /**
     * Gets the hash of the latest block in the JoinChannel blockchain
     * @returns The latest join channel block hash
     */
    getLatestJoinChannelBlockHash(): string;

    /**
     * Gets the hash of the latest block in the ExitChannel blockchain
     * @returns The latest exit channel block hash
     */
    getLatestExitChannelBlockHash(): string;

    /**
     * Gets the aggregated total of all deposits
     * @returns Object with amount and data for total deposits
     */
    getTotalDeposits(): { amount: BigNumberish; data: string };

    /**
     * Gets the aggregated total of all withdrawals
     * @returns Object with amount and data for total withdrawals
     */
    getTotalWithdrawals(): { amount: BigNumberish; data: string };

    /**
     * Gets the hash of a previous block from storage
     * @param forkCnt The fork count
     * @param transactionCnt The transaction count
     * @returns The previous block hash, or undefined if not found
     */
    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined;
}
