import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / stateProof / milestone block content integrity", function () {
    describe("stateProof.milestones[-1].blockConfirmations[-1].header.transactionCnt", function () {
        it("transactionCnt += 5 → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 6 }
            });
            await h.byzantine.disconnect(3);
            await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(0, async (dispute) => {
                const stateProof = dispute.input.stateProof;

                const localDiamond = h.getLocalDiamond(0);
                const [hasBlock, latestBlock] =
                    await localDiamond.getLatestBlockFromStateProof(stateProof);
                if (!hasBlock) {
                    throw new Error(
                        "State proof does not contain a block to tamper with"
                    );
                }

                latestBlock.transaction.header.transactionCnt =
                    BigInt(latestBlock.transaction.header.transactionCnt) + 5n;

                stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!.signedBlock.encodedBlock =
                    Codec.encode(latestBlock as never, Type.Block);
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });
});
