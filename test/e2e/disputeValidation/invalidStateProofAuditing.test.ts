import { Codec, Type, hash } from "@/utils";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { hexString } from "../../factory";

describe("E2E: dispute validation / invalidStateProofAuditing", function () {
    it("[calldata posted] auditingData.latestFinalizedStateStateMachineState = random → proof author slashed; valid dispute resolves", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();
        const forkId = h.activeForkId!;

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
                realAuditing = globalThis.structuredClone(auditingData!);
            },
            { markMalicious: false }
        );

        await h.assert.dispute.committedWait({
            peersIndices: [0],
            expectedCount: 1
        });

        // corrupt some element of the auditing data so that the hash will not match the dispute.input.disputeAuditingDataHash
        // this should cause the proof author to be slashed
        const junkAuditing = globalThis.structuredClone(realAuditing);
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

        const tx = await h
            .getPeer(byzantineProofAuthorIndex)
            .p2pInstance.stateChannelManagerContract.applyDisputeFraudProofs([
                proof
            ]);
        await tx.wait();

        await h.assert.dispute.slashedOnChain(
            h.getPeer(byzantineProofAuthorIndex).address,
            "byzantine DisputeInvalidStateProof author must be on-chain slashed"
        );

        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            dispute.input.forkId
        );
        expect(commitments).to.include(
            hash(Codec.encode(dispute, Type.Dispute))
        );

        // The invalid proof must not alter the valid dispute commitment. Its
        // author is added to the window's on-chain slash set, so normal
        // reduction must settle the fork without that participant.
        await h.dispute.resolveDisputeWait({
            forkId,
            // preDisputeSetupCalldataPath force-joins one non-harness wallet.
            syntheticOnChainParticipants: 1
        });
    });
});
