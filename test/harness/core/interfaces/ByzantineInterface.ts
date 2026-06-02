import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type SubmitDoubleSignReq = {
    signedBlockConfirmation: BlockConfirmationStruct;
};

export interface ByzantineInterface {
    stubCalldataHandler(): Promise<void>;
    restoreCalldataHandler(): Promise<void>;
    stubPendingInboundInclusion(): Promise<void>;
    restorePendingInboundInclusion(): Promise<void>;
    stubBroadcast(): Promise<void>;
    submitDoubleSignBlock(req: SubmitDoubleSignReq): Promise<void>;
    broadcastBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
    }): Promise<void>;
}
