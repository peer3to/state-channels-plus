import { tryDecodeCustomError } from "@/utils";
import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";
import { covers } from "../domain";

function expectDecodedError(
    error: unknown,
    name: string,
    failMessage: string
): void {
    const customError = tryDecodeCustomError(error);
    expect(customError, failMessage).to.not.be.null;
    expect(customError!.errorDescription.name, failMessage).to.equal(name);
}

describe("dispute-upload / uploadRevert / disputeAuditingDataHash", function () {
    it(
        "with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch",
        covers(
            {
                uploadRevert: "ErrorAuditingDataHashMismatch"
            },
            async function () {
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
            }
        )
    );
});
