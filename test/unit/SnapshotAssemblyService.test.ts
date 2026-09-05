import { expect } from "chai";
import { addressesEqual, Codec, Type, hash } from "@/utils";
import { StateSnapshot } from "@/models";
import { MathTestSession as TestSession } from "@test/harness";
import * as factory from "../factory";
import { hash as randomHash } from "../factory";

// assembly is driven through real authored blocks: the resulting snapshot is
// read back and compared against the previous one. inbound/outbound branches
// need real deposits and withdrawals, so they ride a join and a leave.

describe("Unit: SnapshotAssemblyService", function () {
    describe("createStateSnapshot", function () {
        it("no inbound, no outbound → previous snapshot data carried forward", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1
            const forkId = h.activeForkId!;

            const read = async (height: number) => {
                const r = await h
                    .control(h.getPeer(0))
                    .query.getStateSnapshotStructAt(forkId, height)
                    .request();
                return StateSnapshot.from(
                    Codec.decode(r!.encodedSnapshot, Type.StateSnapshot)
                );
            };

            const previous = await read(0);
            const resulting = await read(1);

            // everything the transition didn't touch is inherited verbatim
            expect(resulting.snapshotData.originForkId).to.equal(
                previous.snapshotData.originForkId
            );
            expect(
                Number(resulting.snapshotData.totalDeposits.amount)
            ).to.equal(Number(previous.snapshotData.totalDeposits.amount));
            expect(
                Number(resulting.snapshotData.totalWithdrawals.amount)
            ).to.equal(Number(previous.snapshotData.totalWithdrawals.amount));
            expect(resulting.latestInboundMessageBlockHash).to.equal(
                previous.latestInboundMessageBlockHash
            );
            expect(resulting.latestOutboundMessageBlockHash).to.equal(
                previous.latestOutboundMessageBlockHash
            );
            // and the state machine hash did move
            expect(resulting.stateMachineStateHash).to.not.equal(
                previous.stateMachineStateHash
            );
            expect(Number(resulting.blockHeight)).to.equal(1);
        });

        it("a real leave withdraws → outbound block height and total withdrawals both advance", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const read = async (peerIndex: number, height: number) => {
                const r = await h
                    .control(h.getPeer(peerIndex))
                    .query.getStateSnapshotStructAt(forkId, height)
                    .request();
                return StateSnapshot.from(
                    Codec.decode(r!.encodedSnapshot, Type.StateSnapshot)
                );
            };

            const beforeHeight =
                (await h
                    .control(h.getPeer(0))
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const before = await read(0, beforeHeight);

            const leaverIndex = await h.transition.participantLeaveWait();
            const observer = h.peers.find((p) => p.index !== leaverIndex)!;

            const afterHeight =
                (await h
                    .control(observer)
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const after = await read(observer.index, afterHeight);

            // the leaver's balance leaves the channel as an outbound message
            expect(
                Number(after.latestOutboundMessageBlockHeight)
            ).to.be.greaterThan(
                Number(before.latestOutboundMessageBlockHeight)
            );
            expect(after.latestOutboundMessageBlockHash).to.not.equal(
                before.latestOutboundMessageBlockHash
            );
            expect(
                Number(after.snapshotData.totalWithdrawals.amount)
            ).to.be.greaterThan(
                Number(before.snapshotData.totalWithdrawals.amount)
            );
        });

        it("a real join deposits → inbound hash, height and total deposits come from the consumed block", async function () {
            const h = TestSession.getHarness();
            await h.scenario.spectatorPromotedViaJoinChannelWait();
            const forkId = h.activeForkId!;

            // the join's inbound block is the storage head; consuming it must
            // copy that head into the snapshot verbatim
            const pendingHash = await h
                .control(h.getPeer(0))
                .query.getLatestInboundMessageHash()
                .request();
            const pendingHeight = await h
                .control(h.getPeer(0))
                .query.getInboundLatestHeight()
                .request();
            expect(pendingHash, "join produced an inbound block").to.not.be
                .null;

            const height =
                (await h
                    .control(h.getPeer(0))
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const r = await h
                .control(h.getPeer(0))
                .query.getStateSnapshotStructAt(forkId, height)
                .request();
            const snapshot = StateSnapshot.from(
                Codec.decode(r!.encodedSnapshot, Type.StateSnapshot)
            );

            expect(snapshot.latestInboundMessageBlockHash).to.equal(
                pendingHash
            );
            expect(Number(snapshot.latestInboundMessageBlockHeight)).to.equal(
                pendingHeight
            );
            // deposits are taken from the consumed block's running total, not summed here
            expect(
                Number(snapshot.snapshotData.totalDeposits.amount)
            ).to.be.greaterThan(0);
        });
    });

    describe("getPreviousStateSnapshotOrThrow", function () {
        it("unknown fork → throws instead of assembling against nothing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const outcome = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    try {
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            { forkId: args.forkId, height: 1 }
                        );
                        return "no throw";
                    } catch (e) {
                        return e instanceof Error ? e.message : String(e);
                    }
                },
                { forkId: randomHash() }
            );

            expect(outcome).to.contain("previousStateSnapshot undefined");
        });
    });

    describe("assembleFromTransaction", function () {
        it("the writer's real transaction → snapshot at the next height binding the post-inbound state, no participant changes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const height = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            const timestamp = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add.populateTransaction(1);

            // plain-number header fields so the struct crosses the port raw
            const tx = factory.transaction({
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: height,
                    participant: writer.address,
                    timestamp
                },
                body: { encodedData: call.data, data: call.data }
            });

            const r = await h.execOnHost(
                h.getPeer(writer.index),
                async (sm, args) => {
                    const coordinates = {
                        forkId: args.forkId,
                        height: args.height
                    };
                    const previous =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            coordinates
                        );
                    const inbound =
                        sm.blockProductionService[
                            "getPendingInboundMessageBlocks"
                        ](previous);
                    const assembled =
                        await sm.snapshotAssemblyService.assembleFromTransaction(
                            coordinates,
                            args.tx,
                            previous,
                            inbound,
                            args.timestamp
                        );
                    if (!assembled.success) return { success: false as const };
                    return {
                        success: true as const,
                        snapshotHeight: Number(
                            assembled.stateSnapshot.blockHeight
                        ),
                        stateMachineStateHash: String(
                            assembled.stateSnapshot.stateMachineStateHash
                        ),
                        stateAfterInbound: String(assembled.stateAfterInbound),
                        joined: assembled.participantChanges.joined.size,
                        left: assembled.participantChanges.left.size
                    };
                },
                { forkId, height, timestamp, tx },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );

            expect(r.success).to.equal(true);
            if (!r.success) return;
            expect(r.snapshotHeight).to.equal(height);
            // the snapshot binds exactly the state the inbound application produced
            expect(hash(r.stateAfterInbound)).to.equal(r.stateMachineStateHash);
            expect(r.joined).to.equal(0);
            expect(r.left).to.equal(0);
        });

        // pinned: applyTransaction's success mirrors the state machine's own
        // header check, so the same calldata succeeds for the writer whose
        // turn it is and fails for anyone else.
        it("writer's own turn → success and a new state hash; another peer's header → success false", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const other = h.peers.find((p) => p.index !== writer.index)!;

            const stateHashBefore = await h
                .control(writer)
                .query.getLatestStateMachineStateHash(forkId)
                .request();
            const height = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            const timestamp = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add.populateTransaction(1);

            const encode = (participant: typeof writer.address) =>
                Codec.encode(
                    factory.transaction({
                        header: {
                            channelId: h.channelId,
                            forkId,
                            transactionCnt: height,
                            participant,
                            timestamp
                        },
                        body: { encodedData: call.data, data: call.data }
                    }),
                    Type.Transaction
                ) as string;

            const applied = await h
                .control(writer)
                .byzantine.applyTransactionStateHash(encode(writer.address))
                .request();
            expect(applied.success).to.equal(true);
            expect(applied.stateSnapshotHash).to.not.equal(stateHashBefore);

            const rejected = await h
                .control(other)
                .byzantine.applyTransactionStateHash(encode(other.address))
                .request();
            expect(rejected.success).to.equal(false);
        });

        it("a transaction the state machine refuses → { success: false } and nothing else computed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const other = h.peers.find((p) => p.index !== writer.index)!;
            const height = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            const timestamp = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add.populateTransaction(1);

            // another participant's header on the writer's host -> the state
            // machine refuses the transition
            const tx = factory.transaction({
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: height,
                    participant: other.address,
                    timestamp
                },
                body: { encodedData: call.data, data: call.data }
            });

            const r = await h.execOnHost(
                h.getPeer(writer.index),
                async (sm, args) => {
                    const coordinates = {
                        forkId: args.forkId,
                        height: args.height
                    };
                    const previous =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            coordinates
                        );
                    const assembled =
                        await sm.snapshotAssemblyService.assembleFromTransaction(
                            coordinates,
                            args.tx,
                            previous,
                            [],
                            args.timestamp
                        );
                    return { success: assembled.success };
                },
                { forkId, height, timestamp, tx },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );
            expect(r.success).to.equal(false);
        });

        it("pending inbound blocks supplied → the snapshot binds their head and carries their deposits", async function () {
            const h = TestSession.getHarness();
            // the timeConfig the promotion scenario needs to keep a 2-peer
            // channel serving the spectator's sync
            await h.lifecycle.start(2, 2, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 4,
                    chainFallbackTime: 4,
                    evidenceTime: 6
                }
            });
            const forkId = h.activeForkId!;
            // The assembly under test starts after the join; the channel keeps
            // authoring while the joiner syncs, so the writer slot never idles
            // into a timeout dispute that would refuse the join.
            const { peer: joiner } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 1,
                maximumBlocks: 20,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();
            await h.join.joinChannelWait({ joiner });

            const writer = await h.query.getNextPeerToWrite();
            const pendingHash = await h
                .control(writer)
                .query.getLatestInboundMessageHash()
                .request();
            expect(pendingHash, "join produced a pending inbound block").to.not
                .be.null;
            const height = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            const timestamp = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add.populateTransaction(1);
            const tx = factory.transaction({
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: height,
                    participant: writer.address,
                    timestamp
                },
                body: { encodedData: call.data, data: call.data }
            });

            const r = await h.execOnHost(
                h.getPeer(writer.index),
                async (sm, args) => {
                    const coordinates = {
                        forkId: args.forkId,
                        height: args.height
                    };
                    const previous =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            coordinates
                        );
                    const inbound =
                        sm.blockProductionService[
                            "getPendingInboundMessageBlocks"
                        ](previous);
                    const assembled =
                        await sm.snapshotAssemblyService.assembleFromTransaction(
                            coordinates,
                            args.tx,
                            previous,
                            inbound,
                            args.timestamp
                        );
                    if (!assembled.success) return { success: false as const };
                    return {
                        success: true as const,
                        inboundCount: inbound.length,
                        snapshotInboundHash: String(
                            assembled.stateSnapshot
                                .latestInboundMessageBlockHash
                        ),
                        snapshotDeposits: Number(
                            assembled.stateSnapshot.snapshotData.totalDeposits
                                .amount
                        ),
                        previousDeposits: Number(
                            previous.snapshotData.totalDeposits.amount
                        )
                    };
                },
                { forkId, height, timestamp, tx },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );

            expect(r.success).to.equal(true);
            if (!r.success) return;
            expect(r.inboundCount).to.be.greaterThan(0);
            // the snapshot binds exactly the pending head the join produced
            expect(r.snapshotInboundHash).to.equal(pendingHash);
            expect(r.snapshotDeposits).to.be.greaterThan(r.previousDeposits);
        });

        it("a leave → participantChanges.left names the leaver and an outbound block is built", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const height = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            const timestamp = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.leaveChannel.populateTransaction();
            const tx = factory.transaction({
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: height,
                    participant: writer.address,
                    timestamp
                },
                body: { encodedData: call.data, data: call.data }
            });

            const r = await h.execOnHost(
                h.getPeer(writer.index),
                async (sm, args) => {
                    const coordinates = {
                        forkId: args.forkId,
                        height: args.height
                    };
                    const previous =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            coordinates
                        );
                    const assembled =
                        await sm.snapshotAssemblyService.assembleFromTransaction(
                            coordinates,
                            args.tx,
                            previous,
                            [],
                            args.timestamp
                        );
                    if (!assembled.success) return { success: false as const };
                    return {
                        success: true as const,
                        left: Array.from(assembled.participantChanges.left).map(
                            String
                        ),
                        joined: assembled.participantChanges.joined.size,
                        hasOutboundBlock:
                            assembled.outboundMessageBlock !== undefined
                    };
                },
                { forkId, height, timestamp, tx },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );

            expect(r.success).to.equal(true);
            if (!r.success) return;
            expect(
                r.left.some((a) => addressesEqual(a, writer.address))
            ).to.equal(true);
            expect(r.joined).to.equal(0);
            expect(r.hasOutboundBlock).to.equal(true);
        });

        it("an inbound block the state machine cannot process → the assembly throws", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const height = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            const timestamp = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const call = await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add.populateTransaction(1);
            const tx = factory.transaction({
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: height,
                    participant: writer.address,
                    timestamp
                },
                body: { encodedData: call.data, data: call.data }
            });
            // well-formed inbound block whose message the state machine has no
            // handler for
            const junkInbound = {
                previousBlockHash: factory.zeroHash(),
                blockHeight: 1,
                messages: [
                    {
                        messageType: factory.hash(),
                        participant: writer.address,
                        balance: { amount: 0, data: "0x" },
                        data: "0x"
                    }
                ],
                totalBalance: { amount: 0, data: "0x" },
                timestamp
            };

            const outcome = await h.execOnHost(
                h.getPeer(writer.index),
                async (sm, args) => {
                    const coordinates = {
                        forkId: args.forkId,
                        height: args.height
                    };
                    const previous =
                        sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                            coordinates
                        );
                    try {
                        await sm.snapshotAssemblyService.assembleFromTransaction(
                            coordinates,
                            args.tx,
                            previous,
                            [args.junkInbound],
                            args.timestamp
                        );
                        return "no throw";
                    } catch (e) {
                        return e instanceof Error ? e.message : String(e);
                    }
                },
                { forkId, height, timestamp, tx, junkInbound },
                {
                    timeoutMs: h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                }
            );

            expect(outcome).to.contain("Failed to process inbound message");
        });
    });
});
