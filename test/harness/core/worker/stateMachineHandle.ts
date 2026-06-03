import type { ForkId, Hash } from "@/types/types";
import type { Bytes } from "@/types";
import type { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { StateMachineInterface } from "../interfaces/StateMachineInterface";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import { ROUTES } from "../../threaded/worker/routeNames";

export class WorkerStateMachineHandle implements StateMachineInterface {
    constructor(private readonly rpc: PeerCaller) {}

    queryLatestStateMachineStateHash(
        forkId: ForkId
    ): Promise<Hash | undefined> {
        return this.rpc.call(ROUTES.query.latestStateMachineStateHash, {
            forkId
        }) as Promise<Hash | undefined>;
    }

    queryStateMachineState(hash: Hash): Promise<Bytes | undefined> {
        return this.rpc.call(ROUTES.query.stateMachineState, {
            hash
        }) as Promise<Bytes | undefined>;
    }

    applyTransaction(
        req: TransactionStruct
    ): Promise<{ success: boolean; encodedState: Bytes }> {
        return this.rpc.call(ROUTES.tx.apply, req) as Promise<{
            success: boolean;
            encodedState: Bytes;
        }>;
    }
}
