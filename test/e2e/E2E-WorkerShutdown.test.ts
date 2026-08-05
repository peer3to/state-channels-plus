import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: worker shutdown", function () {
    it("drains and tears down multiple threaded peers promptly", async function () {
        const harness = TestSession.getHarness();
        await harness.lifecycle.start(3, 1, {
            configOverrides: { RUN_SDK_IN_THREAD: true }
        });

        const startedAt = Date.now();
        await harness.cleanup();

        expect(Date.now() - startedAt).to.be.lessThan(5_000);
        expect(harness.peers.length).to.equal(0);
    });
});
