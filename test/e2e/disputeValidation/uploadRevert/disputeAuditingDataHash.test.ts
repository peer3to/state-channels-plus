import { tryDecodeCustomError } from "@/utils";
import {
    DisputeTampering,
    MathTestSession as TestSession
} from "@test/harness";
import { expect } from "chai";
import { scenario } from "@test/harness/scenario";

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
    scenario(
        "with calldata: dispute.input.disputeAuditingDataHash tampered → dispute upload fails → ErrorAuditingDataHashMismatch",
        {
            invariant: "attacker-pays",
            target: "DisputeInput.disputeAuditingDataHash:tampered"
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
    );
});
