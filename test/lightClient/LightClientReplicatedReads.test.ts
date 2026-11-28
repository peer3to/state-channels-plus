// @distributed-requires: lightClient
import { assertLightClientSlotNode } from "@test/fixtures/lightClient/LightClientFollowWire";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

/**
 * Participants with the light client on over a peer3 slot node that serves
 * the light client endpoints, with every read the light client answers also
 * asked of the node at the same block: a dispute's replicated-state reads
 * decide as the chain does.
 */
describe("Light client replicated reads on a peer3 node", function () {
    before(function () {
        assertLightClientSlotNode();
    });

    it("reduces an invalid state transition dispute as the chain does, with no compared read differing from the node's", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            configOverrides: { LIGHT_CLIENT_COMPARE_READS: true }
        });
        const forkId = h.activeForkId!;
        const nextPeer = await h.query.getNextPeerToWrite();
        await h.byzantine.submitInvalidStateTransitionBlock(nextPeer.index);
        await h.assert.dispute.initiatedAndCommitedWait({
            initiatedWithAuditingData: false
        });
        const resolved = await h.dispute.resolveDisputeWait({ forkId });

        await h.assert.storage.honestPeersStoredNoDisputeFraudProofs();
        await h.assert.dispute.auditorsAgree(resolved.newForkId);
        expect(await h.query.onChainSlashedParticipants()).to.include(
            nextPeer.address
        );
        const counts = await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).lightClient.getCounts().request()
            )
        );
        // premise: every peer's chain access is the light client's, and it compared reads
        expect(counts.map((count) => count !== null)).to.deep.equal(
            h.peers.map(() => true)
        );
        expect(
            counts.map((count) => count!.readComparisons.matched > 0)
        ).to.deep.equal(h.peers.map(() => true));
        expect(
            counts.map((count) => count!.readComparisons.differed)
        ).to.deep.equal(h.peers.map(() => 0));
    });
});
