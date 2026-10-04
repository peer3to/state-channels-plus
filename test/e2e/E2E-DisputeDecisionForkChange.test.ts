import { stageHeldNoReasonDisputeDecision } from "@test/fixtures/StateProofLifecycleStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// A threshold-final self-removal dispute moves every peer to its output fork
// at once, while peer 0 still decides an ordinary dispute of the old fork. Decisions
// are made for the current fork only: the parked decision must send no
// old-fork evidence, and peer 0 still completes the final dispute.
describe("E2E: dispute decision across a real fork change", function () {
    it("a threshold-final dispute moves the fork while the audit of a no-reason dispute is held → the audit ends without old-fork evidence, the final fork is completed", async function () {
        const h = TestSession.getHarness();
        const staged = await stageHeldNoReasonDisputeDecision(h, "audit");
        const final = await h.dispute.submitFinalDisputeFromStoredEvidence({
            forkId: staged.forkId,
            finalAuthorPeerIndex: staged.finalAuthor
        });
        // peer 0 completes the final dispute while its audit is parked
        await h.dispute.resolveDisputeWait({
            forkId: staged.forkId,
            honestPeerIndices: staged.remaining,
            // a handler's event reaches the spies once it returns: peer 0's
            // parked one counts only after release
            expectedDisputesCommittedPerPeer: 1,
            assertMaliciousRemoved: false,
            expectedResolution: {
                kind: "final-dispute",
                forkId: final.finalResolution.forkId,
                genesisTimestamp: final.finalResolution.genesisTimestamp,
                assertParticipantsRemain: true
            }
        });

        await staged.release();
        // the audit ran to its false verdict and stored its proof
        const decider = h.control(h.getPeer(staged.decider));
        await waitFor(
            async () =>
                (await decider.query.getDisputeFraudProofTypes().request())
                    .length > 0
        );
        // absence window: a kill would follow the verdict at once
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            staged.remaining,
            { durationMs: 3000 }
        );
        expect(await staged.applies.applies()).to.deep.equal([]);
        expect((await h.peerForkIds([h.getPeer(staged.decider)]))[0]).to.equal(
            final.finalResolution.forkId
        );
    });

    it("a threshold-final dispute moves the fork while the kill's replay-gas read is held → no old-fork transaction, the final fork is completed", async function () {
        const h = TestSession.getHarness();
        const staged = await stageHeldNoReasonDisputeDecision(
            h,
            "gasPreparation"
        );
        const final = await h.dispute.submitFinalDisputeFromStoredEvidence({
            forkId: staged.forkId,
            finalAuthorPeerIndex: staged.finalAuthor
        });
        // peer 0 completes the final dispute while its kill is parked
        await h.dispute.resolveDisputeWait({
            forkId: staged.forkId,
            honestPeerIndices: staged.remaining,
            // a handler's event reaches the spies once it returns: peer 0's
            // parked one counts only after release
            expectedDisputesCommittedPerPeer: 1,
            assertMaliciousRemoved: false,
            expectedResolution: {
                kind: "final-dispute",
                forkId: final.finalResolution.forkId,
                genesisTimestamp: final.finalResolution.genesisTimestamp,
                assertParticipantsRemain: true
            }
        });

        // the parked read resolves; the kill then sends nothing
        await staged.release();
        // absence window: an old-fork send would follow the read at once
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            staged.remaining,
            { durationMs: 3000 }
        );
        expect(await staged.applies.applies()).to.deep.equal([]);
        expect((await h.peerForkIds([h.getPeer(staged.decider)]))[0]).to.equal(
            final.finalResolution.forkId
        );
    });
});
