// @spec-test-coverage-ignore: real SDK-owned worker and logger lifecycle staging
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures,
    sdkExecutorOwner
} from "./SdkExecutorFixture";
import type { MonitorProbeService } from "../runtimeRpc/probe/monitor/MonitorProbeService";
import type { RuntimeConnection } from "@/rpc/internal/AInternalRpcRoot";
import type { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { expect } from "chai";
import path from "node:path";

export async function assertWorkerHostMonitor(
    mode: "configured" | "disabled" | "injected"
) {
    try {
        const executor = await createSdkOwnedExecutor(
            { dedicatedThread: true },
            {
                workerUrl: path.join(__dirname, "WorkerHostMonitorEntry.ts"),
                workerData: mode
            }
        );
        const owner = sdkExecutorOwner(executor);
        const remote = [...owner.connections.values()].find(
            (entry) => entry.remoteRelation === "child"
        )!.rpc as RuntimeConnection<
            ContractExecutorRoot & { monitorProbe: MonitorProbeService }
        >;
        const before = await remote.monitorProbe.snapshot().request();
        expect(before.started).to.equal(mode === "disabled" ? 0 : 1);
        const after = await remote.monitorProbe.disposeAndSnapshot().request();
        expect(after.stopped - before.stopped).to.equal(1);
        expect(after.sourceStopped - before.sourceStopped).to.equal(
            mode === "injected" ? 1 : 0
        );
    } finally {
        await disposeSdkExecutorFixtures();
    }
}
