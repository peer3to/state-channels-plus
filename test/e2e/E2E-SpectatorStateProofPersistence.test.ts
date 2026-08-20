import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";

describe("E2E: Join/Leave Sequence", function () {
    it("join/leave sequence and fork resolution", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 3,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        // blocks 0, 1
        await h.transition.advanceState({ count: 2 });

        // Leave peer 2, block 2
        const leaverIndex = await h.transition.participantLeaveDetached();
        expect(leaverIndex).to.equal(2);

        await h.assert.sync.participantCount({ expectedCount: 3 });

        // Start peer 4 while the remaining participants produce blocks 3-6.
        // Finish its initial sync before the next leave advances the snapshot
        // that its spectate proof is pinned to.
        const spectator4Promise = h.join.addSpectatorDetached();
        await h.transition.advanceState({
            count: 4,
            waitForPeers: [0, 1, 3],
            waitForFinalization: true
        });
        await h.assert.sync.blockHeight({
            expectedHeight: 6,
            peerIndices: [0, 1, 3]
        });

        const spectator4 = await spectator4Promise;
        await h.event.waitUntilPeerStatus(spectator4.index, Status.SYNCED);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 3, spectator4.index]
        });

        // stays 3, does not count spectators
        await h.assert.sync.participantCount({ expectedCount: 3 });

        // peer 0 is leaving the channel, block 7
        const leaverIndex2 = await h.transition.participantLeaveDetached();
        expect(leaverIndex2).to.equal(0);

        await h.assert.sync.participantCount({ expectedCount: 2 });

        // Start peer 5 while peers 1 and 3 produce blocks 8-11.
        const spectator5Promise = h.join.addSpectatorDetached();
        await h.transition.advanceState({
            count: 4,
            waitForPeers: [1, 3],
            waitForFinalization: true
        });
        const spectator5 = await spectator5Promise;
        await h.event.waitUntilPeerStatus(spectator5.index, Status.SYNCED);

        // No valid block production follows these waits, so they cannot consume
        // an authoring window.
        await Promise.all([
            h.event.waitUntilPeerStatus(leaverIndex, Status.SYNCED),
            h.event.waitUntilPeerStatus(leaverIndex2, Status.SYNCED)
        ]);
        const spectatorIndices = [spectator4.index, spectator5.index];
        await h.assert.sync.peersInSyncWait({
            peerIndices: [1, 3].concat(spectatorIndices)
        });

        // stays 2, does not count spectators
        await h.assert.sync.participantCount({ expectedCount: 2 });

        // Capture the state before malicious action
        const preDisputeForkId = h.activeForkId!;
        h.event.resetEventSpies();

        // next is turn of peer 1
        const maliciousPeerIndex = 1;
        const honestPeerIndices = [3];
        await h.byzantine.submitInvalidStateTransitionBlock(maliciousPeerIndex);
        await h.event.waitForPeers("onAbort", spectatorIndices, 1);
        for (const spectatorIndex of spectatorIndices)
            await h.event.waitUntilPeerStatus(spectatorIndex, Status.OPENED);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: honestPeerIndices,
            expectedCount: 1
        });

        const { newForkId } = await h.dispute.resolveDisputeWait({
            forkId: preDisputeForkId,
            honestPeerIndices
        });

        expect(preDisputeForkId).to.not.equal(
            newForkId,
            "Fork should have changed after dispute resolution"
        );

        // Spectators aborted after rejecting the invalid feed. Only the honest
        // participant is expected to follow the resulting fork.
        await h.assert.sync.forkChangedWait({
            originalForkId: preDisputeForkId,
            expectedForkId: newForkId,
            honestPeerIndices
        });
    });
});
