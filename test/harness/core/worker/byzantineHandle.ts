import type { ByzantineInterface } from "../interfaces/ByzantineInterface";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";

export class WorkerByzantineHandle implements ByzantineInterface {
    constructor(private readonly rpc: PeerCaller) {}

    stubCalldataHandler(): Promise<void> {
        return this.rpc.call(
            "byzantine.stubCalldataHandler",
            {}
        ) as Promise<void>;
    }
    restoreCalldataHandler(): Promise<void> {
        return this.rpc.call(
            "byzantine.restoreCalldataHandler",
            {}
        ) as Promise<void>;
    }
    stubPendingInboundInclusion(): Promise<void> {
        return this.rpc.call(
            "byzantine.stubPendingInboundInclusion",
            {}
        ) as Promise<void>;
    }
    restorePendingInboundInclusion(): Promise<void> {
        return this.rpc.call(
            "byzantine.restorePendingInboundInclusion",
            {}
        ) as Promise<void>;
    }
    stubBroadcast(): Promise<void> {
        return this.rpc.call("byzantine.stubBroadcast", {}) as Promise<void>;
    }
    submitDoubleSignBlock(
        signedBlockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        return this.rpc.call("byzantine.submitDoubleSignBlock", {
            signedBlockConfirmation
        }) as Promise<void>;
    }
    broadcastBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        return this.rpc.call("byzantine.broadcastBlockConfirmation", {
            blockConfirmation
        }) as Promise<void>;
    }
}
