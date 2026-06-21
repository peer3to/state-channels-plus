import { tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
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

describe("E2E: dispute validation / uploadRevert / channelId", function () {
    it("dispute.input.channelId = random → dispute upload fails → ErrorCantParticipateInDispute", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();

        try {
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.channelId = randomHash();
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            expectDecodedError(
                error,
                "ErrorCantParticipateInDispute",
                "expected ErrorCantParticipateInDispute"
            );
        }
    });
});
