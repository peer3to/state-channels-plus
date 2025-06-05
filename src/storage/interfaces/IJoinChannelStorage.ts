import { BigNumberish } from "ethers";
import { JoinChannelBlockStruct } from "@typechain-types/contracts/V1/DataTypes";

export interface IJoinChannelStorageModule {
    storeJoinChannelBlockHash(
        blockHash: string,
        joinChannelBlock: JoinChannelBlockStruct
    ): void;
    getJoinChannelBlock(blockHash: string): JoinChannelBlockStruct | undefined;
    getLatestJoinChannelBlockHash(): string;
    getTotalDeposits(): { amount: BigNumberish; data: string };
}
