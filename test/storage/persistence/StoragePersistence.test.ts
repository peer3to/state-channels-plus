import { expect } from "chai";
import { MemoryLevel } from "memory-level";

import Storage from "@/storage";
import type { PersistenceDatabaseHandle } from "@/storage/persistence";
import { Codec, Type } from "@/utils";
import * as factory from "../../factory";

function createHandle(
    database: MemoryLevel<string, string>,
    closeDatabase = true
): PersistenceDatabaseHandle {
    return {
        database,
        location: "memory:test",
        close: () =>
            closeDatabase ? database.close() : Promise.resolve(undefined),
        destroy: () => database.clear()
    };
}

describe("Storage persistence", function () {
    it("recovers primary records, derived indexes, and queue attribution", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage();
        await first.bind(createHandle(database));

        const snapshot = factory.stateSnapshot();
        const encodedState = factory.hexString(128);
        const block = factory.block({
            stateSnapshotHash: snapshot.hash
        });
        const sender = factory.randomAddress();
        first.stateSnapshots.storeStateSnapshot(snapshot);
        first.stateMachineStates.storeStateMachineState(encodedState, {
            hash: snapshot.stateMachineStateHash
        });
        first.blocks.storeBlock(block);
        first.queues.restoreEntry({
            block,
            firstSeenAt: 1,
            sourcePeers: new Set([sender]),
            signatureSources: new Map([
                [block.originalSignature, new Set([sender])]
            ])
        });
        await first.flush();
        await first.close();

        const second = new Storage();
        await second.bind(createHandle(database));

        expect(second.blocks.getBlock(block.hash)?.equals(block)).to.be.true;
        expect(second.blocks.getLatestBlock(block.forkId)?.hash).to.equal(
            block.hash
        );
        expect(
            second.stateSnapshots.getStateSnapshotByHash(snapshot.hash)?.hash
        ).to.equal(snapshot.hash);
        expect(
            second.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            )
        ).to.equal(encodedState);
        const queued = second.queues.getQueuedEntry(block.hash);
        expect(queued?.sourcePeers.has(sender)).to.be.true;
        expect(queued?.signatureSources.size).to.be.greaterThan(0);
        await second.close();
    });

    it("persists the final queue state after interleaved mutations", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage();
        await first.bind(createHandle(database));
        const block = factory.block();
        first.queues.restoreEntry({
            block,
            firstSeenAt: 1,
            sourcePeers: new Set(),
            signatureSources: new Map()
        });
        const removed = first.queues.removeBlock(block.hash);
        expect(removed).to.not.be.undefined;
        expect(first.queues.getQueuedEntry(block.hash)).to.be.undefined;
        first.queues.restoreEntry(removed!);
        expect(first.queues.getQueuedEntry(block.hash)).to.not.be.undefined;
        await first.flush();
        await first.close();

        const second = new Storage();
        await second.bind(createHandle(database));
        expect(second.queues.getQueuedEntry(block.hash)).to.not.be.undefined;
        await second.close();
    });

    it("updates primary cache and derived indexes before disk settles", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const storage = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await storage.bind(createHandle(database));
        const block = factory.block();

        storage.blocks.storeBlock(block);

        expect(storage.blocks.getBlock(block.hash)?.hash).to.equal(block.hash);
        expect(storage.blocks.getLatestBlock(block.forkId)?.hash).to.equal(
            block.hash
        );
        expect(await database.get(`records!v1!blocks!${block.hash}`)).to.equal(
            undefined
        );
        await storage.flush();
        expect(
            await database.get(`records!v1!blocks!${block.hash}`)
        ).to.not.equal(undefined);
        await storage.close();
    });

    it("keeps cache-first mutations visible when their barrier fails", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const storage = new Storage();
        await storage.bind(createHandle(database));
        const firstBlock = factory.block();
        const nextBlock = factory.block({
            transaction: {
                header: factory.transactionHeader({
                    forkId: firstBlock.forkId,
                    transactionCnt: 1
                }),
                body: factory.transactionBody()
            }
        });
        storage.blocks.storeBlock(firstBlock);
        await storage.flush();
        await database.close();

        storage.blocks.storeBlock(nextBlock);
        expect(storage.blocks.getBlock(nextBlock.hash)?.hash).to.equal(
            nextBlock.hash
        );
        expect(storage.blocks.getLatestBlock(firstBlock.forkId)?.hash).to.equal(
            nextBlock.hash
        );

        let error: Error | undefined;
        try {
            await storage.flush();
        } catch (caught) {
            error = caught as Error;
        }

        expect(error).to.be.instanceOf(Error);
        expect(storage.blocks.getBlock(nextBlock.hash)?.hash).to.equal(
            nextBlock.hash
        );
    });

    it("flushes pending writes during graceful close", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await first.bind(createHandle(database));
        const block = factory.block();
        first.blocks.storeBlock(block);

        await first.close();

        const second = new Storage();
        await second.bind(createHandle(database));
        expect(second.blocks.getBlock(block.hash)?.hash).to.equal(block.hash);
        await second.close();
    });

    it("recovers a flushed canonical height and rejects conflicting bait after an abrupt reopen", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await first.bind(createHandle(database, false));
        const canonical = factory.block();
        const conflicting = factory.block({
            transaction: {
                header: factory.transactionHeader({
                    forkId: canonical.forkId,
                    transactionCnt: canonical.height
                }),
                body: factory.transactionBody()
            }
        });
        first.blocks.storeBlock(canonical);
        await first.flush();

        const restarted = new Storage();
        await restarted.bind(createHandle(database, false));
        expect(restarted.blocks.getBlock(canonical.hash)?.hash).to.equal(
            canonical.hash
        );
        expect(restarted.blocks.storeBlock(conflicting)).to.equal(undefined);
        expect(
            restarted.blocks.getBlock(canonical.forkId, canonical.height)?.hash
        ).to.equal(canonical.hash);

        await first.close();
        await restarted.close();
        await database.close();
    });

    it("recovers the flushed prefix but not a later cache-only tail", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await first.bind(createHandle(database, false));
        const durableBlock = factory.block();
        first.blocks.storeBlock(durableBlock);
        await first.flush();
        first.forceExit.setForceExit(true);

        const restarted = new Storage();
        await restarted.bind(createHandle(database, false));
        expect(restarted.blocks.getBlock(durableBlock.hash)?.hash).to.equal(
            durableBlock.hash
        );
        expect(restarted.forceExit.getForceExit()).to.equal(false);

        await first.close();
        await restarted.close();
        await database.close();
    });

    it("re-arms an unflushed dequeue and consumes the resurrected entry once", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await first.bind(createHandle(database, false));
        const block = factory.block();
        first.queues.restoreEntry({
            block,
            firstSeenAt: 1,
            sourcePeers: new Set(),
            signatureSources: new Map()
        });
        await first.flush();
        expect(first.queues.removeBlock(block.hash)?.block.hash).to.equal(
            block.hash
        );

        const restarted = new Storage();
        await restarted.bind(createHandle(database, false));
        const resurrected = restarted.queues.removeBlock(block.hash);
        expect(resurrected?.block.hash).to.equal(block.hash);
        expect(restarted.queues.removeBlock(block.hash)).to.equal(undefined);
        await restarted.flush();

        const afterExecution = new Storage();
        await afterExecution.bind(createHandle(database, false));
        expect(afterExecution.queues.getQueuedEntry(block.hash)).to.equal(
            undefined
        );

        await first.close();
        await restarted.close();
        await afterExecution.close();
        await database.close();
    });

    it("round-trips every registered collection through public storage owners", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await first.bind(createHandle(database));

        const snapshot = factory.stateSnapshot();
        const encodedState = factory.hexString(64);
        const block = factory.block({
            stateSnapshotHash: snapshot.hash
        });
        const inboundMessage = factory.exitChannelBlock({ blockHeight: 3n });
        const outboundMessage = factory.exitChannelBlock({ blockHeight: 4n });
        const dispute = factory.dispute();
        const signedDispute = factory.signedDispute({
            encodedDispute: Codec.encode(dispute, Type.Dispute)
        });
        const participant = factory.randomAddress();
        const fraudProof = {
            proofType: 0,
            participant,
            encodedProof: factory.hexString(24)
        };
        const disputeFraudProof = {
            proofType: 0,
            participant,
            dispute,
            encodedProof: factory.hexString(24)
        };
        const timeout = {
            participant,
            blockHeight: 5n,
            minTimeStamp: 6n,
            isForced: false,
            previousBlockProducer: factory.randomAddress(),
            previousBlockProducerPostedCalldata: false,
            participantSignatureOnPreviousBlock: factory.signature()
        };
        const blockCalldata = {
            signedBlock: block.signedBlock,
            onChainTimestamp: 7
        };

        first.blocks.storeBlock(block);
        const inboundHash = first.inboundMessages.store(inboundMessage);
        const outboundHash = first.outboundMessages.store(outboundMessage);
        first.stateSnapshots.storeStateSnapshot(snapshot);
        first.stateMachineStates.storeStateMachineState(encodedState, {
            hash: snapshot.stateMachineStateHash
        });
        first.participantSetChanges.storeChangePoint(block.forkId, 8);
        first.queues.restoreEntry({
            block,
            firstSeenAt: 1,
            sourcePeers: new Set([participant]),
            signatureSources: new Map([
                [block.originalSignature, new Set([participant])]
            ])
        });
        const disputeHash = first.disputes.storeDispute(signedDispute);
        first.disputes.storeDisputedFork(block.forkId, true);
        const fraudProofHash = first.fraudProofs.storeFraudProof(fraudProof);
        first.disputeFraudProofs.storeFraudProof(disputeFraudProof);
        first.timeout.storeTimeout(block.forkId, timeout);
        first.forceExit.setForceExit(true);
        first.forceJoin.setJoinSubmissionBlockHeight(-1);
        first.blockCalldata.storeBlockCalldata(blockCalldata);
        first.eventSync.storeLatestProcessedBlock(block.channelId, 10);
        first.setRuntimeMetadata({
            activeForkId: block.forkId,
            headHash: block.hash,
            snapshotHash: snapshot.hash,
            stateHash: snapshot.stateMachineStateHash
        });
        await first.flush();
        await first.close();

        const second = new Storage();
        await second.bind(createHandle(database));
        expect(second.blocks.getBlock(block.hash)?.hash).to.equal(block.hash);
        expect(
            second.inboundMessages.getMessageBlock(inboundHash)
        ).to.deep.equal(inboundMessage);
        expect(
            second.outboundMessages.getMessageBlock(outboundHash)
        ).to.deep.equal(outboundMessage);
        expect(
            second.stateSnapshots.getStateSnapshotByHash(snapshot.hash)?.hash
        ).to.equal(snapshot.hash);
        expect(
            second.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            )
        ).to.equal(encodedState);
        expect(
            second.participantSetChanges.getChangePointsInRange(
                block.forkId,
                0,
                10
            )
        ).to.deep.equal([8]);
        expect(
            second.queues
                .getQueuedEntry(block.hash)
                ?.sourcePeers.has(participant)
        ).to.be.true;
        expect(
            second.disputes.getDisputeConfirmation(disputeHash)
        ).to.not.equal(undefined);
        expect(second.disputes.didIDispute(block.forkId)).to.be.true;
        expect(
            second.fraudProofs.getFraudProofByHash(fraudProofHash)?.participant
        ).to.equal(participant);
        expect(
            second.disputeFraudProofs.getDisputeFraudProofForDispute(dispute)
                ?.participant
        ).to.equal(participant);
        expect(second.timeout.getTimeout(block.forkId)?.blockHeight).to.equal(
            5n
        );
        expect(second.forceExit.getForceExit()).to.be.true;
        expect(second.forceJoin.getJoinSubmissionBlockHeight()).to.equal(-1);
        expect(
            second.blockCalldata.getMatchingBlockCalldata(block)
                ?.onChainTimestamp
        ).to.equal(7);
        expect(
            second.eventSync.getLatestProcessedBlock(block.channelId)
        ).to.equal(10);
        expect(second.getRuntimeMetadata()?.headHash).to.equal(block.hash);
        await second.close();
    });

    it("a justPersist merge cannot demote the tip, and a justPersist-only block stays off the tip across a restart", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage();
        await first.bind(createHandle(database));

        // Normal store, then a justPersist merge of the SAME block: the merge
        // must not demote the already-advancing record off the tip.
        const advancing = factory.block();
        first.blocks.storeBlock(advancing);
        expect(first.blocks.getLatestBlock(advancing.forkId)?.hash).to.equal(
            advancing.hash
        );
        first.blocks.storeBlock(advancing, { justPersist: true });
        expect(first.blocks.getLatestBlock(advancing.forkId)?.hash).to.equal(
            advancing.hash
        );

        // A justPersist-only block at a greater height must not advance the
        // tip (same fork by factory default).
        const parked = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({ transactionCnt: 5 })
            })
        });
        first.blocks.storeBlock(parked, { justPersist: true });
        expect(first.blocks.getLatestBlock(advancing.forkId)?.hash).to.equal(
            advancing.hash
        );
        await first.flush();
        await first.close();

        // The restart must agree: advancesTip is persisted, not re-inferred,
        // so rehydration cannot resurrect the parked block as the tip.
        const second = new Storage();
        await second.bind(createHandle(database));
        expect(second.blocks.getBlock(parked.hash)?.equals(parked)).to.be.true;
        expect(second.blocks.getLatestBlock(advancing.forkId)?.hash).to.equal(
            advancing.hash
        );

        // A later normal store of the parked block promotes it.
        second.blocks.storeBlock(parked);
        expect(second.blocks.getLatestBlock(advancing.forkId)?.hash).to.equal(
            parked.hash
        );
        await second.close();
    });

    it("fails hydration closed on a corrupt record value in a known collection", async () => {
        const database = new MemoryLevel<string, string>({
            keyEncoding: "utf8",
            valueEncoding: "utf8"
        });
        const first = new Storage();
        await first.bind(createHandle(database));
        const block = factory.block();
        first.blocks.storeBlock(block);
        await first.flush();
        await first.close();

        // Corrupt the persisted block record in place (a known-collection
        // key, unlike the unknown-collection case the controller suite
        // covers).
        await database.open();
        await database.put(`records!v1!blocks!${block.hash}`, "0xdeadbeef");

        const second = new Storage();
        let bindError: Error | undefined;
        try {
            await second.bind(createHandle(database));
        } catch (error) {
            bindError = error as Error;
        }
        expect(bindError, "hydration must fail closed on a corrupt record").to
            .not.be.undefined;
        // Fail-closed also means no partial state leaks into the caches.
        expect(second.blocks.getBlock(block.hash)).to.be.undefined;
    });

    it("makes flush immediate when persistence is disabled", async () => {
        const storage = new Storage();
        const block = factory.block();

        storage.blocks.storeBlock(block);
        expect(storage.blocks.getBlock(block.hash)?.hash).to.equal(block.hash);
        await storage.flush();
        await storage.close();
    });
});
