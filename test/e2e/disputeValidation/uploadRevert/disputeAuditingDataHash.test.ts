import { tryDecodeCustomError } from "@/utils";
import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";

function expectDecodedError(
    error: unknown,
    name: string,
    failMessage: string
): void {
    const customError = tryDecodeCustomError(error);
    expect(customError, failMessage).to.not.be.null;
    expect(customError!.errorDescription.name, failMessage).to.equal(name);
}

describe("E2E: dispute validation / uploadRevert / disputeAuditingDataHash", function () {
    it("with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();

        try {
            await h.tamper.postTamperedDispute(3, (dispute) => {
                DisputeTampering.tamperAuditingDataHash(dispute);
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            expectDecodedError(
                error,
                "ErrorAuditingDataHashMismatch",
                "expected ErrorAuditingDataHashMismatch"
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
            expectDecodedError(
                error,
                "ErrorDisputePostedAuditingDataMismatch",
                "expected ErrorDisputePostedAuditingDataMismatch"
            );
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
            expectDecodedError(
                error,
                "ErrorDisputePostedAuditingDataMismatch",
                "expected ErrorDisputePostedAuditingDataMismatch"
            );
        }
    });
});
