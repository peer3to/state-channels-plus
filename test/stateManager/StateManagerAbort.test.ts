import {
    assertAbortCancelsTimeout,
    assertAbortClosesRuntime,
    assertAbortUploadsLogsWithinBound,
    assertClockOwnedProviderReleasedOnDispose,
    assertDisposeAfterErrorUploadsVmLogs,
    assertProviderShutdownOrder,
    assertVmThreadEndCancelsHeldUpload,
    assertWorkerClockProviderReleasedOnDispose,
    assertWorkerHostAbortUploadsGasReport,
    assertWorkerHostAbortUploadsLogs
} from "@test/fixtures/RuntimeAbortFixture";

describe("StateManager abort", function () {
    it("stops host work before provider destruction and final listener removal", async function () {
        await assertProviderShutdownOrder();
    });
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
    it("uploads the worker host's gas report its disposal logs after the abort flush started, before the client closes", async function () {
        await assertWorkerHostAbortUploadsGasReport();
    });
    it("sends the VM worker's upload an error started right before a dispose, before the worker ends", async function () {
        await assertDisposeAfterErrorUploadsVmLogs();
    });
    it("cancels session-owned timeout work", async function () {
        await assertAbortCancelsTimeout();
    });
    it("keeps a Clock-owned provider open on dispose without reconnects until the Clock replaces it", async function () {
        await assertClockOwnedProviderReleasedOnDispose();
    });
    it("keeps the provider its worker's Clock reads through open on dispose, with no listener left and no reconnects", async function () {
        await assertWorkerClockProviderReleasedOnDispose();
    });
});
