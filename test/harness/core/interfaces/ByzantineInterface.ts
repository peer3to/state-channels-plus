import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export interface ByzantineInterface {
    stubCalldataHandler(): Promise<void>;
    restoreCalldataHandler(): Promise<void>;
    stubPendingInboundInclusion(): Promise<void>;
    restorePendingInboundInclusion(): Promise<void>;
    stubBroadcast(): Promise<void>;
    submitDoubleSignBlock(
        signedBlockConfirmation: BlockConfirmationStruct
    ): Promise<void>;
    broadcastBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<void>;
}
