import { createLogger } from "@/utils";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { expect } from "chai";
import sinon from "sinon";

const logger = createLogger({}, {}, { level: "error" });

describe("Unit: TimeoutManager", function () {
    it("dispose waits for a running task and leaves no timer once it settles", async function () {
        const clock = sinon.useFakeTimers();
        try {
            const manager = new TimeoutManager(logger);
            let finish: () => void = () => undefined;
            let isFinished = false;
            manager.scheduleTask(
                () =>
                    new Promise<void>((resolve) => {
                        finish = () => {
                            isFinished = true;
                            resolve();
                        };
                    }),
                0,
                "running task"
            );
            await clock.tickAsync(0);

            const disposal = manager.dispose();
            finish();
            await disposal;

            expect(isFinished).to.equal(true);
            // a pending bound timer would keep a worker thread alive
            expect(clock.countTimers()).to.equal(0);
        } finally {
            clock.restore();
        }
    });
});
