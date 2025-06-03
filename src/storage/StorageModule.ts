import { BigNumberish, ethers } from "ethers";
import { IStorageModule } from "./IStorageModule";

export class StorageModule implements IStorageModule {
    getLatestJoinChannelBlockHash(): string {
        // TODO
        return ethers.ZeroHash;
    }

    getLatestExitChannelBlockHash(): string {
        // TODO
        return ethers.ZeroHash;
    }

    getTotalDeposits(): { amount: BigNumberish; data: string } {
        // TODO
        return { amount: 0, data: "0x" };
    }

    getTotalWithdrawals(): { amount: BigNumberish; data: string } {
        // TODO
        return { amount: 0, data: "0x" };
    }

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        // TODO
        return ethers.ZeroHash;
    }
}
