import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: Byzantine error attribution", function () {
    it("suppresses a stray detached error originating on a malicious peer", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

        await h.execOnHost(h.getPeer(1), () => {
            void Promise.reject(new Error("byzantine peer stray error"));
        });

        // the error carries peer 1's address -> ignored, nothing recorded
        const err = await TestSession.consumeFirstDetachedError(1500);
        expect(
            err,
            `expected the byzantine peer's error to be suppressed, got: ${err?.message}`
        ).to.equal(undefined);
    });

    it("does not suppress the same error when it comes from an honest peer", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);

        await h.execOnHost(h.getPeer(1), () => {
            void Promise.reject(new Error("honest peer stray error"));
        });

        // honest-peer errors must still be recorded

        await TestSession.expectFirstDetachedError({
            includes: "honest peer stray error",
            timeoutMs: 5000
        });
    });
});
