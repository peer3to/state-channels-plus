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

        // Start peer 4 while the remaining participants produce blocks 3-6 and
        // keep authoring until it is synced: its initial sync must finish
        // before the next leave advances the snapshot its spectate proof is
        // pinned to, and the writer slot must not idle while it syncs.
        const spawned4 = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 3],
            minimumBlocks: 4,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        expect(spawned4.height).to.be.greaterThanOrEqual(6);

        const spectator4 = spawned4.peer;
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 3, spectator4.index]
        });

        // stays 3, does not count spectators
        await h.assert.sync.participantCount({ expectedCount: 3 });

        // Peer 0 is leaving the channel. The keep-alive authoring above wrote
        // as many blocks as the spawn needed, so bring the turn back around to
        // peer 0 before it leaves instead of assuming the block count.
        await h.transition.keepAuthoringUntil({
            until: async () => (await h.query.getNextPeerToWrite()).index === 0,
            waitForPeers: [0, 1, 3],
            maximumBlocks: 20
        });
        const leaverIndex2 = await h.transition.participantLeaveDetached({
            leaverIndex: 0
        });
        expect(leaverIndex2).to.equal(0);

        await h.assert.sync.participantCount({ expectedCount: 2 });

        // Start peer 5 while peers 1 and 3 produce at least blocks 8-11 and
        // keep authoring until it is synced.
        const { peer: spectator5 } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [1, 3],
            minimumBlocks: 4,
            maximumBlocks: 20,
            waitForFinalization: true
        });

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
