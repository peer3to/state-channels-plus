import { TestSession, PeerTestHarness } from "@test/harness";
import { expect } from "chai";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: Join/Leave Sequence", function () {
    it("join/leave sequence and fork resolution", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        // blocks 0, 1
        await h.transition.advanceState({ count: 2 });

        // Leave peer 2, block 2
        const leaverIndex = await h.transition.participantLeave({
            waitForStatus: true
        });
        expect(leaverIndex).to.equal(2);

        await h.assert.sync.participantCount({ expectedCount: 3 });

        // turns of 3,0, blocks 3,4 — default sync excludes `leftChannelPeerIndices`
        await h.transition.advanceState({
            count: 2
        });
        await h.assert.sync.blockHeight({ expectedHeight: 4 });

        // Join peer 4 as spectator (`addPeer` waits for SYNCED)
        await h.addPeer();
        // stays 3, does not count spectators
        await h.assert.sync.participantCount({ expectedCount: 3 });

        // turns of 1,3, blocks 5,6
        await h.transition.advanceState({
            count: 2
        });

        await h.assert.sync.blockHeight({ expectedHeight: 6 });

        // peer 0 is leaving the channel, block 7

        const leaverIndex2 = await h.transition.participantLeave({
            waitForStatus: true
        });
        expect(leaverIndex2).to.equal(0);

        await h.assert.sync.participantCount({ expectedCount: 2 });

        // turns of 1,3, blocks 8,9
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });

        // Join peer 5 as spectator
        await h.addPeer();
        // stays 2, does not count spectators
        await h.assert.sync.participantCount({ expectedCount: 2 });
        const spectatorIndices = [4, 5];

        await h.transition.advanceState({
            count: 2,
            waitForPeers: [1, 3].concat(spectatorIndices),
            waitForFinalization: true
        });

        // Capture the state before malicious action
        const preDisputeForkId = h.activeForkId;
        h.event.resetEventSpies();

        // next is turn of peer 1
        const maliciousPeerIndex = 1;
        const honestPeerIndices = [3];
        await h.byzantine.submitInvalidStateTransitionBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: honestPeerIndices,
            expectedCount: 1
        });

        const { newForkId } = await h.dispute.resolveDisputeWait({
            honestPeerIndices
        });

        expect(preDisputeForkId).to.not.equal(
            newForkId,
            "Fork should have changed after dispute resolution"
        );

        for (const i of spectatorIndices) {
            // spectators disconnected from the channel when the dispute started
            expect(
                h.getPeer(i).stateManager.p2pManager.openConnections.length
            ).to.equal(
                0,
                `spectator peer ${i} should have 0 open P2P connections after dispute`
            );
            // spectator should have stayes on the pre-dispute fork
            expect(h.getPeer(i).stateManager.forkId).to.equal(
                preDisputeForkId,
                `spectator peer ${i} should be on new fork`
            );
        }
    });
});
