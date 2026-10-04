import { DisputeFraudProofType } from "@/types/sol-enums";
import { stageHistoryWithoutCharlie } from "@test/fixtures/StateProofLifecycleStaging";
import {
    expectUnfinalTailStateProof,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";

// Case 9: Charlie joined and is in the chain's required set, but never
// signed the history Alice and Bob authored after his join. Charlie relies
// on that requirement, not on Alice's and Bob's history, to keep the
// auditing data available.
describe("E2E: dispute validation / stateProof / Case 9 (history without a required signer)", function () {
    it("longer alternate history without Charlie's signature cannot omit auditing calldata", async function () {
        const h = TestSession.getHarness();
        const { alice, charlie, release } = await stageHistoryWithoutCharlie(h);
        try {
            await h
                .control(h.getPeer(alice))
                .dispute.setForceExit(true)
                .request();
            const { dispute } = await h.tamper.postTamperedDispute(
                alice,
                (dispute) => {
                    dispute.postedAuditingData = false;
                }
            );
            // a threshold-final first block, then the run Charlie never signed
            expectUnfinalTailStateProof(dispute.input.stateProof);
            expect(
                await h.channelManager.isLastMilestoneFinalByEveryone.staticCall(
                    dispute
                ),
                "the required set names Charlie"
            ).to.equal(false);

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
                peerIndices: [charlie]
            });
            await h.event.waitForPeers("onDisputeKilled", [charlie], 1, {
                mode: "atLeast"
            });
            const slashed = await h.query.onChainSlashedParticipants(charlie);
            expect(slashed).to.include(h.getPeer(alice).address);
            expect(slashed).to.not.include(h.getPeer(charlie).address);
        } finally {
            await release();
        }
    });
});
