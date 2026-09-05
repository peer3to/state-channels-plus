// @spec-test-coverage-ignore: harness helper contract test; the helper is test infrastructure with no specification or implementation IDs
import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

/** Schedule one zero-delay task host-side and report whether it ran. */
async function scheduleProbe(
    h: ReturnType<typeof TestSession.getHarness>,
    taskName: string
): Promise<boolean> {
    return h.execOnHost(
        h.getPeer(0),
        async (sm, args) => {
            let ran = false;
            sm.timeoutManager.scheduleTask(
                () => {
                    ran = true;
                },
                0,
                args.taskName
            );
            await new Promise((resolve) => setTimeout(resolve, 20));
            return ran;
        },
        { taskName }
    );
}

describe("scheduled task holds", function () {
    it("keeps the newer prefix held when the older prefix is restored first", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const stub = h.control(h.getPeer(0)).stub;
        await stub.stubHoldScheduledTasks("older-").request();
        await stub.stubHoldScheduledTasks("newer-").request();

        expect(await scheduleProbe(h, "older-1")).to.equal(false);
        expect(await scheduleProbe(h, "newer-1")).to.equal(false);
        expect(await scheduleProbe(h, "other-1")).to.equal(true);

        await stub.restoreHeldScheduledTasks("older-", false).request();
        expect(await scheduleProbe(h, "older-2")).to.equal(true);
        expect(await scheduleProbe(h, "newer-2")).to.equal(false);
        expect(
            await stub.getHeldScheduledTaskCount("newer-").request()
        ).to.equal(2);

        await stub.restoreHeldScheduledTasks("newer-", true).request();
        expect(await scheduleProbe(h, "newer-3")).to.equal(true);
    });
});
