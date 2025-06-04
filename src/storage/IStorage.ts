import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";
import { BigNumberish } from "ethers";

/**
 * Interface for storage module that provides access to blockchain data
 */

// NOTE - this interface is not complete, it is only what i needed at the moment. view it as a starting point (Luke, 03.06.2025)
export interface IStorage {
    getLatestJoinChannelBlockHash(): string;

    getLatestExitChannelBlockHash(): string;

    getTotalDeposits(): { amount: BigNumberish; data: string };

    getTotalWithdrawals(): { amount: BigNumberish; data: string };

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined;

    setLatestOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void;
}
