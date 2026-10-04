import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { stageTimeoutThresholdDispute } from "@test/fixtures/EarlyTimeoutRetryStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: dispute validation / timeoutThreshold", function () {
    it("a pending joiner blames the author of a block every participant signed → TimeoutThreshold, killed on chain", async function () {
        const h = TestSession.getHarness();
        const { joiner, height, posted } =
            await stageTimeoutThresholdDispute(h);
        expect(posted.dispute.input.disputer).to.equal(joiner.address);
        expect(Number(posted.dispute.input.timeout.blockHeight)).to.equal(
            height
        );

        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType: DisputeFraudProofType.TimeoutThreshold,
            peerIndices: [0, 1]
        });
        for (const index of [0, 1]) {
            const proofTypes = await h
                .control(h.getPeer(index))
                .query.getDisputeFraudProofTypes()
                .request();
            expect(proofTypes).to.deep.equal([
                String(
                    toSolidityDisputeFraudProofType(
                        DisputeFraudProofType.TimeoutThreshold
                    )
                )
            ]);
        }
        await h.assert.dispute.slashedOnChain(joiner.address);
    });
});
