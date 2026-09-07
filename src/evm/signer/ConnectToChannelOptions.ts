import type { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type ConnectToChannelOptions = {
    autoOpen?: boolean;
    shouldJoin?: boolean;
    balance?: BalanceStruct;
    /** Omit or pass null to keep targeted matching unbounded. */
    timeoutMs?: number | null;
};
