// @spec-test-coverage-ignore: shared pruning staging; executable evidence belongs to the HistoryPruning declarations
import { block, hexString, stateSnapshot, transactionHeader } from "../factory";
import { StateSnapshot } from "@/models";
import type Storage from "@/storage";
import type { BlockHeight, Bytes, ForkId, Hash } from "@/types/types";
import { ethers } from "ethers";

/** One fork's history as `storeForkHistory` stored it. */
export type StoredForkHistory = {
    forkId: ForkId;
    genesis: StateSnapshot;
    genesisStateHash: Hash;
    /** the resulting snapshot of the block at each height (index = height) */
    snapshots: StateSnapshot[];
    /** the state hash of each block's snapshot (index = height) */
    stateHashes: Hash[];
};

/**
 * Stores in `storage` a fork genesis with its state (`genesisState`, else a
 * fresh one) and blocks 0..`blockCount - 1`, each with its own resulting
 * snapshot and state, and a change point at every height. The heights in
 * `sharedStateHeights` all hold one same state; those in
 * `genesisStateHeights` hold the genesis state.
 */
export function storeForkHistory(
    storage: Storage,
    blockCount: number,
    options: {
        genesisState?: Bytes;
        sharedStateHeights?: BlockHeight[];
        genesisStateHeights?: BlockHeight[];
    } = {}
): StoredForkHistory {
    const genesisState = options.genesisState ?? hexString(64);
    const sharedState = hexString(64);
    const draft = stateSnapshot({
        snapshotData: { stateMachineStateHash: ethers.keccak256(genesisState) }
    });
    const genesis = stateSnapshot({
        snapshotData: draft.snapshotData,
        forkId: draft.snapshotDataHash,
        blockHeight: 0
    });
    const forkId = genesis.forkID;
    storage.stateSnapshots.storeStateSnapshot(genesis);
    const genesisStateHash =
        storage.stateMachineStates.storeStateMachineState(genesisState);
    const snapshots: StateSnapshot[] = [];
    const stateHashes: Hash[] = [];
    for (let height = 0; height < blockCount; height++) {
        const encodedState = options.genesisStateHeights?.includes(height)
            ? genesisState
            : options.sharedStateHeights?.includes(height)
              ? sharedState
              : hexString(64);
        const stateHash =
            storage.stateMachineStates.storeStateMachineState(encodedState);
        const snapshot = stateSnapshot({
            snapshotData: { stateMachineStateHash: stateHash },
            forkId,
            blockHeight: height
        });
        storage.stateSnapshots.storeStateSnapshot(snapshot);
        storage.blocks.storeBlock(
            block({
                header: transactionHeader({ forkId, transactionCnt: height }),
                stateSnapshotHash: snapshot.hash
            })
        );
        storage.participantSetChanges.storeChangePoint(forkId, height);
        snapshots.push(snapshot);
        stateHashes.push(stateHash);
    }
    return { forkId, genesis, genesisStateHash, snapshots, stateHashes };
}

/** The heights below `blockCount` whose block `storage` holds on `forkId`. */
export function heldBlockHeights(
    storage: Storage,
    forkId: ForkId,
    blockCount: number
): BlockHeight[] {
    return [...Array(blockCount).keys()].filter(
        (height) => storage.blocks.getBlock(forkId, height) !== undefined
    );
}

/** The heights of `history` whose snapshot `storage` holds. */
export function heldSnapshotHeights(
    storage: Storage,
    history: StoredForkHistory
): BlockHeight[] {
    return history.snapshots.flatMap((snapshot, height) =>
        storage.stateSnapshots.getStateSnapshotByHash(snapshot.hash)
            ? [height]
            : []
    );
}

/** The heights of `history` whose state `storage` holds. */
export function heldStateHeights(
    storage: Storage,
    history: StoredForkHistory
): BlockHeight[] {
    return history.stateHashes.flatMap((stateHash, height) =>
        storage.stateMachineStates.getStateMachineState(stateHash) !== undefined
            ? [height]
            : []
    );
}
