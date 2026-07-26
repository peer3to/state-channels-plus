import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "hardhat";

import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Block } from "@/models";

import { ParticipantSetChangeStorage } from "@/storage/ParticipantSetChangeStorage";
import { DisputeStorage } from "@/storage/DisputeStorage";
import { DisputeFraudProofStorage } from "@/storage/DisputeFraudProofStorage";
import { BlockCalldataStorage } from "@/storage/BlockCalldataStorage";
import { EventSyncStorage } from "@/storage/EventSyncStorage";

import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import { PersistenceEngine } from "@/storage/persistence/PersistenceEngine";
import { participantSetChangeSchema } from "@/storage/persistence/schemas/participantSetChangeSchema";
import {
    disputeSchema,
    disputedForkSchema
} from "@/storage/persistence/schemas/disputeSchema";
import { disputeFraudProofSchema } from "@/storage/persistence/schemas/disputeFraudProofSchema";
import { blockCalldataSchema } from "@/storage/persistence/schemas/blockCalldataSchema";
import { eventSyncSchema } from "@/storage/persistence/schemas/eventSyncSchema";

import * as factory from "../../factory";

const noop = () => undefined;

describe("Newly-registered persistence schemas (FO5)", () => {
    describe("participantSetChangeSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new ParticipantSetChangeStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(participantSetChangeSchema(raw));
            return { raw, engine };
        }

        it("round-trips change points per fork", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);
            const forkId = factory.hash();

            writer.raw.storeChangePoint(forkId, 3);
            writer.raw.storeChangePoint(forkId, 7);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            expect(reader.raw.getChangePointsInRange(forkId)).to.deep.equal([
                3, 7
            ]);
        });
    });

    describe("disputeSchema + disputedForkSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new DisputeStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(disputeSchema(raw));
            engine.register(disputedForkSchema(raw));
            return { raw, engine };
        }

        it("round-trips a dispute confirmation and merges signatures on replay", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const confirmation: DisputeConfirmationStruct = {
                signedDispute: factory.signedDispute(),
                signatures: [factory.signature()]
            };
            const disputeHash =
                writer.raw.storeDisputeConfirmation(confirmation);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            const extraSig = factory.signature();
            reader.raw.storeDisputeConfirmation({
                signedDispute: confirmation.signedDispute,
                signatures: [extraSig]
            });

            await reader.engine.hydrateAll();

            const hydrated = reader.raw.getDisputeConfirmation(disputeHash);
            expect(hydrated?.signatures).to.include(confirmation.signatures[0]);
            expect(hydrated?.signatures).to.include(extraSig);
        });

        it("round-trips the disputedForks flag independently", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);
            const forkId = factory.hash();

            writer.raw.storeDisputedFork(forkId, true);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            expect(reader.raw.didIDispute(forkId)).to.be.true;
        });
    });

    describe("disputeFraudProofSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new DisputeFraudProofStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(disputeFraudProofSchema(raw));
            return { raw, engine };
        }

        it("round-trips a dispute fraud proof, lookup by dispute", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const dispute = factory.dispute();
            const proof = {
                proofType: 1n,
                participant: ethers.Wallet.createRandom().address,
                dispute,
                encodedProof: ethers.hexlify(ethers.randomBytes(32))
            };
            writer.raw.storeFraudProof(proof);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            const hydrated = reader.raw.getDisputeFraudProofForDispute(dispute);
            expect(hydrated?.participant).to.equal(proof.participant);
            expect(hydrated?.encodedProof).to.equal(proof.encodedProof);
        });
    });

    describe("blockCalldataSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new BlockCalldataStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(blockCalldataSchema(raw));
            return { raw, engine };
        }

        it("round-trips posted calldata, lookup by coordinates", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);

            const signedBlock = factory.signedBlock();
            const block = Block.fromSignedBlock(signedBlock);
            writer.raw.storeBlockCalldata({
                signedBlock,
                onChainTimestamp: 42
            });
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            const hydratedCalldata = reader.raw.getBlockCalldata(
                block.forkId,
                block.height,
                block.author
            );
            expect(hydratedCalldata?.onChainTimestamp).to.equal(42);
        });
    });

    describe("eventSyncSchema", () => {
        function makeStore(port: InMemoryPersistencePort) {
            const raw = new EventSyncStorage();
            const engine = new PersistenceEngine({ port, onFatal: noop });
            engine.register(eventSyncSchema(raw));
            return { raw, engine };
        }

        it("round-trips the latest-processed-block watermark per channel", async () => {
            const port = new InMemoryPersistencePort();
            const writer = makeStore(port);
            const channelId = factory.hash();

            writer.raw.storeLatestProcessedBlock(channelId, 100);
            await writer.engine.awaitDurable();

            const reader = makeStore(port);
            await reader.engine.hydrateAll();

            expect(reader.raw.getLatestProcessedBlock(channelId)).to.equal(100);
        });
    });
});
