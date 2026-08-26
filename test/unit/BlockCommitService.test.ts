import { expect } from "chai";
import { Status } from "@/types";
import { addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

// shouldSignBlock is the commit step's sign/no-sign policy; its arms are
// driven directly (bracket access - the method is private) against real
// stored blocks, with the disqualifying condition staged per case.

describe("Unit: BlockCommitService", function () {
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
            const spectatorPromise = h.join.addSpectatorDetached();
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });
            const { index: spectatorIndex } = await spectatorPromise;
            await h.event.waitUntilPeerStatus(spectatorIndex, Status.SYNCED);

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
            const joinerPromise = h.join.addSpectatorDetached();
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
            const joiner = await joinerPromise;
            await h.event.waitUntilPeerStatus(joiner.index, Status.SYNCED);
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
            const joinerPromise = h.join.addSpectatorDetached();
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
            const joiner = await joinerPromise;
            await h.event.waitUntilPeerStatus(joiner.index, Status.SYNCED);
            await h.assert.sync.peersInSyncWait();
            await h.join.joinChannelWait({ joiner });

            // mid-point: joinChannel recorded the force-join height and the
            // peer is pending - this is what promotion must clear
            const pending = await h.execOnHost(
                h.getPeer(joiner.index),
                async (sm) => ({
                    status: sm.status,
                    forceJoinHeight:
                        sm.storage.forceJoin.getJoinSubmissionBlockHeight() ??
                        null
                })
            );
            expect(pending.status).to.equal(Status.PENDING_PARTICIPANT);
            expect(pending.forceJoinHeight).to.not.equal(null);

            // the block including the join commits -> promotion
            await h.transition.advanceState({ count: 2 });
            await h.event.waitUntilPeerStatus(
                joiner.index,
                Status.PARTICIPATING
            );

            const promoted = await h.execOnHost(
                h.getPeer(joiner.index),
                async (sm) => ({
                    status: sm.status,
                    forceJoinHeight:
                        sm.storage.forceJoin.getJoinSubmissionBlockHeight() ??
                        null
                })
            );
            expect(promoted.status).to.equal(Status.PARTICIPATING);
            expect(promoted.forceJoinHeight).to.equal(null);
        });
    });
});
