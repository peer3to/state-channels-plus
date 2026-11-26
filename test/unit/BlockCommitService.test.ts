import { Status } from "@/types";
import { addressesEqual } from "@/utils";
import {
    assertCommitCachePreserved,
    assertSpectatorCommit
} from "@test/fixtures/CommitEligibilityFixture";
import { readTrackedJoin } from "@test/fixtures/ForceJoinCountingStaging";
import { assertLeaverRelaysNothingAfterItsLeave } from "@test/fixtures/LeaverRelayFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { StateChannelManagerInterface__factory } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "ethers";

// shouldSignBlock is the commit step's sign/no-sign policy; its arms are
// driven directly (bracket access - the method is private) against real
// stored blocks, with the disqualifying condition staged per case.

describe("Unit: BlockCommitService", function () {
    it("a spectator commit persists state and calls success without signing or gossip", async () => {
        await assertSpectatorCommit(false);
    });
    it("a commit inserting the spectator promotes it and signs and gossips once", async () => {
        await assertSpectatorCommit(true);
    });

    it("a leaver relays its own leave block but nothing committed after it while its exit is pending", async () => {
        await assertLeaverRelaysNothingAfterItsLeave();
    });

    it("dispute replay with a historical union preserves current off-chain eligibility", async () => {
        await assertCommitCachePreserved();
    });
    describe("shouldSignBlock", function () {
        it("an ordinary block from a participant → signed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const signed = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no stored block");
                    return await sm.blockCommitService["shouldSignBlock"](
                        block
                    );
                },
                { forkId }
            );
            expect(signed).to.equal(true);
        });

        it("a block authored by a blacklisted peer → not signed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            // evaluate on a peer that is not the author, after blacklisting
            // the author
            const author = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    String(
                        sm.storage.blocks.getLatestBlock(args.forkId)!.author
                    ),
                { forkId }
            );
            const observer = h.peers.find(
                (p) => !addressesEqual(p.address, author)
            )!;

            const signed = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no stored block");
                    sm.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        block.author
                    );
                    return await sm.blockCommitService["shouldSignBlock"](
                        block
                    );
                },
                { forkId }
            );
            expect(signed).to.equal(false);
        });

        it("a SYNCED spectator → not signed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const {
                peer: { index: spectatorIndex }
            } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1, 2],
                minimumBlocks: 2,
                maximumBlocks: 20
            });

            const r = await h.execOnHost(
                h.getPeer(spectatorIndex),
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("spectator has no block");
                    return {
                        status: sm.status,
                        signed: await sm.blockCommitService["shouldSignBlock"](
                            block
                        )
                    };
                },
                { forkId }
            );
            expect(r.status).to.equal(Status.SYNCED);
            expect(r.signed).to.equal(false);
        });

        it("a participant that joined after the block → outside its union, not signed", async function () {
            const h = TestSession.getHarness();
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
            // the pre-join tip: the newest block whose union cannot contain
            // the joiner (a joiner does not sync genesis-era history)
            const preJoinHeight =
                (await h
                    .control(h.getPeer(0))
                    .query.getNextBlockHeight(forkId)
                    .request()) - 1;
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId
            });
            const joinPromise = joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );

            // The join lands independently on-chain. Keep the live channel
            // authoring while that happens instead of consuming its next
            // authoring window in a blocking join wait.
            await h.transition.advanceState({ count: 1 });
            await joinPromise;
            await h.assert.storage.honestPeersObserveInboundMessageWait();
            await h.transition.advanceState({ count: 1 });
            await h.event.waitUntilPeerStatus(
                joiner.index,
                Status.PARTICIPATING
            );

            const r = await h.execOnHost(
                h.getPeer(joiner.index),
                async (sm, args) => {
                    const block = sm.storage.blocks.getBlock(
                        args.forkId,
                        args.preJoinHeight
                    );
                    if (!block) throw new Error("joiner lacks pre-join block");
                    return {
                        status: sm.status,
                        signed: await sm.blockCommitService["shouldSignBlock"](
                            block
                        )
                    };
                },
                { forkId, preJoinHeight }
            );
            expect(r.status, "the joiner must be PARTICIPATING").to.equal(
                Status.PARTICIPATING
            );
            expect(r.signed).to.equal(false);
        });

        it("a block posted on-chain → the next-to-write peer does not sign, others do", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const next = await h.query.getNextPeerToWrite();
            const other = h.peers.find((p) => p.index !== next.index)!;

            const evaluate = (peerIndex: number) =>
                h.execOnHost(
                    h.getPeer(peerIndex),
                    async (sm, args) => {
                        const block = sm.storage.blocks.getLatestBlock(
                            args.forkId
                        );
                        if (!block) throw new Error("no stored block");
                        sm.storage.blocks.setOnChainTimestamp(
                            block.hash,
                            Number(block.timestamp) + 1
                        );
                        const withTimestamp = sm.storage.blocks.getBlock(
                            block.hash
                        );
                        return await sm.blockCommitService["shouldSignBlock"](
                            withTimestamp!
                        );
                    },
                    { forkId }
                );

            expect(await evaluate(next.index)).to.equal(false);
            expect(await evaluate(other.index)).to.equal(true);
        });
    });

    describe("success → status promotion", function () {
        it("a PENDING joiner's first committed block includes it → PARTICIPATING and the recorded forceJoin height cleared", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 0, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 4,
                    chainFallbackTime: 4,
                    evidenceTime: 6
                }
            });
            // The spawn is the slow, load-sensitive step; the bounded helper
            // keeps the participants authoring through it so only the join
            // RPCs and one automined transaction sit inside the final window.
            const { peer: joiner } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 2,
                maximumBlocks: 20
            });
            await h.assert.sync.peersInSyncWait();
            await h.join.joinChannelWait({ joiner });

            // mid-point: joinChannel recorded the force-join height and the
            // peer is pending - this is what promotion must clear
            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PENDING_PARTICIPANT);
            expect(
                await readTrackedJoin(h, h.getPeer(joiner.index))
            ).to.not.equal(null);

            // the block including the join commits -> promotion; author until
            // it lands rather than assuming which block carries the join
            await h.transition.keepAuthoringUntil({
                until: async () =>
                    (await h
                        .control(h.getPeer(joiner.index))
                        .query.getStatus()
                        .request()) === Status.PARTICIPATING,
                waitForPeers: [0, 1],
                maximumBlocks: 20
            });

            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
            expect(await readTrackedJoin(h, h.getPeer(joiner.index))).to.equal(
                null
            );
        });
    });
    describe("watchCommitmentsAhead", function () {
        it("a live commit has the commitments of the next 32 heights of its fork watched", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no stored block");
                    const service = sm.blockCommitService;
                    const committed = service["watchedAhead"];
                    service["watchedAhead"] = undefined;
                    await service["watchCommitmentsAhead"](block);
                    return {
                        committed,
                        height: block.height,
                        watched: service["watchedAhead"]
                    };
                },
                { forkId }
            );
            expect(r.committed?.forkId).to.equal(forkId);
            expect(r.committed!.toHeight).to.be.above(r.height);
            expect(r.watched).to.deep.equal({
                forkId,
                toHeight: r.height + 32
            });
        });

        it("watches again only once fewer than 16 of the watched heights are left", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no stored block");
                    const service = sm.blockCommitService;
                    service["watchedAhead"] = {
                        forkId: block.forkId,
                        toHeight: block.height + 16
                    };
                    await service["watchCommitmentsAhead"](block);
                    const sixteenLeft = service["watchedAhead"];
                    service["watchedAhead"] = {
                        forkId: block.forkId,
                        toHeight: block.height + 15
                    };
                    await service["watchCommitmentsAhead"](block);
                    return {
                        height: block.height,
                        sixteenLeft,
                        fifteenLeft: service["watchedAhead"]
                    };
                },
                { forkId }
            );
            expect(r.sixteenLeft).to.deep.equal({
                forkId,
                toHeight: r.height + 16
            });
            expect(r.fifteenLeft).to.deep.equal({
                forkId,
                toHeight: r.height + 32
            });
        });

        it("watches again at once for a block of another fork", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const watched = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no stored block");
                    const service = sm.blockCommitService;
                    service["watchedAhead"] = {
                        forkId: args.otherForkId,
                        toHeight: block.height + 100
                    };
                    await service["watchCommitmentsAhead"](block);
                    return {
                        height: block.height,
                        watched: service["watchedAhead"]
                    };
                },
                { forkId, otherForkId: `0x${"ab".repeat(32)}` }
            );
            expect(watched.watched).to.deep.equal({
                forkId,
                toHeight: watched.height + 32
            });
        });

        it("a live commit tells the chain access of the commitment of each of the next 32 heights for every participant of the union", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const peer = h.getPeer(1);
            await h.control(peer).stub.recordWatchAhead(false).request();
            await h.execOnHost(
                peer,
                async (sm) => {
                    sm.blockCommitService["watchedAhead"] = undefined;
                },
                {}
            );

            await h.transition.increment(1, {
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });

            const { told } = await h
                .control(peer)
                .stub.getWatchAheadRecord()
                .request();
            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(args.forkId);
                    if (!block) throw new Error("no stored block");
                    return {
                        channelId: sm.channelId,
                        manager:
                            await sm.stateChannelManagerContract.getAddress(),
                        latestHeight: block.height,
                        participants: sm.storage.getParticipantsUnion(
                            block.coordinates,
                            block.stateSnapshotHash
                        )
                    };
                },
                { forkId }
            );
            expect(told).to.have.length(1);
            const manager =
                StateChannelManagerInterface__factory.createInterface();
            const calls = told[0].map(({ to, data }) => {
                const [channelId, fork, height, participant] =
                    manager.decodeFunctionData(
                        "getBlockCallDataCommitment",
                        data
                    );
                return {
                    to,
                    channelId,
                    forkId: fork,
                    height: Number(height),
                    participant
                };
            });
            // the commit told of the heights after its own block
            const committedHeight = calls[0].height - 1;
            expect(committedHeight).to.be.at.most(r.latestHeight);
            const expected = [];
            for (let height = 1; height <= 32; height++)
                for (const participant of r.participants)
                    expected.push({
                        to: r.manager,
                        channelId: r.channelId,
                        forkId,
                        height: committedHeight + height,
                        participant
                    });
            expect(calls).to.deep.equal(expected);
            expect(r.participants).to.have.length(3);
        });

        it("a failed telling of the coming commitments is warned about and the commit stands", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;
            const peer = h.getPeer(1);
            await h.control(peer).stub.recordWatchAhead(true).request();
            const heightBefore = await h.execOnHost(
                peer,
                async (sm, args) => {
                    sm.blockCommitService["watchedAhead"] = undefined;
                    return sm.storage.blocks.getNextBlockHeight(args.forkId);
                },
                { forkId }
            );

            await h.transition.increment(1, {
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });
            await waitFor(
                async () =>
                    (await h.control(peer).stub.getWatchAheadRecord().request())
                        .warnings.length > 0
            );

            const { told, warnings } = await h
                .control(peer)
                .stub.getWatchAheadRecord()
                .request();
            expect(told).to.have.length(1);
            expect(warnings).to.deep.equal([
                "Could not watch the coming calldata commitments; their reads prove them"
            ]);
            const heightAfter = await h.execOnHost(
                peer,
                async (sm, args) =>
                    sm.storage.blocks.getNextBlockHeight(args.forkId),
                { forkId }
            );
            expect(heightAfter).to.be.above(heightBefore);
        });

        it("a dispute replay commit tells the chain access of nothing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
            const peer = h.getPeer(0);
            await h.control(peer).stub.recordWatchAhead(false).request();
            await h.execOnHost(
                peer,
                async (sm) => {
                    sm.blockCommitService["watchedAhead"] = undefined;
                },
                {}
            );

            const result = await h
                .control(peer)
                .validation.probeReplayCommitCache(
                    ethers.Wallet.createRandom().address
                )
                .request();

            expect(result.committed).to.equal(true);
            const { told } = await h
                .control(peer)
                .stub.getWatchAheadRecord()
                .request();
            // the replayed block is block zero: a telling for it starts at height 1
            const manager =
                StateChannelManagerInterface__factory.createInterface();
            const firstHeights = told.map(([first]) =>
                Number(
                    manager.decodeFunctionData(
                        "getBlockCallDataCommitment",
                        first.data
                    )[2]
                )
            );
            expect(firstHeights).to.not.include(1);
        });
    });
});
