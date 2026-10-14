import {
    assertDrainingWorkerExitsWithoutWarning,
    assertDrainWarningNamesLeakedTimer,
    assertLeakedTimerWorkerExitsAfterDrainBound,
    assertNativeHandleExitsWithoutAbort,
    assertReportFailureStillExitsAfterDrainBound,
    assertUnrequestedDrainExitCodeIsFatal
} from "@test/fixtures/node/RootWorkerDrainFixture";

describe("RootWorkerDrain", () => {
    it("completes disposal after the drain bound when the disposed worker leaks a referenced timer", async () => {
        await assertLeakedTimerWorkerExitsAfterDrainBound();
    });
    it("warns with diagnostics naming the leaked timer when the worker exits after the drain bound", async () => {
        await assertDrainWarningNamesLeakedTimer();
    });
    it("drains a worker with no leaked handle before the bound without a warning", async () => {
        await assertDrainingWorkerExitsWithoutWarning();
    });
    it("still exits after the drain bound when the worker cannot collect its diagnostics report", async () => {
        await assertReportFailureStillExitsAfterDrainBound();
    });
    it("reports a drain-timeout exit code the owner did not request as a worker failure", async () => {
        await assertUnrequestedDrainExitCodeIsFatal();
    });
    it("exits after the drain bound without aborting the parent process when a native socket stays open", async () => {
        await assertNativeHandleExitsWithoutAbort();
    });
});
