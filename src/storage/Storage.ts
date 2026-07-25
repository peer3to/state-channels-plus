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
import { PersistencePort } from "./persistence/PersistencePort";
import { InMemoryPersistencePort } from "./persistence/InMemoryPersistencePort";
import {
    DurabilityState,
    PersistenceEngine
} from "./persistence/PersistenceEngine";
import { blocksSchema } from "./persistence/schemas/blocksSchema";
import { messageBlocksSchema } from "./persistence/schemas/messageBlocksSchema";
import { stateSnapshotSchema } from "./persistence/schemas/stateSnapshotSchema";
import { stateMachineStateSchema } from "./persistence/schemas/stateMachineStateSchema";
import { timeoutSchema } from "./persistence/schemas/timeoutSchema";
import { singletonSchema } from "./persistence/schemas/singletonSchema";
import { fraudProofsSchema } from "./persistence/schemas/fraudProofsSchema";

/**
 * Durability wiring for Storage. Consumed by the StateManager durability barriers and the P2pRuntimeHost
 * wiring. Defaults keep `new Storage()` behaving exactly as before (in-memory
 * port, noop onFatal).
 */
export type StorageOptions = {
    /** default new InMemoryPersistencePort() */
    port?: PersistencePort;
    /** default noop; wired to worker teardown by P2pRuntimeHost */
    onFatal?: (err: unknown) => void;
    notify?: (state: DurabilityState) => void;
    onError?: (err: unknown) => void;
    /** watchdog basis */
    timeoutWindowMs?: number;
    /** default 0.5 */
    livenessDeadlineFraction?: number;
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

    private readonly engine: PersistenceEngine;

    constructor(opts: StorageOptions = {}) {
        this.engine = new PersistenceEngine({
            port: opts.port ?? new InMemoryPersistencePort(),
            onFatal: opts.onFatal ?? (() => undefined),
            notify: opts.notify,
            onError: opts.onError,
            watchdog:
                opts.timeoutWindowMs !== undefined
                    ? {
                          timeoutWindowMs: opts.timeoutWindowMs,
                          deadlineFraction: opts.livenessDeadlineFraction
                      }
                    : undefined
        });

        // The engine must hold the RAW store, not the deepCopyProxy: the proxy
        // clones method args/results, which would corrupt the diff. The public
        // handle stays proxied; the schema closure operates on `raw` directly.
        const rawBlocks = new BlockStorage();
        this.blocks = deepCopyProxy(rawBlocks);
        this.engine.register(blocksSchema(rawBlocks));

        const rawInboundMessages = new MessageBlockStorage();
        this.inboundMessages = deepCopyProxy(rawInboundMessages);
        this.engine.register(
            messageBlocksSchema(rawInboundMessages, "inboundMessages")
        );

        const rawOutboundMessages = new MessageBlockStorage();
        this.outboundMessages = deepCopyProxy(rawOutboundMessages);
        this.engine.register(
            messageBlocksSchema(rawOutboundMessages, "outboundMessages")
        );

        const rawStateSnapshots = new StateSnapshotStorage();
        this.stateSnapshots = deepCopyProxy(rawStateSnapshots);
        this.engine.register(stateSnapshotSchema(rawStateSnapshots));

        const rawStateMachineStates = new StateMachineStateStorage();
        this.stateMachineStates = deepCopyProxy(rawStateMachineStates);
        this.engine.register(stateMachineStateSchema(rawStateMachineStates));

        const rawTimeout = new TimeoutStorage();
        this.timeout = deepCopyProxy(rawTimeout);
        this.engine.register(timeoutSchema(rawTimeout));

        const rawForceExit = new ForceExitStorage();
        this.forceExit = deepCopyProxy(rawForceExit);
        this.engine.register(singletonSchema(rawForceExit, "forceExit"));

        const rawForceJoin = new ForceJoinStorage();
        this.forceJoin = deepCopyProxy(rawForceJoin);
        this.engine.register(singletonSchema(rawForceJoin, "forceJoin"));

        const rawFraudProofs = new FraudProofStorage();
        this.fraudProofs = deepCopyProxy(rawFraudProofs);
        this.engine.register(fraudProofsSchema(rawFraudProofs));

        // Not yet migrated to a schema (be-06); these sit in the reflection
        // test's PENDING_SCHEMA allowlist. `queues` is a permanent opt-out
        // (transient CRDT reassembly buffer).
        this.participantSetChanges = deepCopyProxy(
            new ParticipantSetChangeStorage()
        );
        this.queues = deepCopyProxy(new QueueStorage());
        this.disputes = deepCopyProxy(new DisputeStorage());
        this.disputeFraudProofs = deepCopyProxy(new DisputeFraudProofStorage());
        this.blockCalldata = deepCopyProxy(new BlockCalldataStorage());
        this.eventSync = deepCopyProxy(new EventSyncStorage());
        return deepCopyProxy(this);
    }

    /**
     * Late-bind: attach the real durable port for a channel. The host
     * calls this at channel-connect (once the channelId is known), then
     * `await hydrate()`, strictly before any transport/gossip join. Delegates
     * to the engine's serialized attachPort (swap port + clear shadows).
     *
     * Takes the BARE port (not `{ port }`): the port carries OPAQUE_CLONE so
     * the deepCopyProxy passes it through by reference (top-level arg only), so
     * a live-handle port is never structurally cloned. A `{ port }` wrapper
     * would re-expose the nested port to the clone.
     */
    attachPersistence(port: PersistencePort): void {
        this.engine.attachPort(port);
    }

    /** Repopulate the persisted sub-stores from the durable port. */
    async hydrate(): Promise<void> {
        await this.engine.hydrateAll();
    }

    /** Resolve once all in-memory mutations up to now are durably committed. */
    awaitDurable(): Promise<void> {
        return this.engine.awaitDurable();
    }

    /** Teardown: stop the engine's timers and close the port. Idempotent. */
    dispose(): Promise<void> {
        return this.engine.dispose();
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
