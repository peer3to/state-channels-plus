import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { expect } from "chai";

describe("E2E: dispute validation / uploadRevert / channelId", function () {
    it("dispute.input.channelId = random → dispute upload fails → ErrorCantParticipateInDispute", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const submitter = h.getPeer(1).address;
        const foreignChannelId = randomHash();

        try {
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.channelId = foreignChannelId;
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            const customError = expectDecodedError(
                error,
                "ErrorCantParticipateInDispute",
                "expected ErrorCantParticipateInDispute"
            );
            const args = customError.errorDescription.args;
            expect(args.channelId).to.equal(foreignChannelId);
            expect(String(args.participant).toLowerCase()).to.equal(
                submitter.toLowerCase()
            );
        }
    });
});
