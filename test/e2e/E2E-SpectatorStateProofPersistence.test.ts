import { TestSession, PeerTestHarness } from "@test/harness";
import { expect } from "chai";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: Join/Leave Sequence", function () {
    it.only("join/leave sequence and fork resolution", async function () {
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

        // blocks 0, 1
        await h.transition.advanceState({ count: 2 });

        // Leave peer 2, block 2
        await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
        //  hack until https://github.com/peer3to/state-channels-plus/pull/298 merged
        await h.byzantine.disconnect(2);
        await h.assert.sync.participantCount({ expectedCount: 3 });

        peerIndices = [0, 1, 3];

        // turns of 3,0, blocks 3,4
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true,
            waitForPeers: peerIndices
        });

        // Join peer 4 as spectator
        await h.addPeer(); // This adds peer index 4 as spectator
        await h.event.waitUntilEventOccurs("onConnection", 5000, [4]);
        await h.assert.sync.participantCount({ expectedCount: 3 });

        spectatorIndices = [4];

        // await sleep(1000)

        // turns of 1,3, blocks 5,6
        await h.transition.advanceState({
            count: 2,
            waitForPeers: peerIndices.concat(spectatorIndices),
            waitForFinalization: true
        });

        // peer 0 is leaving the channel, block 7

        await h.transition.advanceState({
            txFn: (c) => c.leaveChannel(),
            waitForPeers: peerIndices.concat(spectatorIndices),
            waitForFinalization: true
        });
        //  hack until https://github.com/peer3to/state-channels-plus/pull/298 merged
        await h.byzantine.disconnect(0);

        await h.assert.sync.participantCount({ expectedCount: 2 });
        peerIndices = [1, 3];
        //  get next to write
        let nextToWrite = await h.query.getNextPeerToWrite();
        expect(nextToWrite.index).to.equal(1, "next to write should be peer 1");
        // turns of 1,3, blocks 8,9

        // Fails with
        /*
        Error: NOT MY TURN: playTransaction start:  - myAddress: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
        - nextToWrite: 0x90F79bf6EB2c4f870365E785982E1f101E93b906
        - txHeight: 9 - latestStoredHeight: 8 - nextStoredHeight: 9 -
        */

        //  I expect it to be resolved once a leaving partiapcnt triger snasphot update on chain which trigger status change to SYNCED
        await h.transition.advanceState({
            count: 2,
            waitForPeers: peerIndices.concat(spectatorIndices),
            waitForFinalization: true
        });

        // Join peer 5 as spectator
        await h.addPeer();
        await h.event.waitUntilEventOccurs("onConnection", 5000, [5]);
        await h.assert.sync.participantCount({ expectedCount: 2 });
        spectatorIndices = [4, 5];
        //  get next to write
        nextToWrite = await h.query.getNextPeerToWrite();
        expect(nextToWrite.index).to.equal(1, "next to write should be peer 1");

        await h.transition.advanceState({
            count: 2,
            waitForPeers: peerIndices.concat(spectatorIndices),
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
