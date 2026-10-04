import { hexString } from "../../../factory";
import { Bytes } from "@/types";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

// A junk encodedBlock cannot be decoded on-chain.
// hasStateProofHeaderMismatch treats it as no mismatch, and the structure
// check of the last milestone yields a fireable DisputeInvalidBlockStructure
// at the undecodable position.

describe("E2E: dispute validation / stateProof / undecodableBlock", function () {
    it("stateProof.milestones[-1].blockConfirmations[-1].signedBlock.encodedBlock = junk → DisputeInvalidBlockStructure", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();
        const forkId = h.activeForkId!;

        await h.tamper.stubConstructDispute(
            3,
            (dispute, _sm, args) => {
                const sb = dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!.signedBlock;
                // Replace encodedBlock with junk data, will cause abi.decode to revert
                sb.encodedBlock = args.junkBlock as Bytes;
            },
            { autoRestore: true, args: { junkBlock: hexString(128) } }
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
                DisputeFraudProofType.DisputeInvalidBlockStructure
        });
        await h.dispute.resolveDisputeWait({
            forkId,
            syntheticOnChainParticipants: 1
        });
    });
});
