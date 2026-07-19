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
        expect(result.detachedError).to.equal("Expected event-sync rejection");
    });

    it("advances the processed-block cursor after a failed log is retried successfully", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeRetriedEventSyncLog()
            .request();

        expect(result.handlerCallCount).to.equal(2);
        expect(result.firstError).to.equal("Expected event-sync rejection");
        expect(result.cursorAfterFailure).to.equal(result.cursorBefore);
        expect(result.cursorAfterRetry).to.equal(result.blockNumber);
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
