import { BlacklistStorage } from "./BlacklistStorage";
import { BlockCalldataStorage } from "./BlockCalldataStorage";
import { BlockStorage } from "./BlockStorage";
import { DisputeFraudProofStorage } from "./DisputeFraudProofStorage";
import { DisputeStorage } from "./DisputeStorage";
import { EventSyncStorage } from "./EventSyncStorage";
import { ForceExitStorage } from "./ForceExitStorage";
import { ForceJoinStorage } from "./ForceJoinStorage";
import { FraudProofStorage } from "./FraudProofStorage";
import { MessageBlockStorage } from "./MessageBlockStorage";
import { ParticipantSetChangeStorage } from "./ParticipantSetChangeStorage";
import { ProofEvidenceStorage } from "./ProofEvidenceStorage";
import { type BlockPredecessor, QueueStorage } from "./QueueStorage";
import { StateMachineStateStorage } from "./StateMachineStateStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";
import { StoredProofStorage } from "./StoredProofStorage";

import { TimeoutStorage } from "./TimeoutStorage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import {
    ForkId,
    Bytes,
    BlockOrSnapshot,
    Hash,
    BlockHeight
} from "@/types/types";
import { Address } from "@/types/types";
import { deepCopyProxy, getChecksumAddress } from "@/utils";
import type { Logger } from "@/utils/logging/Logger";

/** What one prune deleted, per store. */
export type PrunedHistory = {
    blockCount: number;
    snapshotCount: number;
    stateCount: number;
    changePointCount: number;
};

export class Storage {
    public readonly blocks: BlockStorage;
    public readonly inboundMessages: MessageBlockStorage;
    public readonly outboundMessages: MessageBlockStorage;
    public readonly stateSnapshots: StateSnapshotStorage;
    public readonly stateMachineStates: StateMachineStateStorage;
    public readonly participantSetChanges: ParticipantSetChangeStorage;
    public readonly queues: QueueStorage;
    public readonly disputes: DisputeStorage;
    public readonly fraudProofs: FraudProofStorage;
    public readonly disputeFraudProofs: DisputeFraudProofStorage;
    public readonly timeout: TimeoutStorage;
    public readonly forceExit: ForceExitStorage;
    public readonly forceJoin: ForceJoinStorage;
    public readonly blockCalldata: BlockCalldataStorage;
    public readonly eventSync: EventSyncStorage;
    public readonly blacklist: BlacklistStorage;
    public readonly storedProofs: StoredProofStorage;
    public readonly proofEvidence: ProofEvidenceStorage;

    // `maxChannelParticipants` comes from the deployed contract, so the queue's
    // and the sync evidence's retention bounds follow the chain instead of
    // restating it.
    constructor(maxChannelParticipants?: number, logger?: Logger) {
        this.blocks = deepCopyProxy(new BlockStorage());
        this.inboundMessages = deepCopyProxy(new MessageBlockStorage());
        this.outboundMessages = deepCopyProxy(new MessageBlockStorage());
        this.stateSnapshots = deepCopyProxy(new StateSnapshotStorage());
        this.stateMachineStates = deepCopyProxy(new StateMachineStateStorage());
        this.participantSetChanges = deepCopyProxy(
            new ParticipantSetChangeStorage()
        );
        this.queues = deepCopyProxy(new QueueStorage(maxChannelParticipants));
        this.disputes = deepCopyProxy(new DisputeStorage());
        this.fraudProofs = deepCopyProxy(new FraudProofStorage());
        this.disputeFraudProofs = deepCopyProxy(new DisputeFraudProofStorage());
        this.timeout = deepCopyProxy(new TimeoutStorage());
        this.forceExit = deepCopyProxy(new ForceExitStorage());
        this.forceJoin = deepCopyProxy(new ForceJoinStorage());
        this.blockCalldata = deepCopyProxy(new BlockCalldataStorage());
        this.eventSync = deepCopyProxy(new EventSyncStorage());
        this.blacklist = deepCopyProxy(new BlacklistStorage());
        this.storedProofs = deepCopyProxy(new StoredProofStorage());
        // the queue owns the validated bound and its default
        this.proofEvidence = deepCopyProxy(
            new ProofEvidenceStorage(this.queues.maxChannelParticipants, logger)
        );
        return deepCopyProxy(this);
    }

    /**
     * Deletes the history of `forkId` that a proven final hop skips: the
     * blocks above `anchorHeight` (-1: the fork genesis) and below
     * `finalHeight`, and their states. Their snapshots are kept until the
     * anchor passes them; the anchor and final-point blocks are kept.
     */
    pruneSkippedHistory(
        forkId: ForkId,
        anchorHeight: BlockHeight,
        finalHeight: BlockHeight
    ): PrunedHistory {
        const skippedSnapshotHashes = this.blocks.deleteBlocksInRange(
            forkId,
            anchorHeight + 1,
            finalHeight - 1
        );
        const skippedStateHashes = skippedSnapshotHashes.flatMap(
            (snapshotHash) =>
                this.stateSnapshots.getStateSnapshotByHash(snapshotHash)
                    ?.stateMachineStateHash ?? []
        );
        return {
            blockCount: skippedSnapshotHashes.length,
            snapshotCount: 0,
            stateCount: this.deleteUnreferencedStates(
                skippedStateHashes,
                new Set(skippedSnapshotHashes)
            ),
            changePointCount: 0
        };
    }

    /**
     * Deletes the history of `forkId` below the anchor at `anchorHeight`:
     * blocks, snapshots, their states and change points. The anchor block,
     * its snapshot and state, and the fork genesis with its state are kept.
     */
    pruneBelowAnchor(forkId: ForkId, anchorHeight: BlockHeight): PrunedHistory {
        const blockCount = this.blocks.deleteBlocksInRange(
            forkId,
            0,
            anchorHeight - 1
        ).length;
        const deletedStateHashes = this.stateSnapshots.deleteSnapshotsBelow(
            forkId,
            anchorHeight
        );
        return {
            blockCount,
            snapshotCount: deletedStateHashes.length,
            stateCount: this.deleteUnreferencedStates(deletedStateHashes),
            changePointCount:
                this.participantSetChanges.deleteChangePointsBelow(
                    forkId,
                    anchorHeight
                )
        };
    }

    /**
     * Deletes the whole history of `forkId`: blocks, snapshots (its genesis
     * too), their states and change points.
     */
    pruneFork(forkId: ForkId): PrunedHistory {
        const blockCount = this.blocks.deleteFork(forkId).length;
        const deletedStateHashes = this.stateSnapshots.deleteFork(forkId);
        return {
            blockCount,
            snapshotCount: deletedStateHashes.length,
            stateCount: this.deleteUnreferencedStates(deletedStateHashes),
            changePointCount: this.participantSetChanges.deleteFork(forkId)
        };
    }

    /**
     * Get the state snapshot for given block coordinates.
     *
     * If height < 0 (previous to first block): returns the genesis state snapshot of that fork
     * If height >= 0: gets the state snapshot from that block height
     *
     */
    getStateSnapshot(coordinates: BlockCoordinates): StateSnapshot | undefined {
        const { forkId, height } = coordinates;

        if (height < 0) {
            return this.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        }

        const block = this.blocks.getBlock(forkId, height);
        if (!block) {
            return undefined;
        }

        const stateSnapshotHash = block.stateSnapshotHash;

        return this.stateSnapshots.getStateSnapshotByHash(stateSnapshotHash);
    }

    /** The snapshot of `snapshotHash`: a held one, else one kept as proof evidence. */
    getSnapshotIncludingEvidence(
        snapshotHash: Hash
    ): StateSnapshot | undefined {
        return (
            this.stateSnapshots.getStateSnapshotByHash(snapshotHash) ??
            this.proofEvidence.getSnapshot(snapshotHash)
        );
    }

    /**
     * This peer authors and signs nothing on `forkId`: it disputes the fork,
     * or a synced proof showed its own history there to be the side chain.
     */
    isSigningStopped(forkId: ForkId): boolean {
        return (
            this.disputes.didIDispute(forkId) ||
            this.proofEvidence.hasStoppedSigning(forkId)
        );
    }

    /** The state of `stateHash`: a held one, else one kept as proof evidence. */
    getStateIncludingEvidence(stateHash: Hash): Bytes | undefined {
        return (
            this.stateMachineStates.getStateMachineState(stateHash) ??
            this.proofEvidence.getStateMachineState(stateHash)
        );
    }

    getGenesisStateMachineState(forkId: ForkId): Bytes | undefined {
        const genesisSnapshot =
            this.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        if (!genesisSnapshot) {
            return undefined;
        }
        const stateMachineStateHash =
            genesisSnapshot.snapshotData.stateMachineStateHash;

        return this.stateMachineStates.getStateMachineState(
            stateMachineStateHash
        );
    }

    getPreviousStateSnapshot(
        coordinates: BlockCoordinates
    ): StateSnapshot | undefined {
        return this.getStateSnapshot({
            forkId: coordinates.forkId,
            height: coordinates.height - 1
        });
    }

    /** The block below `coordinates` (none at height 0) and the snapshot it results in (the fork genesis at height 0). */
    getPreviousBlockAndSnapshot(coordinates: BlockCoordinates): {
        block?: Block;
        snapshot?: StateSnapshot;
    } {
        const { forkId, height } = coordinates;
        return {
            block:
                height > 0
                    ? this.blocks.getBlock(forkId, height - 1)
                    : undefined,
            snapshot: this.getPreviousStateSnapshot(coordinates)
        };
    }

    /**
     * `block` (none: the fork genesis) as a replay predecessor: with the
     * snapshot it results in and that snapshot's state, when both are held.
     */
    getPredecessor(
        forkId: ForkId,
        block?: Block
    ): BlockPredecessor | undefined {
        const snapshot = block
            ? this.stateSnapshots.getStateSnapshotByHash(
                  block.stateSnapshotHash
              )
            : this.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        const state =
            snapshot &&
            this.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            );
        if (!snapshot || state === undefined) return undefined;
        return { block, snapshot, state };
    }

    getParticipantsUnion(
        coordinates: BlockCoordinates,
        resultingStateSnapshotHash?: Hash
    ): Address[] {
        const previousSnapshot = this.getPreviousStateSnapshot(coordinates);
        let resultingSnapshot: StateSnapshot | undefined;
        if (resultingStateSnapshotHash) {
            resultingSnapshot = this.stateSnapshots.getStateSnapshotByHash(
                resultingStateSnapshotHash
            );
        } else {
            const block = this.blocks.getBlock(
                coordinates.forkId,
                coordinates.height
            );
            if (block) {
                resultingSnapshot = this.stateSnapshots.getStateSnapshotByHash(
                    block.stateSnapshotHash
                );
            }
        }

        return this.getParticipantsUnionFromSnapshots(
            previousSnapshot,
            resultingSnapshot
        );
    }

    getParticipantsUnionFromSnapshots(
        previous?: StateSnapshot,
        resulting?: StateSnapshot
    ): Address[] {
        const participants = new Set<Address>();
        for (const snapshot of [previous, resulting]) {
            for (const participant of snapshot?.snapshotData.participants ??
                []) {
                participants.add(getChecksumAddress(participant));
            }
        }
        return [...participants];
    }

    getPreviousBlockOrSnapshot(coordinates: BlockCoordinates): BlockOrSnapshot {
        const { forkId, height } = coordinates;

        if (height > 0) {
            const prevBlock = this.blocks.getBlock(forkId, height - 1)!;

            return { block: prevBlock };
        }

        const genesisSnapshot =
            this.stateSnapshots.getGenesisSnapshotByForkId(forkId)!;
        return { stateSnapshot: genesisSnapshot };
    }

    getPreviousRelevantTimestamp(
        coordinates: BlockCoordinates,
        participantAddress: Address
    ): number {
        const previousBlockOrSnapshot =
            this.getPreviousBlockOrSnapshot(coordinates);

        if (previousBlockOrSnapshot.block) {
            return previousBlockOrSnapshot.block.getRelevantTimestamp(
                participantAddress
            );
        }

        return previousBlockOrSnapshot.stateSnapshot!.timestamp;
    }

    /**
     * Deletes each of `stateHashes` that no held snapshot references, except
     * those of `excludedSnapshotHashes` (snapshots kept without their
     * state). States are hash-keyed, so one state can back several
     * snapshots. Returns how many were deleted.
     */
    private deleteUnreferencedStates(
        stateHashes: Hash[],
        excludedSnapshotHashes?: ReadonlySet<Hash>
    ): number {
        const referenced = this.stateSnapshots.getReferencedStateHashes(
            excludedSnapshotHashes
        );
        let deletedCount = 0;
        for (const stateHash of new Set(stateHashes))
            if (
                !referenced.has(stateHash) &&
                this.stateMachineStates.deleteStateMachineState(stateHash)
            )
                deletedCount++;
        return deletedCount;
    }
}
