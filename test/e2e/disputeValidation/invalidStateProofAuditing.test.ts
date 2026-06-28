import { Codec } from "@/utils";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { hexString } from "../../factory";
import { scenario } from "@test/harness/scenario";

describe("E2E: dispute validation / invalidStateProofAuditing", function () {
    scenario(
        "[calldata posted] auditingData.latestFinalizedStateStateMachineState = random → DisputeInvalidStateProof; proof author slashed",
        {
            invariant: "attacker-pays",
            target: "DisputeInput.disputeAuditingDataHash:proof-mismatch"
        },
        async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            const byzantineProofAuthorIndex = 2;
            h.contextApi.markMaliciousPeer({
                maliciousPeerIndex: byzantineProofAuthorIndex
            });

            let realAuditing!: DisputeAuditingDataStruct;
            const { dispute } = await h.tamper.postTamperedDispute(
                0,
                (d, _c, auditingData) => {
                    expect(d.postedAuditingData).to.equal(true);
                    expect(auditingData).to.not.be.undefined;
                    realAuditing = structuredClone(auditingData!);
                },
                { markMalicious: false }
            );

            await h.assert.dispute.committedWait({
                peersIndices: [0],
                expectedCount: 1
            });

            // corrupt some element of the auditing data so that the hash will not match the dispute.input.disputeAuditingDataHash
            // this should cause the proof author to be slashed
            const junkAuditing = structuredClone(realAuditing);
            junkAuditing.latestFinalizedStateStateMachineState = hexString(128);

            const proof = {
                proofType: toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeInvalidStateProof
                ),
                participant: dispute.input.disputer,
                dispute,
                encodedProof: Codec.encode(
                    { auditingData: junkAuditing },
                    DisputeFraudProofType.DisputeInvalidStateProof
                )
            };

            const tx = await h.channelManager
                .connect(h.getPeer(byzantineProofAuthorIndex).signer)
                .applyDisputeFraudProofs([proof]);
            await tx.wait();

            await h.assert.dispute.slashedOnChain(
                h.getPeer(byzantineProofAuthorIndex).address,
                "byzantine DisputeInvalidStateProof author must be on-chain slashed"
            );

            await h.event.waitWhileEventCountsStayAtMost(
                "onDisputeKilled",
                h.getHonestPeers().map((p) => p.index),
                { durationMs: 3000, maxCount: 0 }
            );

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        }
    );
});
