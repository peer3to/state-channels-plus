// @spec-test-coverage-ignore: real SDK worker teardown staging exercised by RuntimeLifecycle tests
import { setupObservedP2pRuntime } from "./ObservedP2pSetup";
import {
    applyCrashLogConfig,
    crashLogUploadOverrides
} from "../logging/crashLogConfig";
import { startLogReceiver } from "../logging/LogUploader.fixture";
import {
    prepareRuntimeSetup,
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "../RuntimeTransportModesFixture";
import {
    ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE,
    ROOT_WORKER_DRAIN_TIMEOUT_MS,
    type RootWorkerDrainDiagnostics
} from "@/rpc/internal/node/RootWorkerRuntime";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { expect } from "chai";

const DRAIN_WARNING = "Root worker did not drain its loop and exited itself";

/**
 * Sets up a worker SDK from the teardown host entry with `fault`, disposes the
 * P2pInstance and returns the disposal time, the worker's exit code, the host
 * errors and the drain warnings the client root logged.
 *
 * A logger keeps its entries only while crash-log upload is on, and the test
 * runner turns it off. A local receiver turns it on, so the client root's
 * store holds what it logged.
 */
async function disposeTeardownHost(fault: "closing-udp" | "leaked-timer") {
    await startRuntimeTransportModesFixture();
    const receiver = await startLogReceiver();
    const restoreConfig = applyCrashLogConfig(
        crashLogUploadOverrides(receiver.url)
    );
    try {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: true,
            vmDedicatedThread: false,
            crashLogUploadEndpoint: receiver.url
        });
        let client!: P2pRuntimeClientRoot;
        let exited!: Promise<number>;
        const errors: Error[] = [];
        const instance = await setupObservedP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            setup.setupOptions,
            {
                workerUrl: require.resolve("./TeardownHostEntry"),
                workerData: { fault },
                onWorker: (worker) => {
                    exited = new Promise((resolve) =>
                        worker.once("exit", resolve)
                    );
                },
                onRuntimeRoot: (root) => {
                    if (root instanceof P2pRuntimeClientRoot) {
                        client = root;
                        client.onHostError((error) => errors.push(error));
                    }
                }
            }
        );
        // The client root's own store receives the worker's warning.
        const logs = () => client.rootLogger["logStore"].getAllLogs();
        const started = Date.now();
        await instance.dispose();
        const elapsedMs = Date.now() - started;
        return {
            elapsedMs,
            exitCode: await exited,
            errors,
            warnings: logs().filter((entry) => entry.message === DRAIN_WARNING)
        };
    } finally {
        restoreConfig();
        await receiver.close();
        stopRuntimeTransportModesFixture();
    }
}

/**
 * A handle that refuses a second close (a UDP socket its owner is closing)
 * does not stop the worker from closing the others: P2pInstance disposal
 * completes, and the worker drains and exits on its own without a warning.
 */
export async function assertRefusedHandleCloseStillDrains(): Promise<void> {
    const disposed = await disposeTeardownHost("closing-udp");
    // Exit 0 without a warning: the worker drained before any bound fired.
    expect(disposed.exitCode).to.equal(0);
    expect(disposed.warnings).to.deep.equal([]);
    expect(disposed.errors.map((error) => error.message)).to.deep.equal([]);
}

/**
 * A worker SDK whose host leaks a referenced timer ends itself after the drain
 * bound: P2pInstance disposal completes no earlier than the bound, the client
 * root logs one warning naming the host worker, and no host error is raised.
 */
export async function assertWorkerSdkLeakEndsAfterDrainBound(): Promise<void> {
    const disposed = await disposeTeardownHost("leaked-timer");
    expect(disposed.exitCode).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE);
    expect(disposed.elapsedMs).to.be.at.least(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    expect(disposed.warnings).to.have.length(1);
    const meta = disposed.warnings[0].meta[0] as {
        worker?: string;
        drainTimeoutMs: number;
        diagnostics?: RootWorkerDrainDiagnostics;
    };
    expect(meta.worker).to.equal(P2pRuntimeHostRoot.name);
    expect(meta.drainTimeoutMs).to.equal(ROOT_WORKER_DRAIN_TIMEOUT_MS);
    expect(meta.diagnostics?.resources).to.include("Timeout");
    expect(disposed.errors.map((error) => error.message)).to.deep.equal([]);
}
