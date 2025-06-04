import { BigNumberish } from "ethers";

/**
 * Interface for storage module that provides access to blockchain data

 */

// NOTE - this interface is not complete, it is only what i needed at the moment. view it as a starting point (Luke, 03.06.2025)
export interface IStorageModule {
    getLatestJoinChannelBlockHash(): string;

    getLatestExitChannelBlockHash(): string;

    getTotalDeposits(): { amount: BigNumberish; data: string };

    getTotalWithdrawals(): { amount: BigNumberish; data: string };

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined;

    storeJoinChannelBlockHash(
        forkCnt: number,
        blockHeight: number,
        blockHash: string
    ): void;
}
