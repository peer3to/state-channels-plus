import { expect } from "chai";
import { MemoryLevel } from "memory-level";

import Storage from "@/storage";
import type { PersistenceDatabaseHandle } from "@/storage/persistence";
import { validatePersistedRuntimeState } from "@/storage/persistence/validatePersistedRuntimeState";
import type { ChannelId, ForkId } from "@/types/types";
import * as factory from "../../factory";

describe("Storage hydration", function () {
    it("accepts empty and complete runtime state", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const handle: PersistenceDatabaseHandle = {
            database,
            location: "memory:hydration",
            close: () => database.close(),
            destroy: () => database.clear()
        };
        const storage = new Storage();
        await storage.bind(handle);
        const channelId = factory.hash() as ChannelId;

        expect(validatePersistedRuntimeState(storage, channelId)).to.equal(
            undefined
        );

        const forkId = factory.hash() as ForkId;
        const stateHash = factory.hash();
        const encodedState = factory.hexString(64);
        const snapshot = factory.stateSnapshot({
            forkId,
            snapshotData: { stateMachineStateHash: stateHash }
        });
        storage.stateMachineStates.storeStateMachineState(encodedState, {
            hash: stateHash
        });
        storage.stateSnapshots.storeStateSnapshot(snapshot);
        storage.setRuntimeMetadata({
            activeForkId: forkId,
            snapshotHash: snapshot.hash,
            stateHash
        });

        const restored = validatePersistedRuntimeState(storage, channelId);
        expect(restored?.metadata.activeForkId).to.equal(forkId);
        expect(restored?.encodedState).to.equal(encodedState);
        await storage.close();
    });

    it("fails closed for every inconsistent persisted-state shape", async () => {
        const location = "memory:hydration";
        const channelId = factory.hash() as ChannelId;
        const cases: Array<{
            expected: string;
            seed: (storage: Storage) => void;
        }> = [
            {
                expected: "Persisted runtime metadata is incomplete",
                seed: (storage) => storage.setRuntimeMetadata({})
            },
            {
                expected:
                    "Persisted runtime metadata references missing snapshot",
                seed: (storage) =>
                    storage.setRuntimeMetadata({
                        activeForkId: factory.hash() as ForkId,
                        snapshotHash: factory.hash(),
                        stateHash: factory.hash()
                    })
            },
            {
                expected: "Persisted runtime metadata references missing state",
                seed: (storage) => {
                    const snapshot = factory.stateSnapshot();
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.setRuntimeMetadata({
                        activeForkId: snapshot.forkID,
                        snapshotHash: snapshot.hash,
                        stateHash: snapshot.stateMachineStateHash
                    });
                }
            },
            {
                expected:
                    "Persisted runtime metadata snapshot belongs to another fork",
                seed: (storage) => {
                    const snapshot = factory.stateSnapshot();
                    const stateHash = snapshot.stateMachineStateHash;
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.setRuntimeMetadata({
                        activeForkId: factory.hash() as ForkId,
                        snapshotHash: snapshot.hash,
                        stateHash
                    });
                }
            },
            {
                expected: "Persisted runtime metadata references missing head",
                seed: (storage) => {
                    const snapshot = factory.stateSnapshot();
                    const stateHash = snapshot.stateMachineStateHash;
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.setRuntimeMetadata({
                        activeForkId: snapshot.forkID,
                        snapshotHash: snapshot.hash,
                        stateHash,
                        headHash: factory.hash()
                    });
                }
            },
            {
                expected:
                    "Persisted runtime metadata head belongs to another fork",
                seed: (storage) => {
                    const snapshot = factory.stateSnapshot();
                    const stateHash = snapshot.stateMachineStateHash;
                    const head = factory.block({
                        stateSnapshotHash: snapshot.hash
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.blocks.storeBlock(head);
                    storage.setRuntimeMetadata({
                        activeForkId: snapshot.forkID,
                        snapshotHash: snapshot.hash,
                        stateHash,
                        headHash: head.hash
                    });
                }
            },
            {
                expected:
                    "Persisted runtime metadata head and snapshot disagree",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const snapshot = factory.stateSnapshot({ forkId });
                    const stateHash = snapshot.stateMachineStateHash;
                    const head = factory.block({
                        transaction: {
                            header: factory.transactionHeader({ forkId }),
                            body: factory.transactionBody()
                        }
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.blocks.storeBlock(head);
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: snapshot.hash,
                        stateHash,
                        headHash: head.hash
                    });
                }
            },
            {
                expected:
                    "Persisted runtime metadata snapshot and state disagree",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const snapshot = factory.stateSnapshot({ forkId });
                    const otherStateHash = factory.hash();
                    const head = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 0
                            }),
                            body: factory.transactionBody()
                        },
                        stateSnapshotHash: snapshot.hash
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: otherStateHash }
                    );
                    storage.blocks.storeBlock(head);
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: snapshot.hash,
                        stateHash: otherStateHash,
                        headHash: head.hash
                    });
                }
            },
            {
                expected: "Persisted canonical block missing at height 0",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const stateHash = factory.hash();
                    const snapshot = factory.stateSnapshot({
                        forkId,
                        snapshotData: { stateMachineStateHash: stateHash }
                    });
                    const head = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 1
                            }),
                            body: factory.transactionBody()
                        },
                        stateSnapshotHash: snapshot.hash
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.blocks.storeBlock(head);
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: snapshot.hash,
                        stateHash,
                        headHash: head.hash
                    });
                }
            },
            {
                expected:
                    "Persisted canonical block linkage is broken at height 1",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const stateHash = factory.hash();
                    const snapshot = factory.stateSnapshot({
                        forkId,
                        snapshotData: { stateMachineStateHash: stateHash }
                    });
                    const block0 = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 0
                            }),
                            body: factory.transactionBody()
                        },
                        stateSnapshotHash: snapshot.hash
                    });
                    const block1 = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 1
                            }),
                            body: factory.transactionBody()
                        },
                        previousBlockHash: factory.hash(),
                        stateSnapshotHash: snapshot.hash
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.blocks.storeBlock(block0);
                    storage.blocks.storeBlock(block1);
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: snapshot.hash,
                        stateHash,
                        headHash: block1.hash
                    });
                }
            },
            {
                expected: "references a missing snapshot",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const stateHash = factory.hash();
                    const headSnapshot = factory.stateSnapshot({
                        forkId,
                        snapshotData: { stateMachineStateHash: stateHash }
                    });
                    const block0 = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 0
                            }),
                            body: factory.transactionBody()
                        },
                        stateSnapshotHash: factory.hash()
                    });
                    const head = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 1
                            }),
                            body: factory.transactionBody()
                        },
                        previousBlockHash: block0.hash,
                        stateSnapshotHash: headSnapshot.hash
                    });
                    storage.stateSnapshots.storeStateSnapshot(headSnapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.blocks.storeBlock(block0);
                    storage.blocks.storeBlock(head);
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: headSnapshot.hash,
                        stateHash,
                        headHash: head.hash
                    });
                }
            },
            {
                expected: "references a missing state",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const headStateHash = factory.hash();
                    const missingStateHash = factory.hash();
                    const block0Snapshot = factory.stateSnapshot({
                        forkId,
                        snapshotData: {
                            stateMachineStateHash: missingStateHash
                        }
                    });
                    const headSnapshot = factory.stateSnapshot({
                        forkId,
                        snapshotData: {
                            stateMachineStateHash: headStateHash
                        }
                    });
                    const block0 = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 0
                            }),
                            body: factory.transactionBody()
                        },
                        stateSnapshotHash: block0Snapshot.hash
                    });
                    const head = factory.block({
                        transaction: {
                            header: factory.transactionHeader({
                                forkId,
                                transactionCnt: 1
                            }),
                            body: factory.transactionBody()
                        },
                        previousBlockHash: block0.hash,
                        stateSnapshotHash: headSnapshot.hash
                    });
                    storage.stateSnapshots.storeStateSnapshot(block0Snapshot);
                    storage.stateSnapshots.storeStateSnapshot(headSnapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: headStateHash }
                    );
                    storage.blocks.storeBlock(block0);
                    storage.blocks.storeBlock(head);
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: headSnapshot.hash,
                        stateHash: headStateHash,
                        headHash: head.hash
                    });
                }
            },
            {
                expected: "belongs to another channel",
                seed: (storage) => {
                    const forkId = factory.hash() as ForkId;
                    const stateHash = factory.hash();
                    const snapshot = factory.stateSnapshot({
                        forkId,
                        snapshotData: { stateMachineStateHash: stateHash }
                    });
                    const foreignBlock = factory.block();
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    storage.stateMachineStates.storeStateMachineState(
                        factory.hexString(64),
                        { hash: stateHash }
                    );
                    storage.queues.restoreEntry({
                        block: foreignBlock,
                        firstSeenAt: 1,
                        sourcePeers: new Set(),
                        signatureSources: new Map()
                    });
                    storage.setRuntimeMetadata({
                        activeForkId: forkId,
                        snapshotHash: snapshot.hash,
                        stateHash
                    });
                }
            }
        ];

        for (const testCase of cases) {
            const database = new MemoryLevel<string, string>({
                keyEncoding: "utf8",
                valueEncoding: "utf8"
            });
            const handle: PersistenceDatabaseHandle = {
                database,
                location,
                close: () => database.close(),
                destroy: () => database.clear()
            };
            const storage = new Storage();
            await storage.bind(handle);
            testCase.seed(storage);
            await storage.flush();

            expect(() =>
                validatePersistedRuntimeState(storage, channelId)
            ).to.throw(testCase.expected);
            expect(() =>
                validatePersistedRuntimeState(storage, channelId)
            ).to.throw(`(persistence: ${location})`);
            await storage.close();
        }
    });
});
