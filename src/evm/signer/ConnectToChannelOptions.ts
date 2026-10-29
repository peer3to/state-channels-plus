import type { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type ConnectToChannelOptions = {
    autoOpen?: boolean;
    shouldJoin?: boolean;
    balance?: BalanceStruct;
    /** A join that meets a full channel leaves the runtime SYNCED spectating; omitted or false aborts it. */
    shouldSpectateWhenFull?: boolean;
    /** Omit or pass null to keep targeted matching unbounded. */
    timeoutMs?: number | null;
};
