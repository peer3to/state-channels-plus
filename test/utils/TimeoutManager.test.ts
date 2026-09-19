import noOpLogger from "@/evm/contractExecutor/NoOpLogger";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { expect } from "chai";
import { describe, it } from "mocha";

// Long enough never to fire during a case: each case cancels or disposes first.
const NEVER_MS = 60_000;

describe("TimeoutManager cancel handlers", () => {
    it("runs a pending task's cancel handler when all tasks are cancelled", async () => {
        const manager = new TimeoutManager(noOpLogger);
        let cancelled = 0;
        manager.scheduleTask(
            () => undefined,
            NEVER_MS,
            "pending",
            () => {
                cancelled += 1;
            }
        );

        await manager.cancelAllTasks();

        expect(cancelled).to.equal(1);
    });

    it("runs a pending task's cancel handler on disposal", async () => {
        const manager = new TimeoutManager(noOpLogger);
        let cancelled = 0;
        manager.scheduleTask(
            () => undefined,
            NEVER_MS,
            "pending",
            () => {
                cancelled += 1;
            }
        );

        await manager.dispose();

        expect(cancelled).to.equal(1);
    });

    it("does not run the cancel handler when the owner cancels the task itself", async () => {
        const manager = new TimeoutManager(noOpLogger);
        let cancelled = 0;
        const timeout = manager.scheduleTask(
            () => undefined,
            NEVER_MS,
            "owned",
            () => {
                cancelled += 1;
            }
        );

        manager.cancelTask(timeout);
        await manager.cancelAllTasks();

        expect(cancelled).to.equal(0);
    });

    it("does not run the cancel handler of a task that already fired", async () => {
        const manager = new TimeoutManager(noOpLogger);
        let ran = 0;
        let cancelled = 0;
        manager.scheduleTask(
            () => {
                ran += 1;
            },
            0,
            "fired",
            () => {
                cancelled += 1;
            }
        );
        await new Promise((resolve) => setTimeout(resolve, 20));

        await manager.cancelAllTasks();

        expect({ ran, cancelled }).to.deep.equal({ ran: 1, cancelled: 0 });
    });

    it("keeps cancelling the rest when one cancel handler throws", async () => {
        const manager = new TimeoutManager(noOpLogger);
        let cancelled = 0;
        manager.scheduleTask(
            () => undefined,
            NEVER_MS,
            "throws",
            () => {
                throw new Error("handler failure");
            }
        );
        manager.scheduleTask(
            () => undefined,
            NEVER_MS,
            "second",
            () => {
                cancelled += 1;
            }
        );

        await manager.cancelAllTasks();

        expect(cancelled).to.equal(1);
    });
});
