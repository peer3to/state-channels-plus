import type { Hash } from "@/types/types";
import type { BalanceInterface } from "../interfaces/BalanceInterface";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import { ROUTES } from "../../threaded/worker/routeNames";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export class WorkerBalanceHandle implements BalanceInterface {
    constructor(private readonly rpc: PeerCaller) {}

    subtractBalance(req: {
        a: BalanceStruct;
        b: BalanceStruct;
    }): Promise<BalanceStruct> {
        return this.rpc.call(
            ROUTES.balance.subtract,
            req
        ) as Promise<BalanceStruct>;
    }

    areBalancesEqual(req: {
        a: BalanceStruct;
        b: BalanceStruct;
    }): Promise<boolean> {
        return this.rpc.call(ROUTES.balance.areEqual, req) as Promise<boolean>;
    }

    computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: Hash;
        lowerBlockHash?: Hash;
    }): Promise<BalanceStruct> {
        return this.rpc.call(
            ROUTES.context.computeExpectedWithdrawalsDelta,
            req
        ) as Promise<BalanceStruct>;
    }
}
