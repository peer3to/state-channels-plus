import { BigNumberish } from "ethers";
import { ExitChannelBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

export interface IExitChannelStorageModule {
    storeExitChannelBlockHash(
        blockHash: string,
        exitChannelBlock: ExitChannelBlockStruct
    ): void;
    getExitChannelBlock(blockHash: string): ExitChannelBlockStruct | undefined;
    getLatestExitChannelBlockHash(): string;
    getTotalWithdrawals(): { amount: BigNumberish; data: string };
}
