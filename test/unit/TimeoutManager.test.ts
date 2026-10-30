import { createLogger } from "@/utils";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { expect } from "chai";
import sinon from "sinon";

const logger = createLogger({}, {}, { level: "error" });

describe("Unit: TimeoutManager", function () {
    it("dispose cancels pending timers and returns while a task still runs", async function () {
        const clock = sinon.useFakeTimers();
        try {
            const manager = new TimeoutManager(logger);
            let isRunning = false;
            let isPendingRun = false;
            // a task frozen on a cut send: it never settles
            manager.scheduleTask(
                () => {
                    isRunning = true;
                    return new Promise<void>(() => undefined);
                },
                0,
                "running task"
            );
            manager.scheduleTask(
                () => {
                    isPendingRun = true;
                },
                1_000,
                "pending task"
            );
            await clock.tickAsync(0);

            manager.dispose();
            await clock.tickAsync(1_000);

            expect(isRunning).to.equal(true);
            expect(isPendingRun).to.equal(false);
            // a pending timer would keep a worker thread alive
            expect(clock.countTimers()).to.equal(0);
        } finally {
            clock.restore();
        }
    });
});
