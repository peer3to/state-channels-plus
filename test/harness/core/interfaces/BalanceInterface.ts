import type { Hash, ChannelId, Bytes } from "@/types/types";
import type { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export interface BalanceInterface {
    subtractBalance(req: {
        a: BalanceStruct;
        b: BalanceStruct;
    }): Promise<BalanceStruct>;

    areBalancesEqual(req: {
        a: BalanceStruct;
        b: BalanceStruct;
    }): Promise<boolean>;

    computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: Hash;
        lowerBlockHash?: Hash;
    }): Promise<BalanceStruct>;

    verifyBalanceInvariant(req: {
        channelId: ChannelId;
        encodedStateMachineState?: Bytes;
    }): Promise<boolean>;
}
