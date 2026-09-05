import { expect } from "chai";
import { Codec, Type } from "@/utils";
import { Block } from "@/models";
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { sleep } from "@/utils";
import { waitFor } from "@test/utils/waitFor";

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

            const { peer: joiner } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 2,
                maximumBlocks: 20
            });
            await h.assert.sync.peersInSyncWait();
            await h.join.joinChannelWait({ joiner });

            const pendingCount = await h
                .control(h.getPeer(0))
                .query.getPendingInboundMessageBlockCount(forkId)
                .request();
            expect(pendingCount).to.be.greaterThan(0);

            // an authored block consumes it -> the head now equals the
            // snapshot's; author until the writer that saw the join has
            // consumed it rather than assuming a fixed block count
            await h.transition.keepAuthoringUntil({
                until: async () =>
                    (await h
                        .control(h.getPeer(0))
                        .query.getPendingInboundMessageBlockCount(forkId)
                        .request()) === 0,
                waitForPeers: [0, 1],
                maximumBlocks: 20
            });

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
        it("two same-peer submissions built for one height → only the winner authors", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const nextWriter = await h.query.getNextPeerToWrite();
            const writer = h.peers[nextWriter.index];
            const heightBefore = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();

            await h.execOnHost(writer, async (sm) => {
                await sm.mutex.lock({ taskName: "holdSamePeerSubmissions" });
            });

            let mutexReleased = false;
            try {
                const first = writer.p2pInstance.p2pContractInstance.add(1);
                const second = writer.p2pInstance.p2pContractInstance.add(2);

                // Polled, not event-driven: nothing signals the turn barrier
                // while the mutex is held, and the two submissions reach the
                // host only after ethers finished building each transaction.
                await waitFor(
                    async () =>
                        (await h.execOnHost(writer, (sm) => {
                            const mutex = sm.mutex as unknown as {
                                queue: unknown[];
                            };
                            return mutex.queue.length;
                        })) >= 2,
                    h.event.protocolEventTimeoutMs(),
                    100
                );
                await h.execOnHost(writer, (sm) => sm.mutex.unlock());
                mutexReleased = true;

                await Promise.all([first, second]);
            } finally {
                if (!mutexReleased) {
                    await h.execOnHost(writer, (sm) => sm.mutex.unlock());
                }
            }

            expect(
                await h
                    .control(writer)
                    .query.getNextBlockHeight(forkId)
                    .request()
            ).to.equal(heightBefore + 1);
        });

        it("a follower behind by the writer's parked block stamps a slot that was never its own → the candidate is dropped, nothing authored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const writer = await h.query.getNextPeerToWrite();
            const participants = await h
                .control(writer)
                .query.getParticipants()
                .request();
            // Round-robin: the participant after the writer is next once the
            // writer's block applies.
            const followerAddress =
                participants[
                    (participants.indexOf(writer.address) + 1) %
                        participants.length
                ];
            const follower = h.peers.find(
                (peer) => peer.address === followerAddress
            )!;
            const others = h.peers
                .filter(
                    (peer) =>
                        participants.includes(peer.address) &&
                        peer.index !== follower.index
                )
                .map((peer) => peer.index);
            const heightBefore = await h
                .control(follower)
                .query.getNextBlockHeight(forkId)
                .request();

            // One writer per {forkId, height}: the slot is the writer's, and
            // every peer derives that from the same state. Holding the
            // follower's mutex parks the writer's block at its execution
            // boundary, so the follower is behind by one block and stamps its
            // own submission with the height that block is about to take: a
            // slot that was never the follower's. The candidate must be
            // dropped, not moved.
            const scheduled = await h.rpcStub.recordScheduledTasks(
                follower.index
            );
            await h.execOnHost(follower, async (sm) => {
                await sm.mutex.lock({ taskName: "holdFollowerApply" });
            });
            const mutexWaiters = () =>
                h.execOnHost(follower, (sm) => {
                    const mutex = sm.mutex as unknown as { queue: unknown[] };
                    return mutex.queue.length;
                });
            let mutexReleased = false;
            let submission: Promise<unknown> | undefined;
            try {
                await h.transition.peerWrite({
                    peer: writer.index,
                    waitForPeers: others
                });
                // The block's execution task is scheduled once it leaves the
                // queue; it then waits on the held mutex.
                await waitFor(async () =>
                    (await scheduled.tasks()).some((task) =>
                        task.taskName.startsWith(
                            "BlockQueueManager.executeQueuedEntry"
                        )
                    )
                );
                await waitFor(async () => (await mutexWaiters()) >= 1);
                const waitersBeforeSubmission = await mutexWaiters();
                submission = follower.p2pInstance.p2pContractInstance.add(1);
                await waitFor(
                    async () => (await mutexWaiters()) > waitersBeforeSubmission
                );
                await h.execOnHost(follower, (sm) => sm.mutex.unlock());
                mutexReleased = true;
                await submission;
            } finally {
                if (!mutexReleased) {
                    await h.execOnHost(follower, (sm) => sm.mutex.unlock());
                    await submission?.catch(() => undefined);
                }
                await scheduled.restore();
            }

            await h.assert.sync.peersInSyncWait({
                peerIndices: [...others, follower.index]
            });
            const first = await h
                .control(follower)
                .query.getBlockByHeight(forkId, heightBefore)
                .request();
            expect(first!.author).to.equal(writer.address);
            // Dropped: no block at the taken height by the follower and none
            // authored above it; the caller may resubmit against the new state.
            expect(
                await h
                    .control(follower)
                    .query.getBlockByHeight(forkId, heightBefore + 1)
                    .request()
            ).to.be.null;
            expect(
                await h
                    .control(follower)
                    .query.getNextBlockHeight(forkId)
                    .request()
            ).to.equal(heightBefore + 1);
            expect(
                await h
                    .control(writer)
                    .query.isBlacklisted(follower.address)
                    .request()
            ).to.equal(false);
        });

        it("a reduction replaces the fork before the candidate takes the mutex → the candidate is dropped, nothing authored", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId } =
                await h.scenario.stageReducibleDisputedFork({
                    peerCount: 4,
                    maliciousPeerIndex: 1
                });
            const target = h.getPeer(0);
            const staleHeight = await h
                .control(target)
                .query.getNextBlockHeight(sourceForkId)
                .request();
            // The reduced genesis install holds the state mutex; a candidate
            // stamped on the old fork waits behind it.
            const hold = await h.rpcStub.holdReductionGenesisApplication(0, {
                outcome: "hold",
                at: "setState"
            });
            let submission: Promise<unknown> | undefined;
            try {
                await h
                    .control(target)
                    .stub.startTryReduce(sourceForkId)
                    .request();
                await waitFor(async () => (await hold.entered()) === 1);
                submission = target.p2pInstance.p2pContractInstance.add(1);
                await waitFor(
                    async () =>
                        (await h.execOnHost(target, (sm) => {
                            const mutex = sm.mutex as unknown as {
                                queue: unknown[];
                            };
                            return mutex.queue.length;
                        })) >= 1
                );
            } finally {
                await hold.release();
            }
            // A stale candidate is dropped silently, never thrown.
            await submission;

            const reducedForkId = await h
                .control(target)
                .query.getForkId()
                .request();
            expect(reducedForkId).to.not.equal(sourceForkId);
            // Never signed at the stale coordinate, and nothing authored on
            // the reduced fork either: the caller reassesses.
            expect(
                await h
                    .control(target)
                    .query.getBlockByHeight(sourceForkId, staleHeight)
                    .request()
            ).to.be.null;
            expect(
                await h
                    .control(target)
                    .query.getBlockByHeight(reducedForkId, 0)
                    .request()
            ).to.be.null;
        });

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

            // spawn-only: the participants never serve sync, so the spectator
            // connects but stays OPENED while the fork keeps moving
            const {
                peer: { index: spectatorIndex }
            } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 0,
                maximumBlocks: 20,
                waitForSynced: false
            });
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
            // clock + 1, so it is bounded on both sides. The writer's clock
            // follows chain time and a resync can move it back one second
            // between authoring and the read, hence the extra second.
            expect(block!.timestamp).to.be.greaterThan(clockBefore);
            expect(block!.timestamp).to.be.at.most(clockAfter + 2);
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
