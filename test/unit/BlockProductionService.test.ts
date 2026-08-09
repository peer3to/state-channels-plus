import { expect } from "chai";
import { Codec, Type } from "@/utils";
import { Block } from "@/models";
import { Status } from "@/types";
import {
    JOIN_STAGING_TIME_CONFIG,
    MathTestSession as TestSession
} from "@test/harness";
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
            // the promotion scenario keeps a 2-peer channel serving the
            // spectator's sync, and the write window has to span the join
            await h.lifecycle.start(2, 2, {
                timeConfig: JOIN_STAGING_TIME_CONFIG
            });
            const forkId = h.activeForkId!;

            const joiner = await h.join.addSpectatorWait();
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
