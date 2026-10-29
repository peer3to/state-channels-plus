import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / disputeAuditingDataHash", function () {
    it("with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();

        let tamperedAuditingDataHash = "";
        try {
            await h.tamper.postTamperedDispute(3, (dispute) => {
                DisputeTampering.tamperAuditingDataHash(dispute);
                tamperedAuditingDataHash = ethers.hexlify(
                    dispute.input.disputeAuditingDataHash
                );
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            const customError = expectDecodedError(
                error,
                "ErrorAuditingDataHashMismatch",
                "expected ErrorAuditingDataHashMismatch"
            );
            const args = customError.errorDescription.args;
            // the dispute claimed the tampered hash; the uploaded data hashes
            // to something else, which is exactly the mismatch
            expect(args.expectedAuditingDataHash).to.equal(
                tamperedAuditingDataHash
            );
            expect(args.providedAuditingDataHash).to.not.equal(
                tamperedAuditingDataHash
            );
        }
    });

    // both upload entry points below are what stop a committed dispute from
    // reaching an auditor with postedAuditingData set but no data alongside it
    // -> validateDispute never hits its "auditing data missing" throw
    it("postedAuditingData true uploaded without calldata → dispute upload fails → ErrorDisputePostedAuditingDataMismatch", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();
        const peer = h.getPeer(3);

        const { dispute, disputeConfirmation } =
            await h.dispute.fetchConstructedDispute(peer.index);
        expect(dispute.postedAuditingData).to.equal(true);
        await h.tamper.resignDispute(peer.signer, dispute, disputeConfirmation);

        try {
            await peer.p2pInstance.stateChannelManagerContract.uploadDispute(
                disputeConfirmation
            );
            expect.fail("expected revert");
        } catch (error: unknown) {
            const customError = expectDecodedError(
                error,
                "ErrorDisputePostedAuditingDataMismatch",
                "expected ErrorDisputePostedAuditingDataMismatch"
            );
            const args = customError.errorDescription.args;
            expect(args.expectedPostedAuditingData).to.equal(false);
            expect(args.actualPostedAuditingData).to.equal(true);
        }
    });

    it("postedAuditingData false uploaded with calldata → dispute upload fails → ErrorDisputePostedAuditingDataMismatch", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const peer = h.getPeer(0);

        const { dispute, disputeConfirmation, auditingData } =
            await h.dispute.fetchConstructedDispute(peer.index);
        expect(dispute.postedAuditingData).to.equal(false);
        await h.tamper.resignDispute(peer.signer, dispute, disputeConfirmation);

        try {
            await peer.p2pInstance.stateChannelManagerContract.uploadDisputeWithCalldata(
                disputeConfirmation,
                auditingData
            );
            expect.fail("expected revert");
        } catch (error: unknown) {
            const customError = expectDecodedError(
                error,
                "ErrorDisputePostedAuditingDataMismatch",
                "expected ErrorDisputePostedAuditingDataMismatch"
            );
            const args = customError.errorDescription.args;
            expect(args.expectedPostedAuditingData).to.equal(true);
            expect(args.actualPostedAuditingData).to.equal(false);
        }
    });
});
