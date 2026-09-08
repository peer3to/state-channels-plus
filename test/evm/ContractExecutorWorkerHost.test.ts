import { assertWorkerHostMonitor } from "@test/fixtures/node/WorkerHostMonitorStaging";

describe("ContractExecutorWorkerHost monitor", function () {
    it("starts the configured monitor without injected options and stops it on dispose", async function () {
        await assertWorkerHostMonitor("configured");
    });
    it("does not start a disabled monitor without injected options", async function () {
        await assertWorkerHostMonitor("disabled");
    });
    it("stops the injected sample source on dispose", async function () {
        await assertWorkerHostMonitor("injected");
    });
});
