import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { Bytes, Hash } from "@/types/types";

export interface ByzantineInterface {
    // --- calldata & broadcast stubs ---

    stubCalldataHandler(): Promise<void>;

    restoreCalldataHandler(): Promise<void>;

    stubPendingInboundInclusion(): Promise<void>;

    restorePendingInboundInclusion(): Promise<void>;

    stubBroadcast(): Promise<void>;

    // --- byzantine actions ---

    submitDoubleSignBlock(
        signedBlockConfirmation: BlockConfirmationStruct
    ): Promise<void>;

    broadcastBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<void>;

    // Plant raw state-machine bytes in the peer's local store, keyed by hash,
    // so the peer serves them over p2p (e.g. inflated-balance collusion).
    storeStateMachineState(encodedState: Bytes, hash: Hash): Promise<void>;

    // Plant a state snapshot in the peer's local store so on-chain
    // StateSnapshotUpdated events don't error on unknown-snapshot lookup.
    storeStateSnapshot(snapshot: StateSnapshotStruct): Promise<void>;
}
