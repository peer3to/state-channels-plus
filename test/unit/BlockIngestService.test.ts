import { expect } from "chai";
import { Codec, Type } from "@/utils";
import {
    MathPeerTestHarness,
    MathTestSession as TestSession
} from "@test/harness";
import * as factory from "../factory";
import type { Address, ForkId, Hash } from "@/types/types";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

// the pipeline is entered the way production does: through the queue
// (transition.ingestBlockConfirmation) or, for callers with no transport, by
// handing a confirmation straight to onBlockConfirmationStruct.

// a genuinely authored, linked next block - only its stateSnapshotHash (the
// factory's random default) is wrong, so it dies at the state-transition gate
async function encodeLinkedNextBlock(
    h: MathPeerTestHarness,
    writerIndex: number,
    observerIndex: number,
    forkId: ForkId,
    messageBlocks?: MessageBlockStruct[]
) {
    const writer = h.getPeer(writerIndex);
    const observer = h.getPeer(observerIndex);
    const bundle = await h
        .control(observer)
        .query.getLatestBlockBundle(forkId)
        .request();
    const height = await h
        .control(observer)
        .query.getNextBlockHeight(forkId)
        .request();
    const call =
        await writer.p2pInstance.p2pContractInstance.add.populateTransaction(1);

    return factory.buildAndEncodeBlock(writer.signer, {
        header: {
            channelId: h.channelId,
            forkId,
            transactionCnt: height,
            participant: writer.address as Address,
            // inside the previous block's p2pTime window regardless of how
            // long the test staging took
            timestamp: bundle!.timestamp + 1
        },
        transaction: factory.transaction({
            body: {
                encodedData: call.data,
                data: call.data
            }
        }),
        previousBlockHash: bundle!.hash,
        ...(messageBlocks ? { messageBlocks } : {})
    });
}

describe("Unit: BlockIngestService", function () {
    describe("isKnownStaleFork", function () {
        it("current fork, zero hash and an invented fork → all not stale", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const verdicts = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => ({
                    current: await sm.validationService.isKnownStaleFork(
                        sm.forkId
                    ),
                    zero: await sm.validationService.isKnownStaleFork(
                        args.zero
                    ),
                    invented: await sm.validationService.isKnownStaleFork(
                        args.invented
                    )
                }),
                {
                    zero: factory.zeroHash(),
                    invented: factory.hash()
                }
            );

            // an unknown fork must stay "not stale" so it is sync-probed
            // instead of silently dropped
            expect(verdicts.current).to.equal(false);
            expect(verdicts.zero).to.equal(false);
            expect(verdicts.invented).to.equal(false);
        });

        it("the fork we left behind after a dispute → stale", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 3 });
            const oldForkId = h.activeForkId!;

            await h.byzantine.submitInvalidStateTransitionBlock(2);
            await h.assert.dispute.initiatedAndCommitedWait();
            await h.dispute.resolveDisputeWait({ forkId: oldForkId });

            const observer = h.peers.find((p) => p.index !== 2)!;
            const stale = await h.execOnHost(
                observer,
                async (sm, args) =>
                    sm.validationService.isKnownStaleFork(args.oldForkId),
                { oldForkId }
            );

            expect(stale).to.equal(true);
        });

        it("a non-current fork whose genesis snapshot we hold → stale", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const stale = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const next = sm.storage.blocks.getNextBlockHeight(
                        args.forkId
                    );
                    const model =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            { forkId: args.forkId, height: next }
                        );
                    // a genesis fork id IS the hash of its snapshot data;
                    // the StateSnapshot class is reached through the live
                    // instance (closures are closure-free)
                    const otherForkId = model.snapshotDataHash;
                    const SnapshotC = model.constructor as unknown as {
                        from: (s: unknown) => NonNullable<typeof model>;
                    };
                    sm.storage.stateSnapshots.storeStateSnapshot(
                        SnapshotC.from({
                            forkId: otherForkId,
                            blockHeight: 0,
                            timestamp: model.timestamp,
                            snapshotData: model.snapshotData
                        })
                    );
                    return await sm.validationService.isKnownStaleFork(
                        otherForkId
                    );
                },
                { forkId }
            );

            // a fork we recognize from our own history is known past ->
            // silently droppable, no sync probe
            expect(stale).to.equal(true);
        });

        it("a non-current fork we hold a block of → stale", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const bundle = await h
                .control(h.getPeer(0))
                .query.getLatestBlockBundle(forkId)
                .request();
            const signedBlock = Codec.decode(
                bundle!.encodedSignedBlock,
                Type.SignedBlock
            );
            const blockStruct = Codec.decode(
                String(signedBlock.encodedBlock),
                Type.Block
            );
            const otherForkId = factory.hash();
            blockStruct.transaction.header.forkId = otherForkId;
            const confirmation = {
                signedBlock: {
                    encodedBlock: Codec.encode(blockStruct, Type.Block),
                    signature: signedBlock.signature
                },
                signatures: [] as string[]
            };

            const stale = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const stored = sm.storage.blocks.getLatestBlock(
                        args.forkId
                    );
                    const BlockC = stored!.constructor as unknown as {
                        fromBlockConfirmation: (
                            c: unknown
                        ) => NonNullable<typeof stored>;
                    };
                    sm.storage.blocks.storeBlock(
                        BlockC.fromBlockConfirmation(args.confirmation)
                    );
                    return await sm.validationService.isKnownStaleFork(
                        args.otherForkId
                    );
                },
                { forkId, otherForkId, confirmation }
            );

            expect(stale).to.equal(true);
        });
    });

    describe("onBlockConfirmation → an already stored block", function () {
        it("the same confirmation ingested twice → accepted, signatures unchanged", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            await h.assert.sync.peersInSyncWait();

            const observer = h.getPeer(0);
            const stored = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();
            const signaturesBefore = [
                ...stored!.confirmationSignerAddresses
            ].sort();

            const accepted = await h
                .control(observer)
                .transition.ingestBlockConfirmation(
                    stored!.encodedBlockConfirmation
                )
                .request();

            const after = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();

            expect(accepted).to.equal(true);
            expect(
                [...after!.confirmationSignerAddresses].sort()
            ).to.deep.equal(signaturesBefore);
            // a duplicate is not a peer fault
            expect(
                await h
                    .control(observer)
                    .query.isBlacklisted(h.getPeer(1).address)
                    .request()
            ).to.equal(false);
        });

        it("a confirmation carrying an on-chain timestamp → the stored block records it", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            await h.assert.sync.peersInSyncWait();

            const observer = h.getPeer(0);
            const stored = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();
            expect(stored!.onChainTimestamp).to.equal(null);

            const onChainTimestamp = await h
                .control(observer)
                .query.getClockTimeInSeconds()
                .request();

            await h
                .control(observer)
                .transition.ingestBlockConfirmation(
                    stored!.encodedBlockConfirmation,
                    { onChainTimestamp }
                )
                .request();

            const after = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();
            expect(after!.onChainTimestamp).to.equal(onChainTimestamp);
        });

        // no test here: the stray-signature merge and its blacklisting is
        // E2E-BlockQueueManager's "queued entry that becomes stored merges at
        // queue timeout: strays stripped, supplier blacklisted".
        it.skip("stray signatures on a stored block → stripped and supplier cut", function () {});
    });

    describe("onBlockConfirmationStruct", function () {
        it("a sourceless bad confirmation → rejected without cutting any peer", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const observer = h.getPeer(0);

            // authentic signature, but the author is not in the channel
            const outsider = factory.randomWallet();
            const encoded = await factory.buildAndEncodeBlock(outsider, {
                header: {
                    channelId: h.channelId,
                    forkId: h.activeForkId!,
                    transactionCnt: 1,
                    participant: outsider.address as Address
                }
            });
            const blockConfirmation = Codec.decode(
                encoded,
                Type.BlockConfirmation
            );

            const accepted = await h.execOnHost(
                observer,
                async (sm, args) =>
                    sm.blockIngestService.onBlockConfirmationStruct(
                        args.blockConfirmation
                    ),
                { blockConfirmation },
                { timeoutMs: 20000 }
            );

            expect(accepted).to.equal(false);
            // no transport supplied it, so there is nobody to punish
            for (const peer of h.peers) {
                expect(
                    await h
                        .control(observer)
                        .query.isBlacklisted(peer.address)
                        .request()
                ).to.equal(false);
            }
        });
    });

    describe("onBlockConfirmation → carried inbound message blocks", function () {
        it("a run linked to a held inbound block → the store head advances with the snapshot", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const forkId = h.activeForkId!;

            // held after the channel-open inbound block landed -> peer 2 holds
            // inbound block 1, only the top-up chain event is withheld
            const lagging = 2;
            const held = await h.rpcStub.holdInboundMessageEvents(lagging);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address,
                observePeerIndices: [0, 1]
            });
            // two writers -> at least one non-lagging author carries the top-up
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();

            const r = await h.execOnHost(
                h.getPeer(lagging),
                async (sm, args) => {
                    const next = sm.storage.blocks.getNextBlockHeight(
                        args.forkId
                    );
                    const snapshot =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            { forkId: args.forkId, height: next }
                        );
                    return {
                        storedHash:
                            sm.storage.inboundMessages.getLatestBlockHash() ??
                            null,
                        storedHeight: Number(
                            sm.storage.inboundMessages.getLatestBlockHeight() ??
                                0
                        ),
                        snapshotHash: snapshot.latestInboundMessageBlockHash,
                        snapshotHeight: Number(
                            snapshot.latestInboundMessageBlockHeight
                        )
                    };
                },
                { forkId }
            );

            // premise - the chain event really never landed on this peer
            expect(await held.heldCount()).to.be.greaterThan(0);
            // premise - the blocks it ingested carried the top-up
            expect(r.snapshotHeight).to.equal(2);
            expect(r.storedHash).to.equal(r.snapshotHash);
            expect(r.storedHeight).to.equal(r.snapshotHeight);
        });

        it("runs with no reachable ancestor → persisted, the head never moves above the gap", async function () {
            const h = TestSession.getHarness();
            await h.setup(3);
            // held from before the channel opens -> peer 2 never stores inbound
            // block 1, so a run starting at block 2 links to nothing it holds
            const lagging = 2;
            const held = await h.rpcStub.holdInboundMessageEvents(lagging);
            await h.lifecycle.openChannel();
            const forkId = h.activeForkId!;
            const synced = h.control(h.getPeer(0));

            // round 1 - a run linked to inbound block 1, which the gapped peer
            // does not hold at all
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address,
                observePeerIndices: [0, 1]
            });
            const firstTopUpHash = (await synced.query
                .getLatestInboundMessageHash()
                .request()) as Hash;
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();

            // round 2 - a run linked to the block round 1 just persisted: held
            // in the map, but itself sitting above the missing block 1
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address,
                observePeerIndices: [0, 1]
            });
            const secondTopUpHash = (await synced.query
                .getLatestInboundMessageHash()
                .request()) as Hash;
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();

            const r = await h.execOnHost(
                h.getPeer(lagging),
                async (sm, args) => {
                    const next = sm.storage.blocks.getNextBlockHeight(
                        args.forkId
                    );
                    const snapshot =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            { forkId: args.forkId, height: next }
                        );
                    return {
                        storedHash:
                            sm.storage.inboundMessages.getLatestBlockHash() ??
                            null,
                        snapshotHash: snapshot.latestInboundMessageBlockHash,
                        snapshotHeight: Number(
                            snapshot.latestInboundMessageBlockHeight
                        ),
                        // both carried runs are looked up by hash even though
                        // the head did not move to either
                        firstRunPersisted:
                            sm.storage.inboundMessages.getMessageBlock(
                                args.firstTopUpHash
                            ) !== undefined,
                        secondRunPersisted:
                            sm.storage.inboundMessages.getMessageBlock(
                                args.secondTopUpHash
                            ) !== undefined,
                        // walking back from the head must not hit the gap
                        rangeLength:
                            sm.storage.inboundMessages.getMessageBlocksInRange()
                                .length
                    };
                },
                { forkId, firstTopUpHash, secondTopUpHash }
            );

            expect(await held.heldCount()).to.be.greaterThan(0);
            // premise - two distinct top-ups, and the pinned snapshot sits on
            // the second one
            expect(firstTopUpHash).to.not.equal(secondTopUpHash);
            expect(r.snapshotHash).to.equal(secondTopUpHash);
            expect(r.snapshotHeight).to.equal(3);
            expect(r.firstRunPersisted).to.equal(true);
            expect(r.secondRunPersisted).to.equal(true);
            // holding the link block is not reaching it -> moving the head
            // onto either run puts it above the missing block 1
            expect(r.storedHash).to.equal(null);
            expect(r.rangeLength).to.equal(0);
        });
    });

    describe("onBlockConfirmation → reject paths (full pipeline probe)", function () {
        it("a linked writer block with a wrong snapshot hash → invalid transition, VM turn restored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const writer = await h.query.getNextPeerToWrite();
            const observer = h.peers.find((p) => p.index !== writer.index)!;

            const encoded = await encodeLinkedNextBlock(
                h,
                writer.index,
                observer.index,
                forkId
            );

            const turnBefore = await h
                .control(observer)
                .query.getNextToWrite()
                .request();
            const probe = await h
                .control(observer)
                .stub.runBlockIngest(encoded)
                .request();
            const turnAfter = await h
                .control(observer)
                .query.getNextToWrite()
                .request();

            expect(probe.keepConnection).to.equal(false);
            expect(probe.firedHooks).to.include(
                "invalidStateTransitionDetected"
            );
            // the rewind's projection: the transition rotated the VM's turn
            // index past the writer; the restore puts it back
            expect(turnAfter).to.equal(turnBefore);
        });

        it("a forged inbound message block → forged hook fires, block rejected", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const writer = await h.query.getNextPeerToWrite();
            const observer = h.peers.find((p) => p.index !== writer.index)!;

            const bundle = await h
                .control(observer)
                .query.getLatestBlockBundle(forkId)
                .request();
            const height = await h
                .control(observer)
                .query.getNextBlockHeight(forkId)
                .request();
            // inside the previous block's p2pTime window regardless of how
            // long the test staging took
            const timestamp = bundle!.timestamp + 1;
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add.populateTransaction(1);
            // chains correctly from the previous snapshot's real inbound head
            // (so the chain check passes), but no peer stores it and the chain
            // has no commitment for it -> invented
            const prevSnapRes = await h
                .control(observer)
                .query.getStateSnapshotStructAt(forkId, height - 1)
                .request();
            const prevSnap = Codec.decode(
                prevSnapRes!.encodedSnapshot,
                Type.StateSnapshot
            );
            const forgedInbound = {
                previousBlockHash:
                    prevSnap.snapshotData.latestInboundMessageBlockHash ??
                    factory.zeroHash(),
                blockHeight:
                    Number(
                        prevSnap.snapshotData.latestInboundMessageBlockHeight ??
                            0
                    ) + 1,
                messages: [],
                totalBalance: { amount: 0, data: "0x" },
                timestamp
            };
            const encoded = await factory.buildAndEncodeBlock(
                h.getPeer(writer.index).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId,
                        transactionCnt: height,
                        participant: writer.address as Address,
                        timestamp
                    },
                    transaction: factory.transaction({
                        body: {
                            encodedData: call.data,
                            data: call.data
                        }
                    }),
                    previousBlockHash: bundle!.hash,
                    messageBlocks: [forgedInbound]
                }
            );

            const probe = await h
                .control(observer)
                .stub.runBlockIngest(encoded)
                .request();

            expect(probe.keepConnection).to.equal(false);
            expect(probe.firedHooks).to.include(
                "forgedInboundMessageBlockDetected"
            );
        });

        it("a rejected block carrying a real inbound run → the run is not stored, the head stays put", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const writer = await h.query.getNextPeerToWrite();
            const observer = h.peers.find((p) => p.index !== writer.index)!;
            const synced = h.peers.find(
                (p) => p.index !== observer.index && p.index !== writer.index
            )!;

            // the observer stops learning inbound blocks from the chain -> the
            // top-up reaches it only via the block it is about to reject
            const held = await h.rpcStub.holdInboundMessageEvents(
                observer.index
            );
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address,
                observePeerIndices: [writer.index, synced.index]
            });
            const topUpHash = (await h
                .control(synced)
                .query.getLatestInboundMessageHash()
                .request()) as Hash;
            const topUp = Codec.decode(
                (await h
                    .control(synced)
                    .query.getInboundMessageBlock(topUpHash)
                    .request())!.encodedMessageBlock,
                Type.MessageBlock
            );

            const headBefore = await h
                .control(observer)
                .query.getLatestInboundMessageHash()
                .request();
            // premise - the observer's head is the channel-open block, and the
            // top-up is a real on-chain block it does not hold
            expect(headBefore).to.not.equal(null);
            expect(headBefore).to.not.equal(topUpHash);
            expect(
                await h
                    .control(observer)
                    .query.getInboundMessageBlock(topUpHash)
                    .request()
            ).to.equal(null);

            // carries the chain's real top-up
            const encoded = await encodeLinkedNextBlock(
                h,
                writer.index,
                observer.index,
                forkId,
                [topUp]
            );

            const probe = await h
                .control(observer)
                .stub.runBlockIngest(encoded)
                .request();
            const headAfter = await h
                .control(observer)
                .query.getLatestInboundMessageHash()
                .request();
            const runStored = await h
                .control(observer)
                .query.getInboundMessageBlock(topUpHash)
                .request();

            expect(await held.heldCount()).to.be.greaterThan(0);
            expect(probe.keepConnection).to.equal(false);
            expect(probe.firedHooks).to.include(
                "invalidStateTransitionDetected"
            );
            // a rejected block leaves no trace: nothing to move the head onto,
            // and nothing for detectForgedInboundMessageBlock to accept later
            // as "already in our store"
            expect(headAfter).to.equal(headBefore);
            expect(runStored).to.equal(null);
        });
    });
});
