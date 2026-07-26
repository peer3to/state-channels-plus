import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "hardhat";

import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

import { MessageBlockStorage } from "@/storage/MessageBlockStorage";
import { StateSnapshotStorage } from "@/storage/StateSnapshotStorage";
import { StateMachineStateStorage } from "@/storage/StateMachineStateStorage";
import { TimeoutStorage } from "@/storage/TimeoutStorage";
import { ForceExitStorage } from "@/storage/ForceExitStorage";
import { ForceJoinStorage } from "@/storage/ForceJoinStorage";
import { FraudProofStorage } from "@/storage/FraudProofStorage";

import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import { PersistenceEngine } from "@/storage/persistence/PersistenceEngine";
import { messageBlocksSchema } from "@/storage/persistence/schemas/messageBlocksSchema";
import { stateSnapshotSchema } from "@/storage/persistence/schemas/stateSnapshotSchema";
import { stateMachineStateSchema } from "@/storage/persistence/schemas/stateMachineStateSchema";
import { timeoutSchema } from "@/storage/persistence/schemas/timeoutSchema";
import { singletonSchema } from "@/storage/persistence/schemas/singletonSchema";
import { fraudProofsSchema } from "@/storage/persistence/schemas/fraudProofsSchema";

import StateSnapshot from "@/models/StateSnapshot";
import * as factory from "../../factory";

const noop = () => undefined;

function messageBlock(
    overrides: Partial<MessageBlockStruct> = {}
): MessageBlockStruct {
    return {
        previousBlockHash: ethers.ZeroHash,
        blockHeight: 0n,
        messages: [],
        totalBalance: { amount: 0n, data: "0x" },
        timestamp: 0n,
        ...overrides
    };
}

function timeout(overrides: Partial<TimeoutStruct> = {}): TimeoutStruct {
    return {
        participant: ethers.Wallet.createRandom().address,
        blockHeight: 0n,
        minTimeStamp: 0n,
        isForced: false,
        previousBlockProducer: ethers.Wallet.createRandom().address,
        previousBlockProducerPostedCalldata: false,
        participantSignatureOnPreviousBlock: "0x",
        ...overrides
    };
}

function fraudProof(
    overrides: Partial<FraudProofStruct> = {}
): FraudProofStruct {
    return {
        proofType: 0n,
        participant: ethers.Wallet.createRandom().address,
        encodedProof: ethers.hexlify(ethers.randomBytes(32)),
        ...overrides
    };
}

describe("Persistence schemas + PersistenceEngine", () => {
    describe("messageBlocksSchema", () => {
        function makeMessageStores(port: InMemoryPersistencePort) {
            const rawInbound = new MessageBlockStorage();
            const rawOutbound = new MessageBlockStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(messageBlocksSchema(rawInbound, "inboundMessages"));
            engine.register(
                messageBlocksSchema(rawOutbound, "outboundMessages")
            );
            return { rawInbound, rawOutbound, engine };
        }

        it("twin message stores persist under distinct namespaces", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeMessageStores(port);

            const inboundHash = writer.rawInbound.store(
                messageBlock({ blockHeight: 1n })
            );
            const outboundHash = writer.rawOutbound.store(
                messageBlock({ blockHeight: 2n })
            );
            await writer.engine.awaitDurable();

            const reader = makeMessageStores(port);
            await reader.engine.hydrateAll();

            expect(reader.rawInbound.getMessageBlock(inboundHash)).to.not.be
                .undefined;
            expect(reader.rawInbound.getMessageBlock(outboundHash)).to.be
                .undefined;
            expect(reader.rawOutbound.getMessageBlock(outboundHash)).to.not.be
                .undefined;
            expect(reader.rawOutbound.getMessageBlock(inboundHash)).to.be
                .undefined;
        });

        it("message block hydrate rebuilds latest pointers by running-max", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeMessageStores(port);

            writer.rawInbound.store(messageBlock({ blockHeight: 0n }));
            const midHash = writer.rawInbound.store(
                messageBlock({ blockHeight: 5n })
            );
            const highHash = writer.rawInbound.store(
                messageBlock({ blockHeight: 10n })
            );
            await writer.engine.awaitDurable();

            const reader = makeMessageStores(port);
            expect(reader.rawInbound.getLatestBlockHash()).to.be.undefined;

            await reader.engine.hydrateAll();

            expect(reader.rawInbound.getLatestBlockHeight()).to.equal(10);
            expect(reader.rawInbound.getLatestBlockHash()).to.equal(highHash);
            expect(midHash).to.not.be.undefined;
        });

        it("justPersist message blocks are excluded from persistableEntries and never replayed", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeMessageStores(port);

            const confirmedHash = writer.rawInbound.store(
                messageBlock({ blockHeight: 10n })
            );

            // A foreign-fork dispute-auditing block above the confirmed
            // height, stored justPersist - must not move the latest pointer.
            const auditingHash = writer.rawInbound.store(
                messageBlock({ blockHeight: 15n }),
                { justPersist: true }
            );

            const persistableHashes = Array.from(
                writer.rawInbound.persistableEntries()
            ).map(([blockHash]) => blockHash);
            expect(persistableHashes).to.not.include(auditingHash);

            await writer.engine.awaitDurable();

            const reader = makeMessageStores(port);
            await reader.engine.hydrateAll();

            expect(reader.rawInbound.getLatestBlockHash()).to.equal(
                confirmedHash
            );
            expect(reader.rawInbound.getLatestBlockHeight()).to.equal(10);
            expect(reader.rawInbound.getMessageBlock(auditingHash)).to.be
                .undefined;
        });

        it("re-storing an already-durable message block as justPersist does not delete it from the durable store", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeMessageStores(port);

            const durableBlock = messageBlock({ blockHeight: 10n });
            const durableHash = writer.rawInbound.store(durableBlock);
            await writer.engine.awaitDurable();

            // Dispute replay re-stores the same hash as justPersist - a merge
            // must never demote an already-durable record.
            writer.rawInbound.store(durableBlock, {
                hash: durableHash,
                justPersist: true
            });

            const persistableHashes = Array.from(
                writer.rawInbound.persistableEntries()
            ).map(([blockHash]) => blockHash);
            expect(persistableHashes).to.include(durableHash);

            await writer.engine.awaitDurable();

            const reader = makeMessageStores(port);
            await reader.engine.hydrateAll();
            expect(reader.rawInbound.getMessageBlock(durableHash)).to.not.be
                .undefined;
        });

        it("replays under a caller-supplied hash override that diverges from the content-derived hash", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeMessageStores(port);

            const block = messageBlock({ blockHeight: 3n });
            const overrideHash = factory.hash();
            writer.rawInbound.store(block, { hash: overrideHash });
            await writer.engine.awaitDurable();

            const reader = makeMessageStores(port);
            await reader.engine.hydrateAll();

            expect(reader.rawInbound.getMessageBlock(overrideHash)).to.not.be
                .undefined;
        });
    });

    describe("stateSnapshotSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new StateSnapshotStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(stateSnapshotSchema(raw));
            return { raw, engine };
        }

        it("state snapshot round-trips including genesis index", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const base = factory.stateSnapshot();
            const genesis = StateSnapshot.from({
                ...base.toStruct(),
                forkId: base.snapshotDataHash
            });

            writer.raw.storeStateSnapshot(base);
            writer.raw.storeStateSnapshot(genesis);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            const hydratedBase = reader.raw.getStateSnapshotByHash(base.hash);
            expect(hydratedBase?.hash).to.equal(base.hash);

            const hydratedGenesis = reader.raw.getGenesisSnapshotByForkId(
                genesis.forkID
            );
            expect(hydratedGenesis?.hash).to.equal(genesis.hash);
            expect(hydratedGenesis?.isGenesis).to.be.true;
        });

        it("replays under a caller-supplied hash override that diverges from the content-derived hash", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const snapshot = factory.stateSnapshot();
            const overrideHash = factory.hash();
            writer.raw.storeStateSnapshot(snapshot, { hash: overrideHash });
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            const hydrated = reader.raw.getStateSnapshotByHash(overrideHash);
            expect(hydrated?.hash).to.equal(snapshot.hash);
        });
    });

    describe("stateMachineStateSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new StateMachineStateStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(stateMachineStateSchema(raw));
            return { raw, engine };
        }

        it("state machine state bytes round-trip verbatim", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const bytes = ethers.hexlify(ethers.randomBytes(64));
            const hash = writer.raw.storeStateMachineState(bytes);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            expect(reader.raw.getStateMachineState(hash)).to.equal(bytes);
        });

        it("replays under a caller-supplied hash override that diverges from the content-derived hash", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const bytes = ethers.hexlify(ethers.randomBytes(64));
            const overrideHash = factory.hash();
            writer.raw.storeStateMachineState(bytes, { hash: overrideHash });
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            expect(reader.raw.getStateMachineState(overrideHash)).to.equal(
                bytes
            );
        });
    });

    describe("timeoutSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new TimeoutStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(timeoutSchema(raw));
            return { raw, engine };
        }

        it("timeout schema honors earliest-wins on replay", async () => {
            const port = new InMemoryPersistencePort();
            const forkId = factory.hash();

            // Durable: timeout at the higher blockHeight.
            const writer = makeStore(port);
            writer.raw.storeTimeout(forkId, timeout({ blockHeight: 10n }));
            await writer.engine.awaitDurable();

            // Fresh store already holds a LOWER (earlier) live timeout before
            // hydrate replays the higher durable one.
            const reader = makeStore(port);
            reader.raw.storeTimeout(forkId, timeout({ blockHeight: 2n }));

            await reader.engine.hydrateAll();

            expect(reader.raw.getTimeout(forkId)?.blockHeight).to.equal(2n);
        });
    });

    describe("singletonSchema", () => {
        it("singleton persists when set and dels when cleared", async () => {
            const port = new InMemoryPersistencePort();

            function makeStore() {
                const raw = new ForceJoinStorage();
                const engine = new PersistenceEngine({ port, onFatal: noop });
                engine.register(singletonSchema(raw, "forceJoin"));
                return { raw, engine };
            }

            const writer = makeStore();
            writer.raw.setJoinSubmissionBlockHeight(42);
            await writer.engine.awaitDurable();

            const reader1 = makeStore();
            await reader1.engine.hydrateAll();
            expect(reader1.raw.getJoinSubmissionBlockHeight()).to.equal(42);

            writer.raw.clear();
            await writer.engine.awaitDurable();

            const reader2 = makeStore();
            await reader2.engine.hydrateAll();
            expect(reader2.raw.getJoinSubmissionBlockHeight()).to.be.undefined;
        });

        it("forceExit singleton treats false as unset", async () => {
            const port = new InMemoryPersistencePort();

            function makeStore() {
                const raw = new ForceExitStorage();
                const engine = new PersistenceEngine({ port, onFatal: noop });
                engine.register(singletonSchema(raw, "forceExit"));
                return { raw, engine };
            }

            const writer = makeStore();
            writer.raw.setForceExit(true);
            await writer.engine.awaitDurable();

            const reader1 = makeStore();
            await reader1.engine.hydrateAll();
            expect(reader1.raw.getForceExit()).to.be.true;

            writer.raw.setForceExit(false);
            await writer.engine.awaitDurable();

            const reader2 = makeStore();
            await reader2.engine.hydrateAll();
            expect(reader2.raw.getForceExit()).to.be.false;
        });
    });

    describe("fraudProofsSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new FraudProofStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(fraudProofsSchema(raw));
            return { raw, engine };
        }

        it("fraud proof outer envelope round-trips and rebuilds participant index", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const participant = ethers.Wallet.createRandom().address;
            const proof = fraudProof({ participant, proofType: 2n });
            const proofHash = writer.raw.storeFraudProof(proof);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            const hydratedByHash = reader.raw.getFraudProofByHash(proofHash);
            expect(hydratedByHash?.participant).to.equal(participant);
            expect(hydratedByHash?.proofType).to.equal(2n);
            expect(hydratedByHash?.encodedProof).to.equal(proof.encodedProof);

            const hydratedByParticipant =
                reader.raw.getFraudProofForParticipant(participant);
            expect(hydratedByParticipant?.encodedProof).to.equal(
                proof.encodedProof
            );
        });

        it("re-storing the same encodedProof under a different participant/proofType is persisted (changeKey covers the full envelope)", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const encodedProof = ethers.hexlify(ethers.randomBytes(32));
            const participantA = ethers.Wallet.createRandom().address;
            const proofHash = writer.raw.storeFraudProof(
                fraudProof({
                    participant: participantA,
                    proofType: 1n,
                    encodedProof
                })
            );
            await writer.engine.awaitDurable();

            // Same encodedProof (same map key) but a different outer
            // envelope - must still be picked up by the next flush.
            const participantB = ethers.Wallet.createRandom().address;
            writer.raw.storeFraudProof(
                fraudProof({
                    participant: participantB,
                    proofType: 2n,
                    encodedProof
                })
            );
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            const hydrated = reader.raw.getFraudProofByHash(proofHash);
            expect(hydrated?.participant).to.equal(participantB);
            expect(hydrated?.proofType).to.equal(2n);
        });
    });
});
