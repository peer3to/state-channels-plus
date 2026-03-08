import { TestSession, PeerTestHarness } from "@test/harness";

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

        // 0,1
        await h.transition.advanceState({ count: 2 });

        //  peer 2 is leaving the channel
        // left with peers [0, 1, 3]
        // 2
        let nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
        await h.assert.sync.participantCount({ expectedCount: 3 });

        peerIndices = [0, 1, 3];

        // 3
        nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({ count: 1 });

        // 0
        nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({ count: 1 });

        await h.addPeer(); // This adds peer index 4 as spectator
        await h.event.waitUntilEventOccurs("onConnection", 5000, [4]);
        await h.assert.sync.peersInSyncWait();
        await h.assert.sync.participantCount({ expectedCount: 3 });
        peerIndices = [0, 1, 3, 4];
        // 1
        nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({
            count: 1,
            waitForPeers: peerIndices
        });

        // 3
        nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({
            count: 1,
            waitForPeers: peerIndices
        });

        // peer 0 is leaving the channel
        // left with peers [1, 3] and peer 4 is a spectator

        nextPeert = await h.query.getNextPeerToWrite();
        peerIndices = [1, 3, 4];
        console.log(
            "Next to write: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({
            txFn: (c) => c.leaveChannel(),
            waitForPeers: peerIndices
        });
        await h.assert.sync.participantCount({ expectedCount: 2 });

        // 1
        nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write after peer 0  has left: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({
            count: 1,
            waitForPeers: peerIndices
        });

        // 3
        nextPeert = await h.query.getNextPeerToWrite();
        console.log(
            "Next to write after peer 3 has left: peer index",
            nextPeert.index,
            "address",
            nextPeert.address
        );
        await h.transition.advanceState({
            count: 1,
            waitForPeers: peerIndices
        });

        // await h.addPeer();
        // await h.event.waitUntilEventOccurs("onConnection", 5000, [5]);
        // await h.assert.sync.peersInSyncWait();
        // await h.assert.sync.participantCount({ expectedCount: 2 });

        // await h.transition.advanceState({ count: 2 });
        // await h.assert.sync.peersInSyncWait();

        // // Capture the state before malicious action
        // const preDisputeForkId = h.activeForkId;
        // h.event.resetEventSpies();

        // const maliciousPeerIndex = 1;
        // await h.byzantine.submitInvalidStateTransitionBlock(maliciousPeerIndex);

        // await h.assert.dispute.initiatedAndCommitedWait();

        // await h.dispute.resolveDisputeWait({
        //     maliciousPeerIndex,
        //     forkSettleTimeoutMs: 15000,
        //     disputesCommittedTimeoutMs: 10000
        // });

        // const postDisputeForkId = h.activeForkId;
        // expect(preDisputeForkId).to.not.equal(postDisputeForkId, "Fork should have changed after dispute resolution");

        // await h.transition.fromHonestPeersOnly((c) => c.add(11));
        // await h.transition.fromHonestPeersOnly((c) => c.add(12));

        // const allPeerIndices = [0, 2, 3, 4, 5, 6, 7]; // excluding malicious peer 1
        // await h.assert.sync.peersInSyncWait({ peerIndices: allPeerIndices });
    });
});
