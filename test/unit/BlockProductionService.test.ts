import { expect } from "chai";
import { Codec, Type } from "@/utils";
import { Block } from "@/models";
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { sleep } from "@/utils";

// authoring is driven through the real client entry point
// (p2pContractInstance.add), which builds the transaction exactly as
// LocalP2pSigner does and hands it to playTransaction.

// small p2pTime makes the authoring window expire in seconds; the long
// chainFallbackTime keeps the writer-timeout dispute far away while we
// deliberately author late
const LATE_AUTHOR_TIME_CONFIG = {
    p2pTime: 2,
    agreementTime: 8,
    chainFallbackTime: 20,
    evidenceTime: 6
};

describe("Unit: BlockProductionService", function () {
    describe("isMyTurn", function () {
        it("next-to-write → true; any other peer → false", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const writer = await h.query.getNextPeerToWrite();
            const other = h.peers.find((p) => p.index !== writer.index)!;

            expect(await h.control(writer).query.isMyTurn().request()).to.equal(
                true
            );
            expect(await h.control(other).query.isMyTurn().request()).to.equal(
                false
            );
        });
    });

    describe("getPendingInboundMessageBlocks", function () {
        it("no inbound message ever stored → empty", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const count = await h
                .control(h.getPeer(0))
                .query.getPendingInboundMessageBlockCount(forkId)
                .request();

            expect(count).to.equal(0);
        });

        it("inbound arrived but not yet consumed → returned; once consumed → empty", async function () {
            const h = TestSession.getHarness();
            // the timeConfig is the one the promotion scenario needs to keep a
            // 2-peer channel serving the spectator's sync
            await h.lifecycle.start(2, 0, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 4,
                    chainFallbackTime: 4,
                    evidenceTime: 6
                }
            });
            const forkId = h.activeForkId!;

            const joiner = await h.join.addSpectatorDetached();
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
            await h.event.waitUntilPeerStatus(joiner.index, Status.SYNCED);
            await h.assert.sync.peersInSyncWait();
            await h.join.joinChannelWait({ joiner });

            const pendingCount = await h
                .control(h.getPeer(0))
                .query.getPendingInboundMessageBlockCount(forkId)
                .request();
            expect(pendingCount).to.be.greaterThan(0);

            // an authored block consumes it -> the head now equals the snapshot's
            await h.transition.advanceState({ count: 2 });

            const consumedCount = await h
                .control(h.getPeer(0))
                .query.getPendingInboundMessageBlockCount(forkId)
                .request();
            expect(consumedCount).to.equal(0);
        });
    });

    describe("getPendingInboundMessageBlocks over a gap", function () {
        it("own head above a missing inbound log → the block is produced with no inbound carry", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            // the next writer is the peer that will produce over the gap
            const writer = await h.query.getNextPeerToWrite();
            const other = h.peers.find((p) => p.index !== writer.index)!;
            const observers = h.peers
                .map((peer) => peer.index)
                .filter((index) => index !== writer.index);

            // exactly one inbound log is lost, so the next one still lands and
            // MessageBlockStorage.store moves the head above the hole
            const dropped = await h.rpcStub.dropInboundMessageLogs(
                writer.index,
                { dropCount: 1 }
            );
            for (const participantIndex of observers) {
                await h.join.forceInboundJoinWait({
                    participant: h.getPeer(participantIndex).address,
                    observePeerIndices: observers
                });
            }
            await dropped.waitUntilDropped();

            const heightBefore = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();
            // the writer's head sits above a hole -> it can carry nothing, while
            // a peer that holds the whole chain still has messages pending
            expect(
                await h
                    .control(writer)
                    .query.getPendingInboundMessageBlockCount(forkId)
                    .request()
            ).to.equal(0);
            expect(
                await h
                    .control(other)
                    .query.getPendingInboundMessageBlockCount(forkId)
                    .request()
            ).to.be.greaterThan(0);

            await h.transition.advanceState({
                count: 1,
                waitForPeers: observers
            });

            const bundle = await h
                .control(writer)
                .query.getBlockByHeight(forkId, heightBefore)
                .request();
            const produced = Block.fromSignedBlock(
                Codec.decode(bundle!.encodedSignedBlock, Type.SignedBlock)
            );
            expect(String(produced.author)).to.equal(writer.address);
            // an empty carry is legal - detectForgedInboundMessageBlock returns
            // early for it - so the other peers accept the block
            expect(produced.blockStruct.messageBlocks).to.deep.equal([]);
            for (const peerIndex of observers) {
                expect(
                    await h
                        .control(h.getPeer(peerIndex))
                        .query.getBlockHashAt(forkId, heightBefore)
                        .request(),
                    `peer ${peerIndex} must have accepted the block`
                ).to.equal(bundle!.hash);
            }

            await dropped.release();
        });
    });

    describe("playTransaction → guards", function () {
        it("not my turn → throws instead of authoring", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const other = h.peers.find((p) => p.index !== writer.index)!;
            const heightBefore = await h
                .control(other)
                .query.getNextBlockHeight(forkId)
                .request();

            let message = "no throw";
            try {
                await other.p2pInstance.p2pContractInstance.add(1);
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }

            expect(message).to.contain("NOT MY TURN");
            expect(
                await h
                    .control(other)
                    .query.getNextBlockHeight(forkId)
                    .request()
            ).to.equal(heightBefore);
        });

        it("connected but never synced → throws Channel not open", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            // participants stop serving state, so a joining peer takes the
            // channelId but never learns a fork -> its forkId stays ZeroHash
            const restores = await Promise.all(
                h.peers.map((p) =>
                    h.rpcStub.recordSpectateSync(p.index, { forward: false })
                )
            );

            const { index: spectatorIndex } = await h.join.addSpectator();
            await h.event.waitUntilPeerStatus(spectatorIndex, Status.OPENED);
            const spectator = h.getPeer(spectatorIndex);

            let message = "no throw";
            try {
                await spectator.p2pInstance.p2pContractInstance.add(1);
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }

            expect(message).to.contain("Channel not open");

            await Promise.all(restores.map((restore) => restore()));
        });

        // no test: a locally stored inbound block can only arrive from the
        // on-chain event, which is chained by construction - defensive against
        // a corrupted inbound store.
        it.skip("pending inbound blocks do not form a chain → throws", function () {});
    });

    describe("playTransaction → timestamp adjustment", function () {
        it("authored promptly → timestamp is the local clock, one second ahead", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const clockBefore = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();

            await h.transition.advanceState({ count: 1 });

            const height =
                (await h
                    .control(writer)
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const clockAfter = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();
            const block = await h
                .control(writer)
                .query.getBlockByHeight(forkId, height)
                .request();

            // the stale-timestamp clamp moves it to exactly authoring-time
            // clock + 1, so it is bounded on both sides
            expect(block!.timestamp).to.be.greaterThan(clockBefore);
            expect(block!.timestamp).to.be.at.most(clockAfter + 1);
        });

        // the was-in-the-past clamp (timestamp raised to previousTimestamp)
        // needs the previous block's timestamp to exceed the author's local
        // clock + 1. The authoring path caps every block at its author's
        // now + 1 against a chain-synced clock, so no honest flow reaches it -
        // it guards clock skew between peers the harness cannot stage.
        it.skip("previous block ahead of the local clock → timestamp raised to it", function () {});

        it("authored after the window closed → timestamp clamped back below the local clock", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1, {
                timeConfig: LATE_AUTHOR_TIME_CONFIG
            });
            const forkId = h.activeForkId!;

            const parentHeight =
                (await h
                    .control(h.getPeer(0))
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const parent = await h
                .control(h.getPeer(0))
                .query.getBlockByHeight(forkId, parentHeight)
                .request();

            // let the author's p2pTime window lapse before it writes
            await sleep((LATE_AUTHOR_TIME_CONFIG.p2pTime + 3) * 1000);

            const writer = await h.query.getNextPeerToWrite();
            await h.transition.advanceState({ count: 1 });

            const height =
                (await h
                    .control(writer)
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const block = await h
                .control(writer)
                .query.getBlockByHeight(forkId, height)
                .request();
            const clockAfter = await h
                .control(writer)
                .query.getClockTimeInSeconds()
                .request();

            // clamped to the end of its window, so it is behind the clock
            // instead of the usual now + 1
            expect(block!.timestamp).to.be.lessThan(clockAfter);
            // but never behind its parent
            expect(block!.timestamp).to.be.at.least(parent!.timestamp);
        });
    });

    describe("createBlock", function () {
        it("height 0 links to the fork genesis snapshot; height 1 links to block 0", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);

            const genesisHash = await h
                .control(observer)
                .query.getGenesisSnapshotHash(forkId)
                .request();

            const readPrevious = async (height: number) => {
                const bundle = await h
                    .control(observer)
                    .query.getBlockByHeight(forkId, height)
                    .request();
                const block = Block.fromSignedBlock(
                    Codec.decode(bundle!.encodedSignedBlock, Type.SignedBlock)
                );
                return {
                    previousBlockHash: String(block.previousBlockHash),
                    hash: bundle!.hash
                };
            };

            const zero = await readPrevious(0);
            const one = await readPrevious(1);

            expect(zero.previousBlockHash).to.equal(genesisHash);
            expect(one.previousBlockHash).to.equal(zero.hash);
        });
    });
});
