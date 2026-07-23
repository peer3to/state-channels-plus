import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("EventSyncService", function () {
    it("treats a failed log as fatal - never re-dispatched, cursor holds", async function () {
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
        // the failure bubbles out of the detached promise
        expect(result.detachedError).to.equal("Expected event-sync rejection");
        // rescheduling after the failure replays the rejection, it does not retry
        expect(result.rescheduledError).to.equal(
            "Expected event-sync rejection"
        );
        expect(result.cursorAfter).to.equal(result.cursorBefore);
    });

    it("joins concurrent calldata recovery onto one chain query", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeConcurrentCalldataRecovery()
            .request();

        expect(result.queryCount).to.equal(2);
        expect(result.firstFound).to.equal(false);
        expect(result.secondFound).to.equal(false);
        expect(result.retryFound).to.equal(false);
    });
});
