import { tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession, sleep } from "@test/harness";
import { hash as randomHash } from "@test/factory";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / disputerThrottle", function () {
    const evidenceTime = 2;

    it("second junk-forkId dispute from same peer within throttle window → dispute upload fails → ErrorDisputeThrottled", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(3, 0, {
            timeConfig: { evidenceTime }
        });
        await h.assert.sync.peersInSyncWait();
        h.event.resetEventSpies();

        // First dispute — opens a new window for a junk fork, throttle is set
        await h.tamper.postTamperedDispute(1, (dispute) => {
            dispute.input.forkId = randomHash();
            dispute.input.timeout.participant = ethers.ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = true;
        });

        // Second dispute from the same peer — throttle should block it
        try {
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });
            expect.fail("expected revert");
        } catch (error: unknown) {
            const customError = tryDecodeCustomError(error);
            expect(customError, "expected ErrorDisputeThrottled").to.not.be
                .null;
            expect(
                customError!.errorDescription.name,
                "expected ErrorDisputeThrottled"
            ).to.equal("ErrorDisputeThrottled");
        }
    });

    it("second junk-forkId dispute from same peer after throttle window → dispute upload succeeds", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(3, 0, {
            timeConfig: { evidenceTime }
        });
        await h.assert.sync.peersInSyncWait();
        h.event.resetEventSpies();

        // First dispute — sets the throttle
        await h.tamper.postTamperedDispute(1, (dispute) => {
            dispute.input.forkId = randomHash();
            dispute.input.timeout.participant = ethers.ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = true;
        });
        await sleep((evidenceTime + 1) * 1000);

        await h.tamper.postTamperedDispute(1, (dispute) => {
            dispute.input.forkId = randomHash();
            dispute.input.timeout.participant = ethers.ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = true;
        });
    });
});
