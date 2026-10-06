import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Codec } from "@/utils";
import {
    expectConflictWithAuditorsFinalBlock,
    holdsState,
    localFinalizedHeight,
    replaceStateProof,
    stageBlindPendingBelowRealAnchor,
    stageColludersForkAfterAnchor
} from "@test/fixtures/DisputeAuditStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Plan 35 "Dispute that conflicts with a final state". Three colluders keep
// the chain anchor as the first block of their last milestone and fork right
// after it; Charlie synced past the anchor over the real final blocks and is
// pending, without the state at the anchor, so he cannot replay their tail.

describe("E2E: dispute validation / dispute that conflicts with a final state", function () {
    it("the colluders' omitted-data dispute that forks right after the chain anchor is killed on chain by pending Charlie's DisputeConflictsWithFinalState from his own final state, and its submitter is slashed", async function () {
        const h = TestSession.getHarness();
        const staged = await stageColludersForkAfterAnchor(h);
        const charlie = h.getPeer(staged.charlieIndex);
        const disputer = h.getPeer(0);
        const finalHeight = await localFinalizedHeight(h, staged.charlieIndex);
        expect(finalHeight ?? -1).to.be.greaterThan(staged.anchor.blockHeight);
        // the colluders hold every state: only Charlie's kill may land
        await Promise.all(
            [0, 1, 2].map((peerIndex) =>
                h.rpcStub.suppressDisputeKill(peerIndex)
            )
        );

        const { dispute } = await h.tamper.postTamperedDispute(0, (tampered) =>
            replaceStateProof(
                tampered,
                staged.dispute.input.stateProof.milestones
            )
        );
        expect(dispute.postedAuditingData).to.equal(false);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeConflictsWithFinalState,
            peerIndices: [staged.charlieIndex]
        });
        expect(
            await h.control(charlie).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([
            String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeConflictsWithFinalState
                )
            )
        ]);
        await h.event.waitForPeers(
            "onDisputeKilled",
            [1, 2, staged.charlieIndex],
            1,
            { mode: "atLeast" }
        );

        const kill = await readDisputeKill(h, disputer.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeConflictsWithFinalState
        ]);
        const counter = Codec.decode(
            kill.appliedEncodedProofs[0]!,
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        await expectConflictWithAuditorsFinalBlock(h, {
            auditorIndex: staged.charlieIndex,
            dispute,
            proof: counter,
            anchorHeight: staged.anchor.blockHeight,
            auditorFinalHeight: finalHeight!
        });
        await h.assert.dispute.slashedOnChainExactly([disputer.address]);
        // the counter needed no state at the anchor
        expect(
            await holdsState(h, staged.charlieIndex, staged.anchor)
        ).to.equal(false);
    });

    it("control: the participants' real history from the chain anchor, audited by a pending auditor that holds no conflicting final block and lacks the anchor state → no conflict counter, the missing replay state stays fatal", async function () {
        const h = TestSession.getHarness();
        const staged = await stageBlindPendingBelowRealAnchor(h);
        expect(staged.dispute.postedAuditingData).to.equal(false);
        expect(
            await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                staged.dispute
            ),
            "the anchor rule permits omitting the data"
        ).to.equal(true);

        const run = await h.dispute.auditDispute(
            staged.charlieIndex,
            staged.dispute
        );

        expect(run.outcome).to.equal("threw");
        expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
            "is not held"
        );
        expect(run.storedProof).to.equal(undefined);
        expect(run.disputeFraudProofCount).to.equal(0);
    });
});
