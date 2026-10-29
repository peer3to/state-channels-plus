import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / disputer", function () {
    it("dispute.input.disputer = ZeroAddress → dispute upload fails → ErrorDisputerNotMsgSender", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const submitter = h.getPeer(1).address;

        try {
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.disputer = ethers.ZeroAddress;
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            const customError = expectDecodedError(
                error,
                "ErrorDisputerNotMsgSender",
                "expected ErrorDisputerNotMsgSender"
            );
            const args = customError.errorDescription.args;
            expect(args.expectedDisputer).to.equal(ethers.ZeroAddress);
            expect(String(args.actualSender).toLowerCase()).to.equal(
                submitter.toLowerCase()
            );
        }
    });
});
