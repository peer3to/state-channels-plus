import * as factory from "../../factory";
import { Block } from "@/models";
import type StateSnapshot from "@/models/StateSnapshot";
import Storage from "@/storage";
import { BlockOrigin } from "@/storage/QueueStorage";
import type { BlockHeight, ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { GatedMemoryLevel } from "@test/fixtures/GatedMemoryLevel";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

const noFailure = () => undefined;

async function openStorage(
    database: GatedMemoryLevel,
    flushIntervalMs?: number
): Promise<Storage> {
    const storage = new Storage(undefined, undefined, { flushIntervalMs });
    await storage.open(database.handle(), noFailure);
    return storage;
}

async function reopen(
    database: GatedMemoryLevel,
    storage: Storage
): Promise<Storage> {
    await storage.close();
    return openStorage(database);
}

async function openError(
    database: GatedMemoryLevel,
    storage = new Storage()
): Promise<Error> {
    try {
        await storage.open(database.handle(), noFailure);
    } catch (error) {
        return error as Error;
    }
    throw new Error("expected the open to fail");
}

// a refused load leaves memory empty and the storage free to bind again
async function expectRefusalReleased(
    storage: Storage,
    forkId: ForkId
): Promise<void> {
    expect(storage.stateSnapshots.getHeadForkId()).to.equal(undefined);
    expect(storage.blocks.getLatestBlockHeight(forkId)).to.equal(-1);
    expect(storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)).to.equal(
        undefined
    );
    const fresh = new GatedMemoryLevel();
    await storage.open(fresh.handle(), noFailure);
    expect(fresh.status).to.equal("open");
    await storage.close();
}

function encodedBlock(block: Block | undefined): string | undefined {
    return block
        ? ethers.hexlify(
              Codec.encode(
                  block.blockConfirmationStruct,
                  Type.BlockConfirmation
              )
          )
        : undefined;
}

/** a confirmation signature by a fresh key */
function signBlock(block: Block): string {
    return factory.randomWallet().signMessageSync(ethers.getBytes(block.hash));
}

function genesisSnapshot(): StateSnapshot {
    const seed = factory.stateSnapshot();
    return factory.stateSnapshot({
        snapshotData: seed.snapshotData,
        forkId: seed.snapshotDataHash as ForkId
    });
}

function chainedBlock(
    forkId: ForkId,
    height: BlockHeight,
    previousBlockHash: Hash,
    stateSnapshotHash: Hash
): Block {
    return factory.block({
        header: factory.transactionHeader({ forkId, transactionCnt: height }),
        previousBlockHash,
        stateSnapshotHash
    });
}

/**
 * Stores a head fork: its genesis snapshot and blocks 0..count-1 linked to
 * it, each resulting in one held snapshot and state.
 */
function storeHeadFork(storage: Storage, count: number) {
    const genesis = genesisSnapshot();
    const forkId = genesis.forkID;
    const headSnapshot = factory.stateSnapshot({ forkId });
    storage.stateSnapshots.storeStateSnapshot(genesis);
    storage.stateSnapshots.storeStateSnapshot(headSnapshot);
    storage.stateMachineStates.storeStateMachineState(factory.hexString(64), {
        hash: genesis.stateMachineStateHash
    });
    storage.stateMachineStates.storeStateMachineState(factory.hexString(64), {
        hash: headSnapshot.stateMachineStateHash
    });
    const blocks: Block[] = [];
    let previous: Hash = genesis.hash;
    for (let height = 0; height < count; height++) {
        const block = chainedBlock(forkId, height, previous, headSnapshot.hash);
        storage.blocks.storeBlock(block);
        blocks.push(block);
        previous = block.hash;
    }
    storage.stateSnapshots.storeHeadForkId(forkId);
    return { forkId, genesis, blocks };
}

describe("Storage reopen", function () {
    describe("round trips", function () {
        it("restores blocks at their coordinates with their on-chain timestamps", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            const block = factory.blockAt(forkId, 3);
            storage.blocks.storeBlock(block);
            storage.blocks.setOnChainTimestamp(block.hash, 1_700_000_000);

            storage = await reopen(database, storage);

            const restored = storage.blocks.getBlock(forkId, 3);
            expect(encodedBlock(restored)).to.equal(encodedBlock(block));
            expect(restored?.onChainTimestamp).to.equal(1_700_000_000);
            expect(storage.blocks.getBlock(block.hash)?.hash).to.equal(
                block.hash
            );
            await storage.close();
        });

        it("restores inbound and outbound message blocks with their heads", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const [inbound0, inbound1] = factory.linkedMessageBlocks(2);
            const outbound = factory.messageBlock({ blockHeight: 4n });
            const inboundHash = storage.inboundMessages.store(inbound0);
            const latestInboundHash = storage.inboundMessages.store(inbound1);
            const outboundHash = storage.outboundMessages.store(outbound);

            storage = await reopen(database, storage);

            expect(
                storage.inboundMessages.getMessageBlock(inboundHash)
            ).to.not.equal(undefined);
            expect(storage.inboundMessages.getLatestBlockHash()).to.equal(
                latestInboundHash
            );
            expect(storage.inboundMessages.getLatestBlockHeight()).to.equal(1);
            expect(storage.outboundMessages.getLatestBlockHash()).to.equal(
                outboundHash
            );
            expect(storage.outboundMessages.getLatestBlockHeight()).to.equal(4);
            expect(
                storage.outboundMessages.getMessageBlock(inboundHash)
            ).to.equal(undefined);
            await storage.close();
        });

        it("restores state snapshots under caller-supplied keys and the genesis index", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const genesis = genesisSnapshot();
            const synced = factory.stateSnapshot();
            const callerKey = factory.hash();
            storage.stateSnapshots.storeStateSnapshot(genesis);
            storage.stateSnapshots.storeStateSnapshot(synced, {
                hash: callerKey
            });

            storage = await reopen(database, storage);

            expect(
                storage.stateSnapshots.getGenesisSnapshotByForkId(
                    genesis.forkID
                )?.hash
            ).to.equal(genesis.hash);
            expect(
                storage.stateSnapshots.getStateSnapshotByHash(callerKey)?.hash
            ).to.equal(synced.hash);
            await storage.close();
        });

        it("restores the genesis index as memory held it after an earlier genesis is stored again", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const first = genesisSnapshot();
            const later = factory.stateSnapshot({
                snapshotData: first.snapshotData,
                forkId: first.forkID,
                blockHeight: first.blockHeight,
                timestamp: first.timestamp + 1
            });
            storage.stateSnapshots.storeStateSnapshot(first);
            storage.stateSnapshots.storeStateSnapshot(later);
            storage.stateSnapshots.storeStateSnapshot(first);
            const beforeReopen =
                storage.stateSnapshots.getGenesisSnapshotByForkId(
                    first.forkID
                )?.hash;

            storage = await reopen(database, storage);

            expect(beforeReopen).to.equal(later.hash);
            expect(
                storage.stateSnapshots.getGenesisSnapshotByForkId(first.forkID)
                    ?.hash
            ).to.equal(beforeReopen);
            await storage.close();
        });

        it("restores state machine states under caller-supplied keys", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const encodedState = factory.hexString(96);
            const callerKey = factory.hash();
            const derivedKey =
                storage.stateMachineStates.storeStateMachineState(encodedState);
            storage.stateMachineStates.storeStateMachineState(encodedState, {
                hash: callerKey
            });

            storage = await reopen(database, storage);

            expect(
                storage.stateMachineStates.getStateMachineState(derivedKey)
            ).to.equal(encodedState);
            expect(
                storage.stateMachineStates.getStateMachineState(callerKey)
            ).to.equal(encodedState);
            await storage.close();
        });

        it("restores participant change points per fork", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            storage.participantSetChanges.storeChangePoint(forkId, 7);
            storage.participantSetChanges.storeChangePoint(forkId, 2);

            storage = await reopen(database, storage);

            expect(
                storage.participantSetChanges.getChangePointsInRange(forkId)
            ).to.deep.equal([2, 7]);
            await storage.close();
        });

        it("restores disputes with their merged signatures and the disputed-fork markers", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const signedDispute = factory.signedDispute();
            const signature = ethers.hexlify(factory.signature());
            const disputeHash = storage.disputes.storeDispute(signedDispute);
            storage.disputes.storeDisputeConfirmation({
                signedDispute,
                signatures: [signature]
            });
            const forkId = factory.hash() as ForkId;
            storage.disputes.storeDisputedFork(forkId, true);

            storage = await reopen(database, storage);

            const restored =
                storage.disputes.getDisputeConfirmation(disputeHash);
            expect(restored?.signatures.map(ethers.hexlify)).to.deep.equal([
                signature
            ]);
            expect(
                ethers.hexlify(restored!.signedDispute.encodedDispute)
            ).to.equal(ethers.hexlify(signedDispute.encodedDispute));
            expect(storage.disputes.didIDispute(forkId)).to.equal(true);
            await storage.close();
        });

        it("restores fraud proofs", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const proof = factory.fraudProof();
            const proofHash = storage.fraudProofs.storeFraudProof(proof);

            storage = await reopen(database, storage);

            const restored = storage.fraudProofs.getFraudProofByHash(proofHash);
            expect(ethers.hexlify(restored!.encodedProof)).to.equal(
                ethers.hexlify(proof.encodedProof)
            );
            expect(restored!.participant).to.equal(proof.participant);
            await storage.close();
        });

        it("restores dispute fraud proofs", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const dispute = factory.dispute();
            const proof = factory.disputeFraudProof(dispute);
            storage.disputeFraudProofs.storeFraudProof(proof);

            storage = await reopen(database, storage);

            const restored =
                storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                );
            expect(ethers.hexlify(restored!.encodedProof)).to.equal(
                ethers.hexlify(proof.encodedProof)
            );
            await storage.close();
        });

        it("restores timeouts, the force-exit flag and the join record", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            const timeout = factory.dispute().input.timeout;
            storage.timeout.storeTimeout(forkId, timeout);
            storage.forceExit.setForceExit(true);
            const join = storage.forceJoin.startJoin(12, 1_800_000_000);

            storage = await reopen(database, storage);

            expect(
                ethers.hexlify(
                    Codec.encode(
                        storage.timeout.getTimeout(forkId)!,
                        Type.Timeout
                    )
                )
            ).to.equal(ethers.hexlify(Codec.encode(timeout, Type.Timeout)));
            expect(storage.forceExit.getForceExit()).to.equal(true);
            expect(storage.forceJoin.getJoin()).to.deep.equal(join);
            await storage.close();
        });

        it("restores block calldata and the event-sync cursor", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const block = factory.block();
            const calldata = {
                signedBlock: block.signedBlock,
                onChainTimestamp: 1_700_000_123
            };
            storage.blockCalldata.storeBlockCalldata(calldata);
            const channelId = factory.hash();
            storage.eventSync.storeLatestProcessedBlock(channelId, 4_321);

            storage = await reopen(database, storage);

            const restored =
                storage.blockCalldata.getMatchingBlockCalldata(block);
            expect(restored?.onChainTimestamp).to.equal(1_700_000_123);
            expect(
                storage.eventSync.getLatestProcessedBlock(channelId)
            ).to.equal(4_321);
            await storage.close();
        });
    });

    describe("derived state", function () {
        it("rebuilds the derived indexes on load: hash index, tip height, proof owner, message head and next join id", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            const blocks = [0, 1, 2].map((height) =>
                factory.blockAt(forkId, height)
            );
            for (const block of blocks) storage.blocks.storeBlock(block);
            const proof = factory.fraudProof();
            storage.fraudProofs.storeFraudProof(proof);
            const head = storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 9n })
            );
            const join = storage.forceJoin.startJoin(1, 1_800_000_000);

            storage = await reopen(database, storage);

            expect(storage.blocks.getBlock(blocks[1].hash)?.hash).to.equal(
                blocks[1].hash
            );
            expect(storage.blocks.getLatestBlockHeight(forkId)).to.equal(2);
            expect(
                storage.fraudProofs.getFraudProofForParticipant(
                    proof.participant as string
                )
            ).to.not.equal(undefined);
            expect(storage.inboundMessages.getLatestBlockHash()).to.equal(head);
            expect(storage.forceJoin.startJoin(2, 1_800_000_000).id).to.equal(
                join.id + 1
            );
            await storage.close();
        });

        it("keeps insertion order across a reopen: the first proof per participant stays first", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const participant = factory.randomAddress();
            const first = factory.fraudProof({ participant });
            const second = factory.fraudProof({ participant });
            storage.fraudProofs.storeFraudProof(first);
            storage.fraudProofs.storeFraudProof(second);
            const disputes = [factory.dispute(), factory.dispute()];
            for (const dispute of disputes)
                storage.disputeFraudProofs.storeFraudProof(
                    factory.disputeFraudProof(dispute)
                );

            storage = await reopen(database, storage);

            expect(
                ethers.hexlify(
                    storage.fraudProofs.getFraudProofForParticipant(
                        participant
                    )!.encodedProof
                )
            ).to.equal(ethers.hexlify(first.encodedProof));
            expect(
                storage.disputeFraudProofs
                    .getDisputeFraudProofs()
                    .map(({ dispute }) =>
                        ethers.hexlify(Codec.encode(dispute, Type.Dispute))
                    )
            ).to.deep.equal(
                disputes.map((dispute) =>
                    ethers.hexlify(Codec.encode(dispute, Type.Dispute))
                )
            );
            await storage.close();
        });

        it("writes in-place updates to disk: block merge, signature insert, on-chain timestamp, change point and join update", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            const block = factory.blockAt(forkId, 0);
            storage.blocks.storeBlock(block);
            await storage.flush();
            const merged = Block.fromBlockConfirmation({
                signedBlock: block.signedBlock,
                signatures: [signBlock(block)]
            });
            storage.blocks.storeBlock(merged);
            storage.blocks.insertSignature(signBlock(block), block.hash);
            storage.blocks.setOnChainTimestamp(block.hash, 1_700_000_001);
            storage.participantSetChanges.storeChangePoint(forkId, 1);
            storage.participantSetChanges.storeChangePoint(forkId, 5);
            const join = storage.forceJoin.startJoin(3, 1_800_000_000);
            storage.forceJoin.updateJoin(join.id, { isDisputeStarted: true });

            storage = await reopen(database, storage);

            const restored = storage.blocks.getBlock(block.hash)!;
            // the merged and the inserted signature
            expect(restored.confirmationSignatures.size).to.equal(2);
            expect(restored.onChainTimestamp).to.equal(1_700_000_001);
            expect(
                storage.participantSetChanges.getChangePointsInRange(forkId)
            ).to.deep.equal([1, 5]);
            expect(storage.forceJoin.getJoin()?.isDisputeStarted).to.equal(
                true
            );
            await storage.close();
        });

        it("restores the head fork when the replaced fork holds more blocks", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const replaced = storeHeadFork(storage, 6);
            const head = storeHeadFork(storage, 2);

            storage = await reopen(database, storage);

            expect(storage.stateSnapshots.getHeadForkId()).to.equal(
                head.forkId
            );
            expect(storage.blocks.getLatestBlockHeight(head.forkId)).to.equal(
                1
            );
            expect(
                storage.blocks.getLatestBlockHeight(replaced.forkId)
            ).to.equal(5);
            await storage.close();
        });

        it("reopens a store captured from a node that joined by synchronization", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            // a sync joiner holds blocks from its install point only, and the
            // snapshot and state of its head
            const forkId = factory.hash() as ForkId;
            const headSnapshot = factory.stateSnapshot({ forkId });
            storage.stateSnapshots.storeStateSnapshot(headSnapshot);
            storage.stateMachineStates.storeStateMachineState(
                factory.hexString(64),
                { hash: headSnapshot.stateMachineStateHash }
            );
            let previous: Hash = factory.hash();
            for (let height = 5; height <= 7; height++) {
                const block = chainedBlock(
                    forkId,
                    height,
                    previous,
                    headSnapshot.hash
                );
                storage.blocks.storeBlock(block);
                previous = block.hash;
            }
            storage.stateSnapshots.storeHeadForkId(forkId);

            storage = await reopen(database, storage);

            expect(storage.blocks.getLatestBlock(forkId)?.hash).to.equal(
                previous
            );
            await storage.close();
        });

        it("keeps state written by the timer when the runtime stops without closing", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database, 5);
            const forkId = factory.hash() as ForkId;
            const timeout = factory.dispute().input.timeout;
            const join = storage.forceJoin.startJoin(4, 1_800_000_000);
            storage.forceJoin.updateJoin(join.id, { countingStartsAt: 77 });
            storage.timeout.storeTimeout(forkId, timeout);
            await waitFor(
                () => database.batches.some((batch) => batch.committed),
                undefined,
                5
            );

            // no close: a second runtime opens what the first one left
            const restarted = await openStorage(database);

            expect(restarted.forceJoin.getJoin()?.countingStartsAt).to.equal(
                77
            );
            expect(restarted.timeout.getTimeout(forkId)).to.not.equal(
                undefined
            );
            await restarted.close();
        });
    });

    describe("tip rule", function () {
        it("does not advance the block tip for a block only ever stored for history", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            storage.blocks.storeBlock(factory.blockAt(forkId, 0));
            storage.blocks.storeBlock(factory.blockAt(forkId, 1), {
                justPersist: true
            });

            storage = await reopen(database, storage);

            expect(storage.blocks.getLatestBlockHeight(forkId)).to.equal(0);
            await storage.close();
        });

        it("advances the block tip for a block first stored normally", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            storage.blocks.storeBlock(factory.blockAt(forkId, 0));
            storage.blocks.storeBlock(factory.blockAt(forkId, 1));

            storage = await reopen(database, storage);

            expect(storage.blocks.getLatestBlockHeight(forkId)).to.equal(1);
            await storage.close();
        });

        it("keeps the block tip advanced for a block stored normally and then for history", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            const block = factory.blockAt(forkId, 1);
            storage.blocks.storeBlock(factory.blockAt(forkId, 0));
            storage.blocks.storeBlock(block);
            storage.blocks.storeBlock(block, { justPersist: true });

            storage = await reopen(database, storage);

            expect(storage.blocks.getLatestBlockHeight(forkId)).to.equal(1);
            await storage.close();
        });

        it("keeps the block tip back for a block stored for history and then normally", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const forkId = factory.hash() as ForkId;
            const block = factory.blockAt(forkId, 1);
            storage.blocks.storeBlock(factory.blockAt(forkId, 0));
            storage.blocks.storeBlock(block, { justPersist: true });
            storage.blocks.storeBlock(block);
            const heightBeforeRestart =
                storage.blocks.getLatestBlockHeight(forkId);

            storage = await reopen(database, storage);

            expect(heightBeforeRestart).to.equal(0);
            expect(storage.blocks.getLatestBlockHeight(forkId)).to.equal(0);
            await storage.close();
        });

        it("does not move the message head for a message block only ever stored for history", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const head = storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 0n })
            );
            storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 1n }),
                { justPersist: true }
            );

            storage = await reopen(database, storage);

            expect(storage.inboundMessages.getLatestBlockHash()).to.equal(head);
            await storage.close();
        });

        it("moves the message head for a message block first stored normally", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 0n })
            );
            const head = storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 1n })
            );

            storage = await reopen(database, storage);

            expect(storage.inboundMessages.getLatestBlockHash()).to.equal(head);
            await storage.close();
        });

        it("keeps the message head on a message block stored normally and then for history", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const messageBlock = factory.messageBlock({ blockHeight: 1n });
            storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 0n })
            );
            const head = storage.inboundMessages.store(messageBlock);
            storage.inboundMessages.store(messageBlock, { justPersist: true });

            storage = await reopen(database, storage);

            expect(storage.inboundMessages.getLatestBlockHash()).to.equal(head);
            await storage.close();
        });

        it("moves the message head when a message block stored for history is stored normally", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const messageBlock = factory.messageBlock({ blockHeight: 1n });
            storage.inboundMessages.store(
                factory.messageBlock({ blockHeight: 0n })
            );
            storage.inboundMessages.store(messageBlock, { justPersist: true });
            const head = storage.inboundMessages.store(messageBlock);

            storage = await reopen(database, storage);

            expect(storage.inboundMessages.getLatestBlockHash()).to.equal(head);
            await storage.close();
        });
    });

    describe("queue", function () {
        /** a queued network entry whose source supplied the author's signature and one confirmation */
        function queuedEntry(storage: Storage) {
            const block = factory.block();
            block.onChainTimestamp = 7;
            const confirmation = signBlock(block);
            const source = ethers.getAddress(String(factory.randomAddress()));
            storage.queues.restoreEntry({
                block,
                firstSeenAt: 11,
                origin: BlockOrigin.NETWORK,
                sourcesToSignatures: new Map([
                    [source, new Set([block.originalSignature, confirmation])]
                ])
            });
            return { block, confirmation, source };
        }

        it("restores a queued entry with its first-seen time, origin, sources and their signatures, and on-chain timestamp", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const { block, confirmation, source } = queuedEntry(storage);

            storage = await reopen(database, storage);

            const restored = storage.queues.getQueuedEntry(block.hash)!;
            expect(encodedBlock(restored.block)).to.equal(encodedBlock(block));
            expect(restored.block.onChainTimestamp).to.equal(7);
            expect(restored.firstSeenAt).to.equal(11);
            expect(restored.origin).to.equal(BlockOrigin.NETWORK);
            expect([...restored.sourcesToSignatures.keys()]).to.deep.equal([
                source
            ]);
            expect([
                ...restored.sourcesToSignatures.get(source)!
            ]).to.have.members([block.originalSignature, confirmation]);
            await storage.close();
        });

        it("rebuilds the coordinate index on load: a restored entry dequeues by its coordinates", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const { block } = queuedEntry(storage);

            storage = await reopen(database, storage);

            expect(
                storage.queues
                    .tryDequeueAt(block.forkId, block.height)
                    .map((entry) => entry.block.hash)
            ).to.deep.equal([block.hash]);
            await storage.close();
        });

        it("keeps a dequeued entry off the disk after a reopen", async () => {
            const database = new GatedMemoryLevel();
            let storage = await openStorage(database);
            const { block } = queuedEntry(storage);
            await storage.flush();
            storage.queues.tryDequeueAt(block.forkId, block.height);

            storage = await reopen(database, storage);

            expect(storage.queues.getQueuedEntry(block.hash)).to.equal(
                undefined
            );
            expect(
                storage.queues.tryDequeueAt(block.forkId, block.height)
            ).to.deep.equal([]);
            await storage.close();
        });

        it("writes an entry queued and dequeued in one window as one delete", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database, 60_000);
            const { block } = queuedEntry(storage);
            storage.queues.removeBlock(block.hash);

            await storage.flush();

            expect(
                database.batches.map(({ operations }) => operations)
            ).to.deep.equal([
                [{ type: "del", key: `records!v1!queues!${block.hash}` }]
            ]);
            await storage.close();
        });
    });

    describe("fail closed", function () {
        it("refuses an undecodable record at the head, naming the partition and key", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database);
            const { forkId } = storeHeadFork(storage, 3);
            await storage.close();
            const headKey = `records!v1!blocks!${forkId}:2`;
            await database.open();
            await database.put(headKey, "0xdead");
            await database.close();

            const error = await openError(database);

            expect(error.message).to.include(`blocks record ${forkId}:2`);
            expect(error.message).to.include("memory:gated");
            expect(database.status).to.equal("closed");
        });

        it("refuses an undecodable record in the middle of the history", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database);
            const { forkId } = storeHeadFork(storage, 4);
            await storage.close();
            await database.open();
            await database.put(`records!v1!blocks!${forkId}:1`, "0x00");
            await database.close();

            const error = await openError(database);

            expect(error.message).to.include(`blocks record ${forkId}:1`);
            expect(database.status).to.equal("closed");
        });

        it("refuses a gap in the head fork's stored blocks", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database);
            const { forkId, blocks } = storeHeadFork(storage, 4);
            storage.blocks.deleteBlock(blocks[1].hash);
            await storage.close();

            const reopened = new Storage();
            const error = await openError(database, reopened);

            expect(error.message).to.include(`misses block 1`);
            expect(error.message).to.include(String(forkId));
            expect(error.message).to.include("memory:gated");
            expect(database.status).to.equal("closed");
            await expectRefusalReleased(reopened, forkId);
        });

        it("refuses a head-fork block that does not link to the block below it", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database);
            const { forkId, blocks } = storeHeadFork(storage, 2);
            storage.blocks.storeBlock(
                chainedBlock(
                    forkId,
                    2,
                    factory.hash(),
                    blocks[1].stateSnapshotHash
                )
            );
            await storage.close();

            const reopened = new Storage();
            const error = await openError(database, reopened);

            expect(error.message).to.include(
                `${forkId}:2 does not link to the block below it`
            );
            expect(database.status).to.equal("closed");
            await expectRefusalReleased(reopened, forkId);
        });

        it("refuses a head fork without the snapshot and state of its latest block", async () => {
            const database = new GatedMemoryLevel();
            const storage = await openStorage(database);
            const { forkId } = storeHeadFork(storage, 1);
            storage.blocks.storeBlock(
                chainedBlock(
                    forkId,
                    1,
                    storage.blocks.getBlock(forkId, 0)!.hash,
                    factory.hash()
                )
            );
            await storage.close();

            const reopened = new Storage();
            const error = await openError(database, reopened);

            expect(error.message).to.include(
                "has no snapshot and state at height 1"
            );
            expect(database.status).to.equal("closed");
            await expectRefusalReleased(reopened, forkId);
        });
    });
});
