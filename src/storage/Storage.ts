import { BlockStorage } from "./BlockStorage";
import { MessageBlockStorage } from "./MessageBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";
import { StateMachineStateStorage } from "./StateMachineStateStorage";
import { ParticipantSetChangeStorage } from "./ParticipantSetChangeStorage";
import { QueueStorage } from "./QueueStorage";
import { DisputeStorage } from "./DisputeStorage";
import { FraudProofStorage } from "./FraudProofStorage";

import { BlockCoordinates, StateSnapshot } from "@/models";
import { deepCopyProxy } from "@/utils";
import { ForkId, Bytes, BlockOrSnapshot, Hash } from "@/types/types";
import { Address } from "@/types/types";
import { TimeoutStorage } from "./TimeoutStorage";
import { ForceExitStorage } from "./ForceExitStorage";
import { ForceJoinStorage } from "./ForceJoinStorage";
import { DisputeFraudProofStorage } from "./DisputeFraudProofStorage";
import { BlockCalldataStorage } from "./BlockCalldataStorage";
import { EventSyncStorage } from "./EventSyncStorage";
import type { Logger } from "@/utils/logging";
import {
    PersistenceController,
    PersistentCollection,
    type PersistenceControllerOptions,
    type PersistenceDatabaseHandle
} from "./persistence";
import {
    createStorageRecordCodec,
    type RuntimeMetadata
} from "./persistence/storageCodecs";

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
    private readonly controller: PersistenceController;
    private readonly runtimeMetadata: PersistentCollection<
        "active",
        RuntimeMetadata
    >;
    private persistenceLocation?: string;

    constructor(
        logger?: Logger,
        persistenceOptions: Pick<
            PersistenceControllerOptions,
            "flushIntervalMs" | "maxBatchOperations" | "commitDeadlineMs"
        > = {}
    ) {
        this.controller = new PersistenceController(
            createStorageRecordCodec(),
            { logger, ...persistenceOptions }
        );
        this.blocks = deepCopyProxy(new BlockStorage(this.controller));
        this.inboundMessages = deepCopyProxy(
            new MessageBlockStorage("inboundMessages", this.controller)
        );
        this.outboundMessages = deepCopyProxy(
            new MessageBlockStorage("outboundMessages", this.controller)
        );
        this.stateSnapshots = deepCopyProxy(
            new StateSnapshotStorage(this.controller)
        );
        this.stateMachineStates = deepCopyProxy(
            new StateMachineStateStorage(this.controller)
        );
        this.participantSetChanges = deepCopyProxy(
            new ParticipantSetChangeStorage(this.controller)
        );
        this.queues = deepCopyProxy(new QueueStorage(this.controller));
        this.disputes = deepCopyProxy(new DisputeStorage(this.controller));
        this.fraudProofs = deepCopyProxy(
            new FraudProofStorage(this.controller)
        );
        this.disputeFraudProofs = deepCopyProxy(
            new DisputeFraudProofStorage(this.controller)
        );
        this.timeout = deepCopyProxy(new TimeoutStorage(this.controller));
        this.forceExit = deepCopyProxy(new ForceExitStorage(this.controller));
        this.forceJoin = deepCopyProxy(new ForceJoinStorage(this.controller));
        this.blockCalldata = deepCopyProxy(
            new BlockCalldataStorage(this.controller)
        );
        this.eventSync = deepCopyProxy(new EventSyncStorage(this.controller));
        this.runtimeMetadata = new PersistentCollection(
            "runtimeMetadata",
            this.controller
        );
        return deepCopyProxy(this, {
            preserveArgumentsFor: new Set([
                "bind",
                "setPersistenceFailureHandler",
                "flush",
                "close"
            ])
        });
    }

    /**
     * Hydrates EVERY collection above in one pass and rebuilds their derived
     * indexes; all-or-nothing (a decode failure restores the previous caches
     * and closes the database). Runs during host construction, before the
     * StateManager exists - so `StateManager.restorePersistedState` only has to
     * recover the process-local state that never reaches a collection.
     */
    public async bind(
        databaseHandle: PersistenceDatabaseHandle
    ): Promise<void> {
        this.persistenceLocation = databaseHandle.location;
        this.controller.attachDatabaseHandle(databaseHandle);
        await this.controller.bind();
        // TODO(persistence): distinguish legal forward crash prefixes from
        // referenced corruption before rejecting hydration.
    }

    public setPersistenceFailureHandler(handler: (error: Error) => void): void {
        this.controller.setFailureHandler(handler);
    }

    public setRuntimeMetadata(metadata: RuntimeMetadata): void {
        this.runtimeMetadata.set("active", metadata);
    }

    public getRuntimeMetadata(): RuntimeMetadata | undefined {
        return this.runtimeMetadata.get("active");
    }

    public flush(): Promise<void> {
        return this.controller.flush();
    }

    public close(): Promise<void> {
        return this.controller.close();
    }

    public getPersistenceLocation(): string | undefined {
        return this.persistenceLocation;
    }

    // TODO(persistence): add proof-aware pruning in a separate design. It must
    // protect active proof roots, disputes, queue entries, heads, and stale-fork
    // tombstones, then revalidate writes that raced its reachability scan.

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
        const participants = new Set<Address>();

        if (previousSnapshot?.snapshotData.participants) {
            for (const participant of previousSnapshot.snapshotData
                .participants) {
                participants.add(participant);
            }
        }

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

        if (resultingSnapshot?.snapshotData.participants) {
            for (const participant of resultingSnapshot.snapshotData
                .participants) {
                participants.add(participant);
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
