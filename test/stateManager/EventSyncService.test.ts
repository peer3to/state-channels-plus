import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("EventSyncService", function () {
    it("retains a rejected log promise and holds the processed-block cursor", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeRejectedEventSyncLog()
            .request();

        expect(result.samePromise).to.equal(true);
        expect(result.handlerCallCount).to.equal(1);
        expect(result.firstError).to.equal("Expected event-sync rejection");
        expect(result.secondError).to.equal("Expected event-sync rejection");
        expect(result.cursorAfter).to.equal(result.cursorBefore);
    });
});
