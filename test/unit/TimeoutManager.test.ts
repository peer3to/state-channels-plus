import { createLogger } from "@/utils";
import { Logger } from "@/utils/logging/Logger";
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

    it("a task scheduled after dispose never runs and arms no timer", async function () {
        const clock = sinon.useFakeTimers();
        try {
            const manager = new TimeoutManager(logger);
            manager.dispose();
            let hasRun = false;
            manager.scheduleTask(
                () => {
                    hasRun = true;
                },
                0,
                "late task"
            );
            expect(clock.countTimers()).to.equal(0);
            await clock.tickAsync(1_000);
            expect(hasRun).to.equal(false);
        } finally {
            clock.restore();
        }
    });

    it("logs a failing task once at error with its name and cause", async function () {
        const clock = sinon.useFakeTimers();
        const error = sinon.spy(Logger.prototype, "error");
        try {
            const manager = new TimeoutManager(logger);
            const cause = new Error("task failed");
            manager.scheduleTask(
                () => Promise.reject(cause),
                0,
                "failing task"
            );
            await clock.tickAsync(0);

            expect(error.callCount).to.equal(1);
            const [message, meta] = error.firstCall.args;
            expect(message).to.include("failing task");
            expect(meta).to.deep.equal({ error: cause });
            manager.dispose();
        } finally {
            error.restore();
            clock.restore();
        }
    });
});
