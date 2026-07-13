import { FraudProofType } from "@/types/sol-enums";
import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";

// dispute.input.disputeAuditingDataHash is irrelevant in the no-calldata path:
// the on-chain validator only checks it when calldata is posted alongside the
// dispute upload. With no calldata, the field is unused and the dispute resolves
// normally. (The calldata-path counterpart lives in
// disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts, where the
// upload itself reverts with ErrorAuditingDataHashMismatch.)

describe("E2E: dispute validation / disputeInputFields / disputeAuditingDataHash", function () {
    it("no calldata: dispute.input.disputeAuditingDataHash tampered → dispute commits, no DisputeInvalidStateProof or other audit-data fraud proof", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            timeConfig: { evidenceTime: 6 }
        });

        await h.tamper.stubConstructDispute(
            0,
            DisputeTampering.tamperAuditingDataHash,
            {
                autoRestore: true,
                markMalicious: false
            }
        );

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait();

        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockDoubleSign,
            maliciousPeerIndex: 1
        });

        // Assert no honest peer fires onDisputeKilled — the no-calldata path
        // does not audit disputeAuditingDataHash, so the tampered hash is silently
        // ignored and no DisputeInvalid* fraud proof fires against this dispute.
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            h.getHonestPeers().map((p) => p.index),
            { durationMs: 3000, maxCount: 0 }
        );

        await h.dispute.resolveDisputeWait();

        await h.assert.sync.maliciousPeerExcluded();
        // preDisputeSetup defaults to 3 peers; one malicious peer (the double-signer)
        // is excluded from the participant set, leaving 2 honest participants.
        await h.assert.sync.participantCount({ expectedCount: 2 });
    });
});
