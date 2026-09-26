import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { describe, it } from "mocha";

describe("TimeoutManager task failure", () => {
    it("a scheduled task that throws is logged through the manager's logger and later tasks still run", async () => {
        // A real logger over its own store: what reaches the store is what the
        // log pipeline ships, and a console write never reaches it.
        const store = new LogStore(1_000_000, true);
        const logger = new NodeLogger({}, {}, "error", store, {
            attachErrorListener: false
        });
        const manager = new TimeoutManager(logger);
        let laterRan = false;
        try {
            manager.scheduleTask(
                () => {
                    throw new Error("scheduled failure");
                },
                0,
                "failing task"
            );
            await waitFor(
                () => store.getAllLogs().some((e) => e.level === "error"),
                5_000,
                10
            );
            manager.scheduleTask(
                () => {
                    laterRan = true;
                },
                0,
                "later task"
            );
            await waitFor(() => laterRan, 5_000, 10);

            const errors = store
                .getAllLogs()
                .filter((entry) => entry.level === "error")
                .map((entry) => ({
                    message: entry.message,
                    component: entry.context.component,
                    error: (entry.meta[0] as { error: Error }).error.message
                }));
            expect({ errors, laterRan }).to.deep.equal({
                errors: [
                    {
                        message:
                            "Error executing scheduled task 'failing task'",
                        component: "TimeoutManager",
                        error: "scheduled failure"
                    }
                ],
                laterRan: true
            });
        } finally {
            await manager.dispose();
            logger.dispose();
        }
    });
});
