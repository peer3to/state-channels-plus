import { ForkId } from "@/types/types";
import { BigNumberish } from "ethers";
import {
    StateSnapshotStruct,
    ExitChannelBlockStruct,
    JoinChannelBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";

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
        forkId: ForkId,
        transactionCnt: number
    ): string | undefined;

    storeJoinChannelBlockHash(
        blockHash: string,
        joinChannelBlock: JoinChannelBlockStruct
    ): void;

    storeExitChannelBlockHash(
        blockHash: string,
        exitChannelBlock: ExitChannelBlockStruct
    ): void;

    storeStateSnapshot(
        blockHeight: number,
        snapshot: StateSnapshotStruct
    ): void;
}
