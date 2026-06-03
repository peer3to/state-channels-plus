import type { ForkId, Hash } from "@/types/types";
import type { Bytes } from "@/types";
import type { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type ApplyTransactionResult = {
    success: boolean;
    encodedState: Bytes;
};

export interface StateMachineInterface {
    // --- reads ---

    queryLatestStateMachineStateHash(forkId: ForkId): Promise<Hash | undefined>;

    queryStateMachineState(hash: Hash): Promise<Bytes | undefined>;

    // --- writes ---

    applyTransaction(req: TransactionStruct): Promise<ApplyTransactionResult>;
}
