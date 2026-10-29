import { Status } from "@/types";
import { stageMirrorMissingConsumedTopUp } from "@test/fixtures/MirrorDivergenceStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("E2E: local mirror divergence", function () {
    it("an auditor whose mirror misses a consumed top-up audits an honest self-removal dispute live → the chain answers its adverse balance check, no proof, no kill, no slash, the auditor keeps participating on the reduced fork", async function () {
        const h = TestSession.getHarness();
        const auditorIndex = 1;
        const leaverIndex = 2;
        // the idle next writer never times out: only the self-removal
        // dispute opens the window
        const held = await stageMirrorMissingConsumedTopUp(h, auditorIndex, {
            suppressWriterTimeouts: true
        });
        const forkId = h.activeForkId!;
        const reads = await h.mirror.observe(
            auditorIndex,
            "verifyBalanceInvariantCheckSnapshot"
        );

        // the dispute is posted on the leaver's behalf; its runtime must not
        // re-upload the same evidence
        await h.dispute.suppressDisputeInitiation([leaverIndex]);
        const remainingPeerIndices = await h.dispute.selfRemoveViaDisputeWait({
            leaverIndex,
            forkId
        });

        // the auditor's live audit reached the balance check: its mirror
        // answers invalid, the chain answers valid, and the chain wins
        await waitFor(async () => (await reads.observation()).chain.reads > 0);
        const { local, chain } = await reads.observation();
        expect(local.answers).to.deep.equal([false]);
        expect(chain.answers).to.deep.equal([true]);
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            [...remainingPeerIndices, leaverIndex],
            { durationMs: 4000 }
        );
        expect(
            await h
                .control(h.getPeer(auditorIndex))
                .query.getDisputeFraudProofTypes()
                .request()
        ).to.deep.equal([]);
        expect(
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).to.deep.equal([]);

        // the mirror catches up; the auditor resolves the fork with the rest
        await held.release();
        await h.dispute.resolveDisputeWait({
            forkId,
            assertMaliciousRemoved: false,
            honestPeerIndices: remainingPeerIndices
        });
        await h.assert.sync.participantCount({ expectedCount: 2 });
        expect(
            await h.control(h.getPeer(auditorIndex)).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);
    });
});
