import { assertWorkerMonitorStart } from "@test/fixtures/WorkerMonitorStartFixture";

describe("Worker root event-loop monitor start", function () {
    it("starts a worker root's monitor once its start is done by default", async function () {
        await assertWorkerMonitorStart(false);
    });
    it("starts a worker root's monitor before its start with EVENT_LOOP_MONITOR_STARTUP", async function () {
        await assertWorkerMonitorStart(true);
    });
});
