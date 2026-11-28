// @spec-test-coverage-ignore: shared pruning staging; executable evidence belongs to the HistoryPruning, AgreementManagerPruning and E2E-HistoryPruning declarations
import { block, hexString, stateSnapshot, transactionHeader } from "../factory";
import { StateSnapshot } from "@/models";
import type Storage from "@/storage";
import type { BlockHeight, Bytes, ForkId, Hash } from "@/types/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { suppressTimeoutChecks } from "@test/fixtures/OlderDisputeStaging";
import type { HarnessOptions } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
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

/** The config a session passes to prune history on every peer. */
export const PRUNING_ON = { PRUNE_HISTORY: true };

/** What a peer holds at one height of a fork. */
export type HeldAtHeight = {
    height: BlockHeight;
    block: boolean;
    snapshot: boolean;
    state: boolean;
};

/**
 * What peer `peerIndex` holds of `forkId` at each height up to the head of
 * `referenceIndex`, a peer that prunes nothing: the block, its snapshot and
 * that snapshot's state, by the hashes the reference holds. Read once the
 * peer's queued stored-proof writes (and so its prunes) are done.
 */
export async function heldHistoryAt(
    h: MathPeerTestHarness,
    peerIndex: number,
    referenceIndex: number,
    forkId: ForkId
): Promise<HeldAtHeight[]> {
    const reference = await h.execOnHost(
        h.getPeer(referenceIndex),
        async (sm, args) => {
            const latestHeight = sm.storage.blocks.getLatestBlockHeight(
                args.forkId
            );
            const points: { snapshotHash: string; stateHash: string }[] = [];
            for (let height = 0; height <= latestHeight; height++) {
                const block = sm.storage.blocks.getBlock(args.forkId, height);
                const snapshot =
                    block &&
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        block.stateSnapshotHash
                    );
                if (!snapshot)
                    throw new Error(
                        `heldHistoryAt: the reference holds no snapshot at ${height}`
                    );
                points.push({
                    snapshotHash: String(snapshot.hash),
                    stateHash: String(snapshot.stateMachineStateHash)
                });
            }
            return points;
        },
        { forkId }
    );
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            // its read waits for the queued stored-proof writes
            await sm.agreementManager.getLocalFinalizedSnapshot(args.forkId);
            return args.points.map(({ snapshotHash, stateHash }, height) => ({
                height,
                block:
                    sm.storage.blocks.getBlock(args.forkId, height) !==
                    undefined,
                snapshot:
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        snapshotHash as Hash
                    ) !== undefined,
                state:
                    sm.storage.stateMachineStates.getStateMachineState(
                        stateHash as Hash
                    ) !== undefined
            }));
        },
        { forkId, points: reference }
    );
}

/** Whether peer `peerIndex` holds the genesis snapshot of `forkId` and its state. */
export async function holdsForkGenesis(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<boolean> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) =>
            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                args.forkId
            ) !== undefined &&
            sm.storage.getGenesisStateMachineState(args.forkId) !== undefined,
        { forkId }
    );
}

/**
 * Three peers with history pruning on, except peer `referenceIndex`, which
 * prunes nothing and so serves the hashes {@link heldHistoryAt} checks.
 * They finalize `blockCount` blocks. With `pruned` false no peer prunes.
 */
export async function stagePrunedChannel(
    h: MathPeerTestHarness,
    options: { blockCount: number; referenceIndex: number; pruned: boolean }
): Promise<{ forkId: ForkId }> {
    await h.lifecycle.start(3, 0, {
        configOverrides: options.pruned ? PRUNING_ON : {}
    });
    await h
        .control(h.getPeer(options.referenceIndex))
        .stub.setHistoryPruning(false)
        .request();
    const peerIndices = h.peers.map((peer) => peer.index);
    await h.transition.advanceState({
        count: options.blockCount,
        waitForPeers: peerIndices,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices });
    return { forkId: h.activeForkId! };
}

/** Waits until peer `peerIndex`'s local diamond mirrors a dispute on `forkId`. */
export async function waitForMirroredDispute(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<void> {
    await waitFor(
        async () =>
            h.execOnHost(
                h.getPeer(peerIndex),
                async (sm, args) =>
                    sm.diamondStateMachine.localDiamondContract.isForkDisputed(
                        sm.channelId,
                        args.forkId
                    ),
                { forkId }
            ),
        h.event.protocolEventTimeoutMs()
    );
}

/** The heights of `forkId` at which peer `peerIndex` holds a block, up to its head, once its prunes are done. */
export async function peerBlockHeights(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<BlockHeight[]> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            // its read waits for the queued stored-proof writes
            await sm.agreementManager.getLocalFinalizedSnapshot(args.forkId);
            const heights: number[] = [];
            const latestHeight = sm.storage.blocks.getLatestBlockHeight(
                args.forkId
            );
            for (let height = 0; height <= latestHeight; height++)
                if (sm.storage.blocks.getBlock(args.forkId, height))
                    heights.push(height);
            return heights;
        },
        { forkId }
    );
}

/**
 * Pruning on for every peer: `peerCount` peers finalize `blocksBefore`
 * blocks, the chain adopts a snapshot (the anchor advances), then they
 * finalize `blocksAfter` more. Returns the posted anchor. With `pruned`
 * false no peer prunes.
 */
export async function stagePrunedChannelPastAnchor(
    h: MathPeerTestHarness,
    options: {
        peerCount: number;
        blocksBefore: number;
        blocksAfter: number;
        timeConfig?: HarnessOptions["timeConfig"];
        pruned?: boolean;
    }
): Promise<{ forkId: ForkId; anchor: StateSnapshot }> {
    await h.lifecycle.start(options.peerCount, 0, {
        configOverrides: options.pruned === false ? {} : PRUNING_ON,
        timeConfig: options.timeConfig
    });
    const forkId = h.activeForkId!;
    const peerIndices = h.peers.map((peer) => peer.index);
    await h.transition.advanceState({
        count: options.blocksBefore,
        waitForPeers: peerIndices,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices });
    const anchor = await h.transition.postSnapshotWait();
    if (!anchor)
        throw new Error("stagePrunedChannelPastAnchor: no snapshot posted");
    await h.transition.advanceState({
        count: options.blocksAfter,
        waitForPeers: peerIndices,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices });
    return { forkId, anchor };
}

/** How many proof evidence records of `forkId` peer `peerIndex` holds. */
export async function forkEvidenceCount(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<number> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) =>
            sm.storage.proofEvidence.getForkEvidence(args.forkId).length,
        { forkId }
    );
}

/**
 * After a dispute reduced the channel to `newForkId`, peers `peerIndices`
 * finalize blocks on it and the chain adopts a snapshot of it: the next
 * chain anchor event. Their writer-timeout checks are off.
 */
export async function postNextForkAnchor(
    h: MathPeerTestHarness,
    newForkId: ForkId,
    peerIndices: number[]
): Promise<void> {
    // the channel idles while the post waits for the reduction to settle:
    // no writer timeout races it
    await suppressTimeoutChecks(h, peerIndices);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: peerIndices,
        waitForFinalization: true
    });
    const posted = await h.transition.postSnapshotWait({
        forkId: String(newForkId)
    });
    if (!posted) throw new Error("postNextForkAnchor: no snapshot posted");
    // the post waits for the reduction to settle on chain
    await waitFor(
        async () =>
            (await h.channelManager.getStateSnapshot(h.channelId)).forkId ===
            newForkId,
        h.event.protocolEventTimeoutMs()
    );
}
