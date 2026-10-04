import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("E2E: Force Join Dispute", function () {
    it("should force an omitted join into the reduced fork and schedule the joiner as an author", async function () {
        const h = TestSession.getHarness();

        // Spectating is asynchronous to the channel: participants author on
        // their own cadence and never wait for a joiner's spawn/sync. Spawn
        // detached, produce the initial blocks immediately, and await SYNCED
        // only right before the join needs it — by then the sync overlapped
        // the transitions. A blocking spawn between blocks would idle past
        // p2pTime + agreementTime and get the next block rejected (its
        // timestamp is capped at prev + p2pTime).
        await h.lifecycle.start(2, 0);
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20,
            statusTimeoutMessage: "Joiner did not reach SYNCED"
        });
        await h.assert.sync.peersInSyncWait();

        const restoreInboundInclusion0 =
            await h.byzantine.stubPendingInboundInclusion(0);
        const restoreInboundInclusion1 =
            await h.byzantine.stubPendingInboundInclusion(1);

        await h.join.joinChannelWait({ joiner });
        const joinConfirmedAt = (await h.provider.getBlock("latest"))!
            .timestamp;
        expect(
            await h.control(h.getPeer(joiner.index)).query.getStatus().request()
        ).to.equal(
            Status.PENDING_PARTICIPANT,
            "Joiner should be PENDING_PARTICIPANT after joinChannel"
        );

        // Peers 0/1 keep producing blocks without the join message; N=3 blocks
        // after the join's agreementTime grace, the force-join dispute fires.
        const forkId = h.activeForkId!;
        await h.transition.keepAuthoringUntilForkDisputed({
            forkId,
            waitForPeers: [0, 1]
        });
        const { agreementTime } = await h.execOnHost(
            h.getPeer(joiner.index),
            async (sm) => ({ agreementTime: sm.timeConfig.agreementTime })
        );
        expect(
            Number(
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    forkId
                )
            )
        ).to.be.at.least(
            joinConfirmedAt + agreementTime,
            "the force-join dispute must wait out the join's agreementTime grace"
        );

        // Block assembly can include pending inbound messages again. Dispute
        // construction always reads the real inbound head while this stub is
        // active.
        await restoreInboundInclusion0();
        await restoreInboundInclusion1();

        const { newForkId } = await h.dispute.resolveDisputeWait({ forkId });

        expect(
            await h.control(h.getPeer(joiner.index)).query.getStatus().request()
        ).to.equal(
            Status.PARTICIPATING,
            "Joiner should be PARTICIPATING after force-join dispute resolves via reduction"
        );
        // Seated by the reduction genesis: the join ended, so no join-bound
        // field or deadline outlives it into a later join.
        expect(
            await h.execOnHost(h.getPeer(joiner.index), async (sm) => {
                const forceJoin = sm.storage.forceJoin;
                return {
                    submissionHeight:
                        forceJoin.getJoinSubmissionBlockHeight() ?? null,
                    authorizationDeadline:
                        forceJoin.getJoinAuthorizationDeadline() ?? null,
                    countingStartsAt: forceJoin.getCountingStartsAt() ?? null,
                    countingFromHeight:
                        forceJoin.getCountingFromHeight() ?? null,
                    boundFired: forceJoin.hasBoundFired(),
                    deadlineArmed:
                        Reflect.get(
                            sm.membershipService,
                            "forceJoinDeadline"
                        ) !== undefined
                };
            })
        ).to.deep.equal({
            submissionHeight: null,
            authorizationDeadline: null,
            countingStartsAt: null,
            countingFromHeight: null,
            boundFired: false,
            deadlineArmed: false
        });

        const expected = new Set([
            h.peers[0].address,
            h.peers[1].address,
            joiner.address
        ]);
        for (const peer of h.peers) {
            const actual = await h
                .control(peer)
                .query.getParticipants()
                .request();
            expect(new Set(actual)).to.deep.equal(
                expected,
                `Peer ${peer.index} on-chain participants should match 3-player fork after reduction`
            );
        }

        let joinerAuthored = false;
        for (let i = 0; i < expected.size; i++) {
            const nextToWrite = await h
                .control(h.getPeer(0))
                .query.getNextToWrite()
                .request();
            await h.transition.advanceState({ count: 1 });
            if (nextToWrite.toLowerCase() !== joiner.address.toLowerCase()) {
                continue;
            }

            const latestBlock = await h
                .control(h.getPeer(0))
                .query.getLatestBlockInfo(newForkId)
                .request();
            expect(latestBlock).to.not.equal(null);
            expect(latestBlock!.author.toLowerCase()).to.equal(
                joiner.address.toLowerCase()
            );
            joinerAuthored = true;
        }
        expect(joinerAuthored).to.equal(
            true,
            "the reduced joiner must receive and complete an authoring turn"
        );
    });

    it("a joiner that synced past a participant change forces its omitted join with a valid state proof", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({ count: 3 });
        // A change point the joiner's sync proves only through milestones.
        // The founders keep the writer slot alive while the exit settles (an
        // agreement window plus the snapshot transaction): an idle slot would
        // open a participant-timeout dispute before the force-join one.
        const leaver = await h.transition.participantLeaveStateTransition();
        const founders = [0, 1, 2].filter((index) => index !== leaver);
        await h.transition.keepAuthoringUntilPeersStatus({
            peerIndices: [leaver],
            status: Status.SYNCED,
            waitForPeers: founders,
            excludePeerIndices: [leaver]
        });
        await h.transition.advanceState({ count: 8, waitForPeers: founders });
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: founders,
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...founders, joiner.index]
        });

        const restores = await Promise.all(
            founders.map((index) =>
                h.byzantine.stubPendingInboundInclusion(index)
            )
        );
        const joinerDisputes = await h.rpcStub.recordDisputeSubmissions(
            joiner.index,
            { forward: true }
        );
        await h.join.joinChannelWait({ joiner });
        const forkId = h.activeForkId!;
        await h.transition.keepAuthoringUntilForkDisputed({
            forkId,
            waitForPeers: founders
        });
        await Promise.all(restores.map((restore) => restore()));
        // The joiner itself forced the join, with a state proof.
        await waitFor(
            async () => (await joinerDisputes.submissions()).length > 0
        );
        const joinerDispute = Codec.decode(
            (await joinerDisputes.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(joinerDispute.input.disputer).to.equal(joiner.address);
        // The proof starts at the exit's on-chain snapshot: no milestone lies
        // wholly below it, and a proof block at its height is the block that
        // committed it.
        const { canUseOnChainSnapshot, onChainSnapshot } =
            await h.channelManager.getAnchorSnapshot(h.channelId, forkId);
        expect(canUseOnChainSnapshot).to.equal(true);
        const anchorHeight = Number(onChainSnapshot.blockHeight);
        const { milestones } = joinerDispute.input.stateProof;
        expect(milestones.length).to.be.greaterThan(0);
        for (const milestone of milestones)
            expect(
                Block.fromBlockConfirmation(
                    milestone.blockConfirmations.at(-1)!
                ).height
            ).to.be.at.least(anchorHeight);
        const blockAtAnchor = milestones
            .flatMap((milestone) =>
                milestone.blockConfirmations.map((confirmation) =>
                    Block.fromBlockConfirmation(confirmation)
                )
            )
            .find((block) => block.height === anchorHeight);
        if (blockAtAnchor)
            expect(blockAtAnchor.stateSnapshotHash).to.equal(
                StateSnapshot.from(onChainSnapshot).hash
            );
        expect(
            (
                await h.channelManager.findFirstInvalidBlockStructureInStateProof(
                    joinerDispute.input.stateProof
                )
            ).found
        ).to.equal(false);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [...founders, joiner.index]
        });

        expect(
            await h.control(h.getPeer(joiner.index)).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
    });

    it("a joiner whose join no block includes forces it by dispute once its deadline passes", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const forkId = h.activeForkId!;
        const height = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request();

        // No peer runs its participant-timeout check, so only the joiner's
        // deadline can start a dispute; no transition follows the join, so
        // the block bound never fires either.
        await Promise.all(
            [0, 1, joiner.index].map((index) =>
                h.rpcStub.suppressTimeoutCheck(index)
            )
        );
        await h.join.joinChannelWait({ joiner });
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING, {
            timeoutMs: h.event.protocolEventTimeoutMs() * 4,
            timeoutMessage: "the joiner's deadline never forced its join"
        });

        expect(
            await h.channelManager.isForkDisputed(h.channelId, forkId)
        ).to.equal(true);
        expect(
            await h
                .control(h.getPeer(0))
                .query.getLatestBlockHeight(forkId)
                .request()
        ).to.equal(height);
        expect(
            await h.execOnHost(h.getPeer(joiner.index), async (sm) =>
                (await sm.diamondStateMachine.getParticipants()).map(String)
            )
        ).to.include(joiner.address);
    });

    it("late leave waits for the submitted force-join dispute before retrying on its successor", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, {
            configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 5_000 }
        });
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const restoreInbound0 =
            await h.byzantine.stubPendingInboundInclusion(0);
        const restoreInbound1 =
            await h.byzantine.stubPendingInboundInclusion(1);
        await h.join.joinChannelWait({ joiner });

        const originalForkId = h.activeForkId!;
        await h.transition.keepAuthoringUntilForkDisputed({
            forkId: originalForkId,
            waitForPeers: [0, 1]
        });
        await h.event.waitForPeers("onInitiatingDispute", [joiner.index], 1, {
            mode: "atLeast"
        });
        await restoreInbound0();
        await restoreInbound1();
        const disputeCountBeforeLeave =
            joiner.eventSpies.onInitiatingDispute!.callCount;

        const leave = joiner.p2pInstance.p2pSigner.leaveChannel();
        void leave.catch(() => undefined);
        await waitFor(async () => {
            const state = await h
                .control(joiner)
                .query.getLeaveChannelState()
                .request();
            return state?.phase === "awaiting-settlement";
        });
        expect(joiner.eventSpies.onInitiatingDispute!.callCount).to.equal(
            disputeCountBeforeLeave
        );

        await h.dispute.resolveDisputeWait({ forkId: originalForkId });
        await h.event.waitUntilLeavePhase(joiner.index, "awaiting-exit");
        expect(
            (await h.control(joiner).query.getLeaveChannelState().request())
                ?.forkId
        ).to.not.equal(originalForkId);

        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        await joiner.p2pInstance.dispose();
        await expect(leave).to.be.rejectedWith("disposed");
    });

    it("founders whose exits wait on an unconsumed join force them by dispute, which also seats the pending joiner", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const founders = [h.getPeer(0), h.getPeer(1)];
        // The founders never include the join, so its inbound message stays
        // unconsumed on chain while they exit.
        await h.byzantine.stubPendingInboundInclusion(0);
        await h.byzantine.stubPendingInboundInclusion(1);
        const founderDisputes = await Promise.all(
            founders.map((founder) =>
                h.rpcStub.recordDisputeSubmissions(founder.index, {
                    forward: true
                })
            )
        );
        await h.join.joinChannelWait({ joiner });
        const exits: Promise<unknown>[] = [];
        for (const founder of founders) {
            founder.p2pInstance.events.on(
                "p2pEventHooks",
                "onLeaveTurn",
                () => {
                    exits.push(
                        founder.p2pInstance.p2pContractInstance.leaveChannel()
                    );
                }
            );
        }
        const forkId = h.activeForkId!;

        const leaves = founders.map((founder) =>
            founder.p2pInstance.leaveChannel()
        );
        await h.transition.advanceState({ waitForPeers: [0, 1] });
        await waitFor(
            () => Promise.resolve(exits.length === 2),
            h.event.protocolEventTimeoutMs(),
            100
        );
        await Promise.all(exits);
        for (const founder of founders) {
            h.contextApi.markAfkPeer({ afkPeerIndex: founder.index });
        }
        // The founders' own exits are what disputed: self-removals.
        await waitFor(async () =>
            (
                await Promise.all(
                    founderDisputes.map((recorder) => recorder.submissions())
                )
            ).every((submissions) => submissions.length > 0)
        );
        for (const [index, recorder] of founderDisputes.entries()) {
            const dispute = Codec.decode(
                (await recorder.submissions())[0].encodedDispute,
                Type.Dispute
            );
            expect(dispute.input.disputer).to.equal(founders[index].address);
            expect(dispute.input.selfRemoval).to.equal(true);
        }

        await Promise.all(leaves);
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);

        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.deep.equal([joiner.address]);
        expect(
            await h.channelManager.isForkDisputed(h.channelId, forkId)
        ).to.equal(true);
    });

    it("founders force their exits by dispute when the pending joiner whose join they never consumed is gone", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const founders = [h.getPeer(0), h.getPeer(1)];
        await h.byzantine.stubPendingInboundInclusion(0);
        await h.byzantine.stubPendingInboundInclusion(1);
        const founderDisputes = await Promise.all(
            founders.map((founder) =>
                h.rpcStub.recordDisputeSubmissions(founder.index, {
                    forward: true
                })
            )
        );
        await h.join.joinChannelWait({ joiner });
        // The joiner disappears: only the founders can move the fork on.
        h.contextApi.markAfkPeer({ afkPeerIndex: joiner.index });
        await joiner.p2pInstance.dispose();
        const exits: Promise<unknown>[] = [];
        for (const founder of founders) {
            founder.p2pInstance.events.on(
                "p2pEventHooks",
                "onLeaveTurn",
                () => {
                    exits.push(
                        founder.p2pInstance.p2pContractInstance.leaveChannel()
                    );
                }
            );
        }
        const forkId = h.activeForkId!;

        const leaves = founders.map((founder) =>
            founder.p2pInstance.leaveChannel()
        );
        await h.transition.advanceState({ waitForPeers: [0, 1] });
        await waitFor(
            () => Promise.resolve(exits.length === 2),
            h.event.protocolEventTimeoutMs(),
            100
        );
        await Promise.all(exits);
        for (const founder of founders) {
            h.contextApi.markAfkPeer({ afkPeerIndex: founder.index });
        }
        // The founders' own exits are what disputed: self-removals.
        await waitFor(async () =>
            (
                await Promise.all(
                    founderDisputes.map((recorder) => recorder.submissions())
                )
            ).every((submissions) => submissions.length > 0)
        );
        for (const [index, recorder] of founderDisputes.entries()) {
            const dispute = Codec.decode(
                (await recorder.submissions())[0].encodedDispute,
                Type.Dispute
            );
            expect(dispute.input.disputer).to.equal(founders[index].address);
            expect(dispute.input.selfRemoval).to.equal(true);
        }

        await Promise.all(leaves);

        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.deep.equal([joiner.address]);
        expect(
            await h.channelManager.isForkDisputed(h.channelId, forkId)
        ).to.equal(true);
    });

    it("a fast table that authors the block bound inside the join's grace is not disputed and seats the joiner later", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const forkId = h.activeForkId!;
        const restores = await Promise.all(
            [0, 1].map((index) =>
                h.byzantine.stubPendingInboundInclusion(index)
            )
        );
        const joinerDisputes = await h.rpcStub.recordDisputeSubmissions(
            joiner.index
        );
        await h.join.joinChannelWait({ joiner });
        await waitFor(
            async () =>
                (await h.execOnHost(
                    h.getPeer(joiner.index),
                    async (sm) =>
                        sm.storage.forceJoin.getCountingStartsAt() ?? null
                )) !== null
        );

        // N + 1 blocks without the join, all authored inside the grace: a
        // bound counting from the observation itself would fire on them.
        await h.transition.advanceState({ count: 4, waitForPeers: [0, 1] });
        expect(
            await h.execOnHost(h.getPeer(joiner.index), async (sm) => ({
                countingFromHeight:
                    sm.storage.forceJoin.getCountingFromHeight() ?? null,
                boundFired: sm.storage.forceJoin.hasBoundFired()
            }))
        ).to.deep.equal({ countingFromHeight: null, boundFired: false });

        await Promise.all(restores.map((restore) => restore()));
        await h.transition.keepAuthoringUntilPeersStatus({
            peerIndices: [joiner.index],
            status: Status.PARTICIPATING,
            waitForPeers: [0, 1]
        });

        expect(
            await h.channelManager.isForkDisputed(h.channelId, forkId)
        ).to.equal(false);
        expect(await joinerDisputes.submissions()).to.deep.equal([]);
    });

    it("a pending joiner whose force join was refused needs no evidence of its own: the next observed dispute's reduction consumes its join and seats it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, {
            configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 50 }
        });
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait();
        const restores = await Promise.all(
            [0, 1].map((index) =>
                h.byzantine.stubPendingInboundInclusion(index)
            )
        );
        // Founder 0 adds no dispute of its own.
        await h.dispute.suppressDisputeInitiation([0]);
        const joinerDisputes = await h.rpcStub.recordDisputeSubmissions(
            joiner.index,
            { forward: true }
        );
        await h.join.joinChannelWait({ joiner });

        await waitFor(
            async () =>
                (await h.execOnHost(
                    h.getPeer(joiner.index),
                    async (sm) =>
                        sm.storage.forceJoin.getCountingStartsAt() ?? null
                )) !== null
        );
        // The joiner's block bound is made due on its latest block, where
        // it meets a window whose evidence period ended: the force join is
        // refused and neither bound tries again.
        const restoreWindow = await h.rpcStub.answerExpiredLocalDisputeWindow(
            joiner.index
        );
        try {
            expect(
                await h.execOnHost(h.getPeer(joiner.index), async (sm) => {
                    const block = sm.storage.blocks.getLatestBlock(sm.forkId)!;
                    const participants =
                        await sm.diamondStateMachine.getParticipants();
                    sm.storage.forceJoin.setCountingStartsAt(0);
                    sm.storage.forceJoin.setCountingFromHeight(
                        block.height - participants.length - 1
                    );
                    await sm.membershipService.maybeInitiateForceJoinDispute(
                        block,
                        participants
                    );
                    return sm.storage.forceJoin.hasBoundFired();
                })
            ).to.equal(true);
        } finally {
            await restoreWindow();
        }
        expect(await joinerDisputes.submissions()).to.deep.equal([]);

        // The next observed dispute is founder 1's self-removal. The joiner
        // audits it and runs its more-evidence comparison: an admitted
        // dispute carries the chain's latest inbound head and the reduction
        // consumes the inbound queue, the joiner's join included, so its own
        // dispute would add nothing.
        const comparisons = await h.rpcStub.recordEvidenceComparisons(
            joiner.index
        );
        const founderDisputes = await h.rpcStub.recordDisputeSubmissions(1, {
            forward: true
        });
        const founderLeave = h.getPeer(1).p2pInstance.p2pSigner.leaveChannel();
        await comparisons.waitUntilAudited(1);
        await waitFor(
            async () => (await comparisons.audits())[0].outcome === "resolved",
            h.event.protocolEventTimeoutMs()
        );
        expect((await comparisons.audits())[0].answer).to.equal(false);
        const founderDispute = Codec.decode(
            (await founderDisputes.submissions())[0].encodedDispute,
            Type.Dispute
        );
        expect(founderDispute.input.disputer).to.equal(h.getPeer(1).address);
        await Promise.all(restores.map((restore) => restore()));
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING, {
            timeoutMs: h.event.evidencePeriodWaitMs(2)
        });
        expect(await joinerDisputes.submissions()).to.deep.equal([]);
        await waitFor(async () =>
            (await h.channelManager.getParticipants(h.channelId)).includes(
                joiner.address
            )
        );
        await founderLeave;
    });
});
