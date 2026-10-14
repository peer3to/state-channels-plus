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
import type { LogEntry, Logger } from "@/utils/logging/Logger";
import { resolveRuntimeModulePath } from "@/utils/moduleLoader/node/resolveRuntimeModulePath";
import contractExecutorRootUrl from "@platform/contractExecutorRootUrl";
import { expect } from "chai";
import { spawn } from "node:child_process";
import path from "node:path";

const LEAKED_TIMER_ENTRY = path.join(__dirname, "LeakedTimerRootEntry.ts");
const TEARDOWN_ENTRY = path.join(__dirname, "TeardownExecutorEntry.ts");
// The source host, or its compiled twin when the suite runs under dist/.
const NATIVE_HANDLE_HOST = resolveRuntimeModulePath(
    path.join(__dirname, "NativeHandleDrainHost.ts")
);
const DRAIN_WARNING = "Root worker did not drain its loop and exited itself";
// What the hidden parent logs for a worker failure, an unexpected exit included.
const PARENT_ERROR_LOG = "Parentless worker reported an error";

type DrainWarningMeta = {
    worker?: string;
    drainTimeoutMs: number;
    diagnostics?: RootWorkerDrainDiagnostics;
};

/** The teardown fault TeardownExecutorEntry stages, selected by the test. */
type TeardownFault = "report-fails" | "unrequested-exit" | "native-socket";

/**
 * Runs a parentless executor worker from `entry` with `fault` and a real
 * caller logger; returns its handle and its exit code.
 */
async function runExecutorWorker(
    entry: string,
    logger: Logger,
    fault?: TeardownFault
) {
    let exited!: Promise<number>;
    const handle = await RootWorkerControl.run(
        "vm",
        {
            workerUrl: entry,
            workerData: { fault },
            onWorker: (worker) => {
                exited = new Promise((resolve) => worker.once("exit", resolve));
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
    return { handle, exited };
}

/**
 * Disposes an executor worker from `entry` and returns its exit code, the
 * disposal time, and the drain warnings and worker failures the caller's
 * store received.
 */
async function disposeExecutorWorker(entry: string, fault?: TeardownFault) {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    try {
        const { handle, exited } = await runExecutorWorker(
            entry,
            logger,
            fault
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

/** A worker that cannot collect its report still exits after the bound. */
export async function assertReportFailureStillExitsAfterDrainBound(): Promise<void> {
    const disposed = await disposeExecutorWorker(
        TEARDOWN_ENTRY,
        "report-fails"
    );
    expect(disposed.exitCode).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
    expect(disposed.elapsedMs).to.be.at.least(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    expect(disposed.warnings).to.have.length(1);
    const meta = disposed.warnings[0].meta[0] as DrainWarningMeta;
    expect(meta.drainTimeoutMs).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    // The collection threw before the post: no diagnostics reached the parent.
    expect(meta.diagnostics).to.equal(undefined);
    expect(disposed.failures).to.deep.equal([]);
}

/**
 * The drain-timeout exit code the owner did not request stays a worker
 * failure: the pending call rejects with the exit, the hidden parent logs the
 * failure, and no drain warning is recorded.
 */
export async function assertUnrequestedDrainExitCodeIsFatal(): Promise<void> {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    try {
        const { handle, exited } = await runExecutorWorker(
            TEARDOWN_ENTRY,
            logger,
            "unrequested-exit"
        );
        const failure = `Root worker exited with ${ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE}`;
        await expect(
            handle.rpc.lifecycle.quiesce().request({ timeoutMs: null })
        ).to.be.rejectedWith(failure);
        expect(await exited).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
        await handle.dispose();
        const logs: LogEntry[] = logStore.getAllLogs();
        expect(
            logs
                .filter((entry) => entry.message === PARENT_ERROR_LOG)
                .map(
                    (entry) => (entry.meta[0] as { error: Error }).error.message
                )
        ).to.deep.equal([failure]);
        expect(
            logs.filter((entry) => entry.message === DRAIN_WARNING)
        ).to.deep.equal([]);
    } finally {
        logger.dispose();
    }
}

/** Marks the host's result line among the parent's other output. */
export const NATIVE_HANDLE_RESULT_PREFIX = "##NATIVE_HANDLE_DRAIN## ";

/** Runs the native-handle case in this process; the child-process host calls it. */
export async function runNativeHandleDrain() {
    const disposed = await disposeExecutorWorker(
        TEARDOWN_ENTRY,
        "native-socket"
    );
    return {
        exitCode: disposed.exitCode,
        handleTypes: disposed.warnings.map((warning) =>
            (warning.meta[0] as DrainWarningMeta).diagnostics?.handles.map(
                (handle) => handle.type
            )
        ),
        failures: disposed.failures.length
    };
}

/**
 * A native udx socket that Node cannot list keeps the disposed worker's loop
 * alive. The parent runs in a child process so that an abort of the whole
 * process shows as a signal instead of ending the test runner: the parent
 * survives, the worker exits after the drain bound, and the warning names
 * the udp handle.
 */
export async function assertNativeHandleExitsWithoutAbort(): Promise<void> {
    // Only the source host needs the TypeScript loaders.
    const execArgv = NATIVE_HANDLE_HOST.endsWith(".ts")
        ? [
              "-r",
              require.resolve("ts-node/register/transpile-only"),
              "-r",
              require.resolve("tsconfig-paths/register")
          ]
        : [];
    const child = spawn(process.execPath, [...execArgv, NATIVE_HANDLE_HOST], {
        stdio: ["ignore", "pipe", "inherit"]
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });
    const [code, signal] = await new Promise<[number | null, string | null]>(
        (resolve) =>
            child.once("exit", (exitCode, exitSignal) =>
                resolve([exitCode, exitSignal])
            )
    );
    expect(signal).to.equal(null);
    expect(code).to.equal(0);
    const line = output
        .split("\n")
        .find((entry) => entry.startsWith(NATIVE_HANDLE_RESULT_PREFIX));
    expect(line, "native handle host result").to.not.equal(undefined);
    const result = JSON.parse(
        line!.slice(NATIVE_HANDLE_RESULT_PREFIX.length)
    ) as Awaited<ReturnType<typeof runNativeHandleDrain>>;
    expect(result.exitCode).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
    expect(result.handleTypes).to.have.length(1);
    expect(result.handleTypes[0]).to.include("udp");
    expect(result.failures).to.equal(0);
}
