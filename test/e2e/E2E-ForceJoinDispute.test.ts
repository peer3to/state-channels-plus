import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";
import { waitFor } from "@test/utils/waitFor";

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

        // Advance N=3 blocks (peers 0/1 produce blocks without the join message)
        //  on the 3rd block, the force-join dispute is triggered

        const forkId = h.activeForkId!;
        await h.transition.advanceState({ count: 3 });

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
        await h.transition.advanceState({ count: 3 });
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
        await waitFor(
            async () => {
                const state = await h
                    .control(joiner)
                    .query.getLeaveChannelState()
                    .request();
                return (
                    state?.forkId !== originalForkId &&
                    state?.phase === "awaiting-exit"
                );
            },
            h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
        );

        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        await joiner.p2pInstance.dispose();
        await expect(leave).to.be.rejectedWith("disposed");
    });
});
