import type { ForkId, Hash } from "@/types/types";
import type { Bytes } from "@/types";
import type { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { StateMachineInterface } from "../interfaces/StateMachineInterface";
import type { TestPeer } from "../types";

export class InlineStateMachineHandle implements StateMachineInterface {
    constructor(private readonly peer: TestPeer) {}

    async queryLatestStateMachineStateHash(
        forkId: ForkId
    ): Promise<Hash | undefined> {
        const storage = this.peer.stateManager.storage;
        const latestBlock = storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) return undefined;
        const snapshot = storage.stateSnapshots.getStateSnapshotByHash(
            latestBlock.stateSnapshotHash
        );
        if (!snapshot) return undefined;
        if (
            !storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            )
        )
            return undefined;
        return snapshot.stateMachineStateHash;
    }

    async queryStateMachineState(hash: Hash): Promise<Bytes | undefined> {
        return this.peer.stateManager.storage.stateMachineStates.getStateMachineState(
            hash
        );
    }

    async applyTransaction(
        req: TransactionStruct
    ): Promise<{ success: boolean; encodedState: Bytes }> {
        return await this.peer.stateManager.applyTransaction(req);
    }
}
