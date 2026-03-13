import { TestSession, PeerTestHarness } from "@test/harness";
import { expect } from "chai";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: Join/Leave Sequence", function () {
    it("join/leave sequence and fork resolution", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 0, {
            timeConfig: {
                p2pTime: 30,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });
        let peerIndices = [0, 1, 2, 3];
        let spectatorIndices = [];

        await h.transition.advanceState({ count: 2 });

        // Leave peer 2
        await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
        await h.assert.sync.participantCount({ expectedCount: 3 });

        peerIndices = [0, 1, 3];

        // turns of 3,0
        await h.transition.advanceState({ count: 2 });

        // Join peer 4 as spectator
        await h.addPeer(); // This adds peer index 4 as spectator
        await h.event.waitUntilEventOccurs("onConnection", 5000, [4]);
        await h.assert.sync.peersInSyncWait();
        await h.assert.sync.participantCount({ expectedCount: 3 });

        spectatorIndices = [4];

        // turns of 1,3
        await h.transition.advanceState({
            count: 2,
            waitForPeers: peerIndices.concat(spectatorIndices)
        });

        // peer 0 is leaving the channel

        await h.transition.advanceState({
            txFn: (c) => c.leaveChannel(),
            waitForPeers: peerIndices
        });
        await h.assert.sync.participantCount({ expectedCount: 2 });
        peerIndices = [1, 3];

        // turns of 1,3
        await h.transition.advanceState({
            count: 2,
            waitForPeers: peerIndices
        });

        // Join peer 5 as spectator
        await h.addPeer();
        await h.event.waitUntilEventOccurs("onConnection", 5000, [5]);
        await h.assert.sync.peersInSyncWait();
        await h.assert.sync.participantCount({ expectedCount: 2 });
        spectatorIndices = [4, 5];

        await h.transition.advanceState({
            count: 2,
            waitForPeers: peerIndices.concat(spectatorIndices)
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

        await h.dispute.resolveDisputeWait({
            maliciousPeerIndex,
            forkSettleTimeoutMs: 15000,
            disputesCommittedTimeoutMs: 10000,
            honestPeerIndices: honestPeerIndices.concat(spectatorIndices)
        });

        const postDisputeForkId = h.activeForkId;
        expect(preDisputeForkId).to.not.equal(
            postDisputeForkId,
            "Fork should have changed after dispute resolution"
        );

        for (const i of spectatorIndices) {
            expect(h.getPeer(i).stateManager.forkId).to.equal(
                postDisputeForkId,
                `spectator peer ${i} should be on new fork`
            );
        }
    });
});
