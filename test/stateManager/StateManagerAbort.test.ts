import {
    assertAbortClosesRuntime,
    assertAbortUploadsLogsWithinBound,
    assertDisposeAfterErrorUploadsVmLogs,
    assertVmThreadEndCancelsHeldUpload,
    assertWorkerHostAbortUploadsLogs
} from "@test/fixtures/RuntimeAbortFixture";

describe("StateManager abort", function () {
    it("disposes the inline host and executor roots on abort", async function () {
        await assertAbortClosesRuntime(false);
    });
    it("disposes the worker host and executor roots on abort", async function () {
        await assertAbortClosesRuntime(true);
    });
    it("uploads its realms' logs before disposal, waiting for them no longer than its bound", async function () {
        await assertAbortUploadsLogsWithinBound();
    });
    it("cancels a VM worker's held upload when the worker ends, so the client closes without the drain timeout", async function () {
        await assertVmThreadEndCancelsHeldUpload();
    });
    it("uploads the worker host's, main thread's and VM worker's logs before the client closes, without waiting for the bound", async function () {
        await assertWorkerHostAbortUploadsLogs();
    });
    it("sends the VM worker's upload an error started right before a dispose, before the worker ends", async function () {
        await assertDisposeAfterErrorUploadsVmLogs();
    });
});
