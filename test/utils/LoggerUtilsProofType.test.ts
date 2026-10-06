import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import { LoggerUtils } from "@/utils/LoggerUtils";
import * as factory from "@test/factory";
import { expect } from "chai";

// The chain carries a proof type as a small Solidity number, and both proof
// families reuse the same small numbers (BlockDoubleSign and
// DisputeNotLatestState are both 0). Each lookup must name the key of its own
// family.

describe("LoggerUtils proof-type names", function () {
    it("getDisputeFraudProofMeta names the DisputeFraudProofType key, never the FraudProofType key with the same small number", function () {
        const dispute = factory.dispute();
        const killReason = (proofType: number) =>
            LoggerUtils.getDisputeFraudProofMeta(
                factory.disputeFraudProof(dispute, { proofType })
            ).killReason;

        expect(killReason(0)).to.equal("DisputeNotLatestState");
        expect(killReason(0)).to.not.equal(FraudProofType[100]);
        expect(killReason(1)).to.equal("DisputeInvalidOutputState");
        expect(killReason(1)).to.not.equal(FraudProofType[101]);
        expect(killReason(19)).to.equal("TimeoutSupersededByFinalState");
        expect(killReason(20)).to.equal("DisputeConflictsWithFinalState");
        expect(
            killReason(
                DisputeFraudProofType.DisputeConflictsWithFinalState - 200
            )
        ).to.equal("DisputeConflictsWithFinalState");
    });

    it("getFraudProofMetadata names the FraudProofType key for each small number", function () {
        const proofTypes = LoggerUtils.getFraudProofMetadata([
            factory.fraudProof({ proofType: 0 }),
            factory.fraudProof({ proofType: 1 }),
            factory.fraudProof({ proofType: 4 })
        ]).map((meta) => meta.proofType);

        expect(proofTypes).to.deep.equal([
            "BlockDoubleSign",
            "BlockInvalidStateTransition",
            "ForgedInboundMessageBlock"
        ]);
    });

    it("an unknown proof type gives UNKNOWN(n) in both lookups", function () {
        const dispute = factory.dispute();

        expect(
            LoggerUtils.getDisputeFraudProofMeta(
                factory.disputeFraudProof(dispute, { proofType: 99 })
            ).killReason
        ).to.equal("UNKNOWN(99)");
        expect(
            LoggerUtils.getFraudProofMetadata([
                factory.fraudProof({ proofType: 5 })
            ])[0].proofType
        ).to.equal("UNKNOWN(5)");
    });
});
