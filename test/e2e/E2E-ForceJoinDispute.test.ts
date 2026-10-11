import { Status } from "@/types";
import { addressesEqual, Codec, sleep, Type } from "@/utils";
import {
    authorUntilForceJoinCountingStarted,
    observeMembershipEnd,
    readForceJoinBounds
} from "@test/fixtures/ForceJoinCountingStaging";
import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
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
        expect(
            await h.control(h.getPeer(joiner.index)).query.getStatus().request()
        ).to.equal(
            Status.PENDING_PARTICIPANT,
            "Joiner should be PENDING_PARTICIPANT after joinChannel"
        );

        // Blocks count only after the agreementTime grace that follows the
        // joiner observing its own join; peers 0/1 keep authoring through it.
        // Peers 0/1 omit the join; the first counted block starts the bound
        // and the dispute fires N = participants + 1 = 3 blocks later.
        const forkId = h.activeForkId!;
        const bounds = await authorUntilForceJoinCountingStarted(
            h,
            joiner.index,
            [0, 1]
        );
        const remaining =
            bounds.countingFromHeight! +
            bounds.participantCount +
            1 -
            bounds.latestBlockHeight;
        expect(remaining, "the dispute height is still ahead").to.be.gte(1);
        await h.transition.advanceState({ count: remaining });

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
        const bounds = await authorUntilForceJoinCountingStarted(
            h,
            joiner.index,
            [0, 1]
        );
        const remaining =
            bounds.countingFromHeight! +
            bounds.participantCount +
            1 -
            bounds.latestBlockHeight;
        expect(remaining, "the dispute height is still ahead").to.be.gte(1);
        await h.transition.advanceState({ count: remaining });
        await h.event.waitForPeers("onInitiatingDispute", [joiner.index], 1, {
            mode: "atLeast"
        });
        await restoreInbound0();
        await restoreInbound1();
        const disputeCountBeforeLeave =
            joiner.eventSpies.onInitiatingDispute!.callCount;

        // the joiner already disputed the fork: its leave submits nothing more
        await joiner.p2pInstance.p2pSigner.leaveChannel();
        expect(joiner.eventSpies.onInitiatingDispute!.callCount).to.equal(
            disputeCountBeforeLeave
        );

        await h.dispute.resolveDisputeWait({ forkId: originalForkId });
        // the reduced fork keeps the joiner: the leave restarts there
        await waitFor(async () => {
            const state = await h
                .control(joiner)
                .query.getLeaveChannelState()
                .request();
            return (
                state?.isLeaveRequested === true &&
                state.forkId !== originalForkId
            );
        });

        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        await joiner.p2pInstance.dispose();
    });
    it("a leave requested through the public leaveChannel before the joiner's own force-join dispute puts its self-removal into that dispute; once the reduction consumes the join and removes the joiner from the local state and the chain, the join ends: SYNCED, one onLeftChannel, no watchdog re-armed, and the runtime disposes itself", async function () {
        const h = TestSession.getHarness();
        const watchdogMs = 3_000;
        await h.lifecycle.start(2, 0, {
            configOverrides: {
                LEAVE_CHANNEL_WATCHDOG_MS: watchdogMs,
                // the retained inline host keeps its records after the
                // runtime disposes itself
                RUN_SDK_IN_THREAD: false
            }
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
        // only the joiner's force-join bound can open the dispute
        for (const index of [0, 1, joiner.index])
            await h.rpcStub.suppressTimeoutCheck(index);
        const recorder = await h.rpcStub.recordDisputeSubmissions(
            joiner.index,
            { forward: true }
        );
        await h.join.joinChannelWait({ joiner });
        const endpoint = runtimeEndpointFor(joiner.p2pInstance);
        const membershipEnd = observeMembershipEnd(endpoint.sm);

        // the leave comes before the force-join trigger; the instance
        // disposes itself once the runtime reports onLeftChannel
        joiner.p2pInstance.leaveChannel();
        await h.event.waitUntilLeaveState(joiner.index, "isLeaveRequested");
        const joinerPeer = h.getPeer(joiner.index);
        expect(
            (await readForceJoinBounds(h, joinerPeer)).disputeStarted
        ).to.equal(false);
        const forkId = h.activeForkId!;
        const bounds = await authorUntilForceJoinCountingStarted(
            h,
            joiner.index,
            [0, 1]
        );
        const remaining =
            bounds.countingFromHeight! +
            bounds.participantCount +
            1 -
            bounds.latestBlockHeight;
        expect(remaining, "the dispute height is still ahead").to.be.gte(1);
        await h.transition.advanceState({ count: remaining });
        await waitFor(
            async () => (await recorder.submissions()).length === 1,
            h.event.protocolEventTimeoutMs()
        );
        // the joiner's own force-join dispute, with its self-removal
        expect(
            (await readForceJoinBounds(h, joinerPeer)).disputeStarted
        ).to.equal(true);
        const [submission] = await recorder.submissions();
        const dispute = Codec.decode(submission.encodedDispute, Type.Dispute);
        expect(dispute.input.selfRemoval).to.equal(true);
        expect(addressesEqual(dispute.input.disputer, joiner.address)).to.equal(
            true
        );
        await restoreInbound0();
        await restoreInbound1();

        // record-only scheduling probe on the retained host
        endpoint.stub.stubRecordScheduledTasks();
        const leaveWatchdogs = () =>
            endpoint.stub
                .getRecordedScheduledTasks()
                .tasks.filter(
                    (task) => task.taskName === "channel leave watchdog"
                ).length;
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [0, 1]
        });
        await h.event.waitUntilLeftChannel(joiner.index);
        const watchdogsAtLeft = leaveWatchdogs();
        // no dispose() call: the public leave disposes the runtime
        await h.event.waitUntilDisposed(joiner.index);

        // the joiner's host state when it reported onLeftChannel
        expect(membershipEnd.atLeft()).to.deep.equal({
            status: Status.SYNCED,
            trackedJoin: null,
            leaveState: null,
            isSignerInLocalState: false
        });
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(joiner.address);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        // absence window: a re-armed watchdog is scheduled within one period
        await sleep(watchdogMs + 1_000);
        expect(leaveWatchdogs()).to.equal(watchdogsAtLeft);
        expect(joiner.eventSpies.onLeftChannel?.callCount).to.equal(1);
    });
});
