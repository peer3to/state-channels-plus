import {
    assertDrainingWorkerExitsWithoutWarning,
    assertDrainWarningNamesLeakedTimer,
    assertLeakedTimerWorkerExitsAfterDrainBound
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
});
