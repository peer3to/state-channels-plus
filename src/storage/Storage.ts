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
import { QueueStorage } from "./QueueStorage";
import { StateMachineStateStorage } from "./StateMachineStateStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";

import { TimeoutStorage } from "./TimeoutStorage";
import { BlockCoordinates, StateSnapshot } from "@/models";
import { ForkId, Bytes, BlockOrSnapshot, Hash } from "@/types/types";
import { Address } from "@/types/types";
import { deepCopyProxy, getChecksumAddress } from "@/utils";

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

    // `maxChannelParticipants` comes from the deployed contract, so the queue's
    // retention bound follows the chain instead of restating it.
    constructor(maxChannelParticipants?: number) {
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
        return deepCopyProxy(this);
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
}
