import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

// A dispute must carry a legitimate enforcement basis (timeout, on-chain
// slashes, or self-removal) - one with none is spam and gets killed with
// InvalidDisputeReason.

describe("dispute-validation / invalidDisputeReason", function () {
    it(
        "should kill a spam dispute with no legitimate enforcement basis",
        covers(
            {
                timeout: "absent",
                onChainSlashes: "empty",
                selfRemoval: "false",
                proofType: "InvalidDisputeReason"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({
                    timeConfig: { evidenceTime: 6 }
                });

                // Post a dispute from peer 1 that is internally valid but has no legitimate
                // enforcement basis: no timeout, no on-chain slashes, no self-removal.
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.timeout.participant =
                        "0x0000000000000000000000000000000000000000";
                    dispute.input.onChainSlashes = [];
                    dispute.input.selfRemoval = false;
                });

                await h.event.waitForAllPeers("onDisputeKilled", 1, {
                    mode: "atLeast"
                });

                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.InvalidDisputeReason
                    }
                );

                await h.dispute.resolveDisputeWait({
                    forkSettleTimeoutMs: 15000
                });
            }
        )
    );
});
