import { tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

function expectDecodedError(
    error: unknown,
    name: string,
    failMessage: string
): void {
    const customError = tryDecodeCustomError(error);
    expect(customError, failMessage).to.not.be.null;
    expect(customError!.errorDescription.name, failMessage).to.equal(name);
}

describe("E2E: dispute validation / uploadRevert / disputer", function () {
    it("dispute.input.disputer = ZeroAddress → dispute upload fails → ErrorDisputerNotMsgSender", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();

        try {
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.disputer = ethers.ZeroAddress;
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            expectDecodedError(
                error,
                "ErrorDisputerNotMsgSender",
                "expected ErrorDisputerNotMsgSender"
            );
        }
    });
});
