import type { ByzantineInterface } from "../interfaces/ByzantineInterface";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { Bytes, Hash } from "@/types/types";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";

export class WorkerByzantineHandle implements ByzantineInterface {
    constructor(private readonly rpc: PeerCaller) {}

    stubCalldataHandler(): Promise<void> {
        return this.rpc.call(
            ROUTES.byzantine.stubCalldataHandler,
            {}
        ) as Promise<void>;
    }
    restoreCalldataHandler(): Promise<void> {
        return this.rpc.call(
            ROUTES.byzantine.restoreCalldataHandler,
            {}
        ) as Promise<void>;
    }
    stubPendingInboundInclusion(): Promise<void> {
        return this.rpc.call(
            ROUTES.byzantine.stubPendingInboundInclusion,
            {}
        ) as Promise<void>;
    }
    restorePendingInboundInclusion(): Promise<void> {
        return this.rpc.call(
            ROUTES.byzantine.restorePendingInboundInclusion,
            {}
        ) as Promise<void>;
    }
    stubBroadcast(): Promise<void> {
        return this.rpc.call(
            ROUTES.byzantine.stubBroadcast,
            {}
        ) as Promise<void>;
    }
    submitDoubleSignBlock(
        signedBlockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        return this.rpc.call(ROUTES.byzantine.submitDoubleSignBlock, {
            signedBlockConfirmation
        }) as Promise<void>;
    }
    broadcastBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        return this.rpc.call(ROUTES.byzantine.broadcastBlockConfirmation, {
            blockConfirmation
        }) as Promise<void>;
    }
    storeStateMachineState(encodedState: Bytes, hash: Hash): Promise<void> {
        return this.rpc.call(ROUTES.byzantine.storeStateMachineState, {
            encodedState,
            hash
        }) as Promise<void>;
    }
    storeStateSnapshot(snapshot: StateSnapshotStruct): Promise<void> {
        return this.rpc.call(ROUTES.byzantine.storeStateSnapshot, {
            snapshot
        }) as Promise<void>;
    }
}
