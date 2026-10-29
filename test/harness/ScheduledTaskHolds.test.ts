// @spec-test-coverage-ignore: harness helper contract test; the helper is test infrastructure with no specification or implementation IDs
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("scheduled task holds", function () {
    it("keeps the newer prefix held when the older prefix is restored first", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const stub = h.control(h.getPeer(0)).stub;
        await stub.stubHoldScheduledTasks("older-").request();
        await stub.stubHoldScheduledTasks("newer-").request();

        expect(
            await h
                .control(h.getPeer(0))
                .stub.scheduleProbe("older-1")
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(h.getPeer(0))
                .stub.scheduleProbe("newer-1")
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(h.getPeer(0))
                .stub.scheduleProbe("other-1")
                .request()
        ).to.equal(true);

        await stub.restoreHeldScheduledTasks("older-", false).request();
        expect(
            await h
                .control(h.getPeer(0))
                .stub.scheduleProbe("older-2")
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(h.getPeer(0))
                .stub.scheduleProbe("newer-2")
                .request()
        ).to.equal(false);
        expect(
            await stub.getHeldScheduledTaskCount("newer-").request()
        ).to.equal(2);

        await stub.restoreHeldScheduledTasks("newer-", true).request();
        expect(
            await h
                .control(h.getPeer(0))
                .stub.scheduleProbe("newer-3")
                .request()
        ).to.equal(true);
    });
});
