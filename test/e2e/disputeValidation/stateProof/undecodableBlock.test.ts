import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { hexString } from "../../../factory";

// A truncated encodedBlock cannot be decoded by abi.decode on-chain.
// hasStateProofHeaderMismatch.staticCall reverts; DisputeValidationService must
// catch that revert and still produce a fireable DisputeInvalidStateProof.

describe("E2E: dispute validation / stateProof / undecodableBlock", function () {
    it("stateProof.milestones[-1].blockConfirmations[-1].signedBlock.encodedBlock = junk → DisputeInvalidStateProof", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();

        h.tamper.stubConstructDispute(
            3,
            (dispute) => {
                const sb = dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!.signedBlock;
                // Replace encodedBlock with junk data, will cause abi.decode to revert
                sb.encodedBlock = hexString(128);
            },
            { autoRestore: true }
        );

        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedWait({
            peersIndices: [3],
            initiatedWithAuditingData: true
        });
        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidStateProof,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait({ syntheticOnChainParticipants: 1 });
    });
});
