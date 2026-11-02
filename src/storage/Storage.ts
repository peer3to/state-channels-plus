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
import {
    PersistenceController,
    type PersistenceControllerOptions,
    type PersistenceDatabaseHandle
} from "./persistence";
import { type BlockPredecessor, QueueStorage } from "./QueueStorage";
import { StateMachineStateStorage } from "./StateMachineStateStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";

import { TimeoutStorage } from "./TimeoutStorage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { ForkId, Bytes, BlockOrSnapshot, Hash } from "@/types/types";
import { Address } from "@/types/types";
import { deepCopyProxy, getChecksumAddress } from "@/utils";
import type { Logger } from "@/utils/logging";

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
    private readonly controller: PersistenceController;

    // `maxChannelParticipants` comes from the deployed contract, so the queue's
    // retention bound follows the chain instead of restating it.
    constructor(
        maxChannelParticipants?: number,
        logger?: Logger,
        persistenceOptions: Pick<
            PersistenceControllerOptions,
            "flushIntervalMs"
        > = {}
    ) {
        this.controller = new PersistenceController({
            logger,
            ...persistenceOptions
        });
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
        this.queues = deepCopyProxy(new QueueStorage(maxChannelParticipants));
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
        this.blacklist = deepCopyProxy(new BlacklistStorage());
        // `open` takes a live database handle and callback, not data
        return deepCopyProxy(this, {
            preserveArgumentsFor: new Set(["open"])
        });
    }

    /**
     * Loads every persisted collection from `databaseHandle` and checks the
     * head fork's chain; fails closed (the database is closed and the error
     * names its location). From then on writes reach disk behind memory.
     * `onFailure` runs when a batch fails for good.
     */
    public async open(
        databaseHandle: PersistenceDatabaseHandle,
        onFailure: (error: Error) => void
    ): Promise<void> {
        await this.controller.open(databaseHandle, onFailure);
        try {
            this.verifyHeadFork();
        } catch (error) {
            await this.controller.close().catch(() => undefined);
            throw new Error(
                `${error instanceof Error ? error.message : String(error)} (persistence: ${databaseHandle.location})`
            );
        }
    }

    /** Resolves once the disk holds every write made before the call. */
    public flush(): Promise<void> {
        return this.controller.flush();
    }

    /** Drains pending writes and closes the database; later writes stay in memory. */
    public close(): Promise<void> {
        return this.controller.close();
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
     * The head fork links from its lowest stored block to its latest one
     * (block 0 to the fork genesis), and its latest state is held.
     */
    private verifyHeadFork(): void {
        const forkId = this.stateSnapshots.getHeadForkId();
        if (forkId === undefined) return;
        const latestHeight = this.blocks.getLatestBlockHeight(forkId);
        const head =
            latestHeight >= 0
                ? this.blocks.getBlock(forkId, latestHeight)
                : undefined;
        if (!this.getPredecessor(forkId, head)) {
            throw new Error(
                `Persisted head fork ${String(forkId)} has no snapshot and state at height ${latestHeight}`
            );
        }
        let below: Hash | undefined;
        for (let height = 0; height <= latestHeight; height++) {
            const block = this.blocks.getBlock(forkId, height);
            if (!block) {
                if (below !== undefined) {
                    throw new Error(
                        `Persisted head fork ${String(forkId)} misses block ${height}`
                    );
                }
                continue;
            }
            if (height === 0) {
                below =
                    this.stateSnapshots.getGenesisSnapshotByForkId(
                        forkId
                    )?.hash;
                if (below === undefined) {
                    throw new Error(
                        `Persisted head fork ${String(forkId)} has block 0 but no genesis snapshot`
                    );
                }
            }
            if (
                below !== undefined &&
                String(block.previousBlockHash).toLowerCase() !==
                    String(below).toLowerCase()
            ) {
                throw new Error(
                    `Persisted block ${String(forkId)}:${height} does not link to the block below it`
                );
            }
            below = block.hash;
        }
    }
}
