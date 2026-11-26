import { committedDisputeLogs } from "@test/fixtures/DisputeWindowWorkflowStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// the encoded size of the leaver's self-removal dispute in a three-peer
// channel after blocks 0..1: see the premise below
const SELF_REMOVAL_DISPUTE_BYTES = 2_144;

describe("E2E: dispute validation / uploadRevert / upload size cap", function () {
    it("an honest self-removal dispute whose encoded size equals the deployed upload cap → the chain commits it, no kill, no slash, the leaver leaves the reduced fork", async function () {
        const h = TestSession.getHarness();
        const leaverIndex = 2;
        await h.lifecycle.start(3, 2, {
            maxDisputeUploadBytes: SELF_REMOVAL_DISPUTE_BYTES
        }); // blocks 0..1
        const forkId = h.activeForkId!;
        // no idle-writer timeout: the self-removal is the only dispute
        for (const peer of h.peers)
            await h.rpcStub.suppressTimeoutCheck(peer.index);
        // the dispute is posted on the leaver's behalf; its runtime must not
        // re-upload the same evidence
        await h.dispute.suppressDisputeInitiation([leaverIndex]);

        const remainingPeerIndices = await h.dispute.selfRemoveViaDisputeWait({
            leaverIndex,
            forkId
        });

        const committed = await committedDisputeLogs(h);
        expect(committed).to.have.length(1);
        // premise: the dispute meets the cap
        expect(committed[0]!.encodedDisputeBytes).to.equal(
            Number(await h.channelManager.getMaxDisputeUploadBytes())
        );
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            [...remainingPeerIndices, leaverIndex],
            { durationMs: 4000 }
        );
        expect(
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).to.deep.equal([]);
        await h.dispute.resolveDisputeWait({
            forkId,
            assertMaliciousRemoved: false,
            honestPeerIndices: remainingPeerIndices
        });
        await h.assert.sync.participantCount({ expectedCount: 2 });
    });
});
