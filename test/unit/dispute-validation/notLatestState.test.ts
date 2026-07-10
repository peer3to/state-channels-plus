import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

describe("dispute-validation / notLatestState", function () {
    it(
        "dispute.input.stateProof truncated below disputer's last signed block → DisputeNotLatestState",
        covers(
            {
                stateProof: "truncated-below-latest",
                proofType: "DisputeNotLatestState",
                carrier: "genesis",
                postedAuditingData: "false"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();

                await h.transition.advanceState({ count: 3 });
                //  now it is peer 2 turn, current block height is 4 (5 transactions done)

                // Stub peer 0's constructDispute: truncate state proof to height 2 so the dispute
                // shows latest at block 2, while peer 0 has actually signed block 4.
                h.tamper.stubConstructDispute(0, async (dispute, sm) => {
                    await sm.p2pManager.localRpc.dispute.truncateStateProofToHeight(
                        dispute,
                        2
                    );
                    const sp = dispute.input.stateProof;
                    if (
                        sp.milestones.length !== 0 ||
                        sp.signedBlocks.length !== 0
                    ) {
                        throw new Error("expected empty (genesis) state proof");
                    }
                });

                //  peer 1 submits a double sign block
                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedAndCommitedWait({
                    peersIndices: [0],
                    initiatedWithAuditingData: false
                });

                await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                    mode: "atLeast"
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.DisputeNotLatestState,
                        timeoutMs: 10000
                    }
                );
                await h.dispute.resolveDisputeWait();
            }
        )
    );
});
