import { tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";
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

describe("E2E: dispute validation / uploadRevert / disputer", function () {
    // disputer field forged to not match the caller -> fails the msg.sender == disputer check
    // (a different guard than the eligibility check below).
    scenario(
        "dispute.input.disputer = ZeroAddress → dispute upload fails → ErrorDisputerNotMsgSender",
        {
            invariant: "authority",
            target: "DisputeInput.disputer:mismatched-sender"
        },
        async function () {
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
        }
    );

    scenario(
        "spectator (not an eligible participant) attempts to dispute → ErrorCantParticipateInDispute",
        {
            invariant: "authority",
            target: "DisputeInput.disputer:non-participant"
        },
        async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.assert.sync.peersInSyncWait();
            const spectator = await h.join.addSpectatorWait();

            try {
                // the spectator constructs + uploads its own dispute (disputer == itself), so the
                // sender check passes and the eligibility check is what rejects it.
                await h.tamper.postTamperedDispute(spectator.index, () => {}, {
                    markMalicious: false
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorCantParticipateInDispute",
                    "expected ErrorCantParticipateInDispute"
                );
            }
        }
    );
});
