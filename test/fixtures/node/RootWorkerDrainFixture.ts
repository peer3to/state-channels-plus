// @spec-test-coverage-ignore: real root worker drain staging; executable evidence is mapped from test/rpc/RootWorkerDrain.test.ts
import { RootWorkerControl } from "./RootWorkerControl";
import { createUploaderFixture } from "../logging/LogUploader.fixture";
import { createRoot } from "@/rpc/internal/createRoot";
import {
    ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE,
    ROOT_WORKER_DRAIN_TIMEOUT_MS,
    type RootWorkerDrainDiagnostics
} from "@/rpc/internal/node/RootWorkerRuntime";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { LogEntry } from "@/utils/logging/Logger";
import contractExecutorRootUrl from "@platform/contractExecutorRootUrl";
import { expect } from "chai";
import path from "node:path";

const LEAKED_TIMER_ENTRY = path.join(__dirname, "LeakedTimerRootEntry.ts");
const DRAIN_WARNING = "Root worker did not drain its loop and exited itself";
// What the hidden parent logs for a worker failure, an unexpected exit included.
const PARENT_ERROR_LOG = "Parentless worker reported an error";

type DrainWarningMeta = {
    worker?: string;
    drainTimeoutMs: number;
    diagnostics?: RootWorkerDrainDiagnostics;
};

/**
 * Creates a parentless executor worker from `entry` with a real caller
 * logger, disposes its handle and returns the worker's exit code, the
 * disposal time, and the drain warnings and worker failures the caller's
 * store received.
 */
async function disposeExecutorWorker(entry: string) {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    try {
        let exited!: Promise<number>;
        const handle = await RootWorkerControl.run(
            "vm",
            {
                workerUrl: entry,
                onWorker: (worker) => {
                    exited = new Promise((resolve) =>
                        worker.once("exit", resolve)
                    );
                }
            },
            () =>
                createRoot(ContractExecutorRoot, {
                    mode: "worker",
                    workerUrl: contractExecutorRootUrl,
                    args: { customPrecompiles: [] },
                    logger
                })
        );
        const started = Date.now();
        await handle.dispose();
        const elapsedMs = Date.now() - started;
        expect(handle.isClosed).to.equal(true);
        const logs: LogEntry[] = logStore.getAllLogs();
        return {
            exitCode: await exited,
            elapsedMs,
            warnings: logs.filter((entry) => entry.message === DRAIN_WARNING),
            failures: logs.filter((entry) => entry.message === PARENT_ERROR_LOG)
        };
    } finally {
        logger.dispose();
    }
}

/** A disposed worker that leaks a referenced timer ends itself after the bound. */
export async function assertLeakedTimerWorkerExitsAfterDrainBound(): Promise<void> {
    const disposed = await disposeExecutorWorker(LEAKED_TIMER_ENTRY);
    expect(disposed.exitCode).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
    expect(disposed.elapsedMs).to.be.at.least(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    expect(disposed.warnings).to.have.length(1);
    // The expected drain-timeout exit is not a worker failure.
    expect(disposed.failures).to.deep.equal([]);
}

/** The parent's warning carries the worker's report naming the leaked timer. */
export async function assertDrainWarningNamesLeakedTimer(): Promise<void> {
    const disposed = await disposeExecutorWorker(LEAKED_TIMER_ENTRY);
    expect(disposed.warnings).to.have.length(1);
    const [warning] = disposed.warnings;
    expect(warning.level).to.equal("warn");
    const meta = warning.meta[0] as DrainWarningMeta;
    expect(meta.worker).to.equal(ContractExecutorRoot.name);
    expect(meta.drainTimeoutMs).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    expect(meta.diagnostics?.handles.map((handle) => handle.type)).to.include(
        "timer"
    );
    expect(meta.diagnostics?.resources).to.include("Timeout");
}

/** A worker that leaks nothing drains before the bound, with no warning. */
export async function assertDrainingWorkerExitsWithoutWarning(): Promise<void> {
    const disposed = await disposeExecutorWorker(contractExecutorRootUrl);
    expect(disposed.exitCode).to.equal(0);
    expect(disposed.elapsedMs).to.be.below(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    expect(disposed.warnings).to.deep.equal([]);
    expect(disposed.failures).to.deep.equal([]);
}
