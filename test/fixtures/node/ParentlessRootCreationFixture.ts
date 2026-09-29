// @spec-test-coverage-ignore: real SDK root-creation staging; executable evidence is mapped from test/rpc/RootCreation.test.ts
import { createUploaderFixture } from "../logging/LogUploader.fixture";
import { withRuntimeRpc } from "../RpcRouterFixture";
import type {
    AInternalRpcRoot,
    RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import { createRoot } from "@/rpc/internal/createRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { config } from "@/utils/config";
import type { LogEntry, Logger } from "@/utils/logging/Logger";
import { ownerContextRecords } from "@test/fixtures/customRpc/OwnerContextRpcManifest";
import type { RuntimeProbeRoot } from "@test/fixtures/runtimeRpc/probe/runtime/RuntimeProbeService";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import path from "node:path";

// The executor worker entry installs the runtime probe during startup.
const PROBE_EXECUTOR_ENTRY = path.join(__dirname, "RuntimeRpcExecutorEntry.ts");
const MISSING_PRECOMPILE = {
    address: "0x00000000000000000000000000000000000000aa",
    module: path.join(__dirname, "MissingPrecompileModule.js")
};

type ParentlessWorker = {
    handle: RemoteRoot<ContractExecutorRoot>;
    parent: AInternalRpcRoot;
};

function probe(handle: RemoteRoot<ContractExecutorRoot>) {
    // The probe endpoints are installed by the worker entry, not the class.
    return (
        handle.rpc as RuntimeConnection<ContractExecutorRoot & RuntimeProbeRoot>
    ).runtimeProbe;
}

/** Creates one parentless worker and observes the hidden parent it received. */
async function createParentlessWorker(
    logger?: Logger
): Promise<ParentlessWorker> {
    const parents: AInternalRpcRoot[] = [];
    const handle = await RootCreationControl.observe(
        () =>
            createRoot(ContractExecutorRoot, {
                mode: "worker",
                workerUrl: PROBE_EXECUTOR_ENTRY,
                args: { config, customPrecompiles: [] },
                logger
            }),
        (root) => parents.push(root)
    );
    expect(parents).to.have.length(1);
    return { handle, parent: parents[0] };
}

const CRASH_ADDRESS = "0x00000000000000000000000000000000000000ab";
const CRASH_EXIT_CODE = 31;
const CRASH_CAUSE = `Root worker exited with ${CRASH_EXIT_CODE}`;
const PARENT_ERROR_LOG = "Parentless worker reported an error";

/**
 * A parentless worker whose precompile ends its thread on the first call,
 * and the hidden parent it received.
 */
async function createCrashingParentlessWorker(
    logger?: Logger
): Promise<ParentlessWorker> {
    const parents: AInternalRpcRoot[] = [];
    const handle = await RootCreationControl.observe(
        () =>
            createRoot(ContractExecutorRoot, {
                mode: "worker",
                workerUrl: PROBE_EXECUTOR_ENTRY,
                args: {
                    config,
                    customPrecompiles: [
                        {
                            address: CRASH_ADDRESS,
                            module: path.resolve(
                                __dirname,
                                "../workerAnswerPrecompile.ts"
                            ),
                            options: {
                                expectedData: "0x1234",
                                value: "0",
                                exitCode: CRASH_EXIT_CODE
                            }
                        }
                    ]
                },
                logger
            }),
        (root) => parents.push(root)
    );
    expect(parents).to.have.length(1);
    return { handle, parent: parents[0] };
}

/** Starts a worker whose startup fails and returns its hidden parent. */
async function failParentlessWorker(): Promise<AInternalRpcRoot> {
    const parents: AInternalRpcRoot[] = [];
    let failure: unknown;
    try {
        await RootCreationControl.observe(
            () =>
                createRoot(ContractExecutorRoot, {
                    mode: "worker",
                    workerUrl: PROBE_EXECUTOR_ENTRY,
                    args: { config, customPrecompiles: [MISSING_PRECOMPILE] }
                }),
            (root) => parents.push(root)
        );
    } catch (error) {
        failure = error;
    }
    expect(failure).to.be.instanceOf(Error);
    expect(parents).to.have.length(1);
    return parents[0];
}

async function expectServing(handle: RemoteRoot<ContractExecutorRoot>) {
    expect(await probe(handle).sum(2, 3).request()).to.equal(5);
    // RuntimeRpcExecutorEntry names its thread; the call ran in the worker.
    expect(await probe(handle).threadName().request()).to.equal("vm");
}

function expectReleased(worker: ParentlessWorker) {
    expect(worker.handle.isClosed).to.equal(true);
    expect(worker.parent.isDisposing).to.equal(true);
    expect(worker.parent.connections.size).to.equal(0);
}

export async function assertParentlessWorkerServes(): Promise<void> {
    const worker = await createParentlessWorker();
    try {
        expect(worker.parent.constructor.name).to.equal(
            "ParentlessWorkerParentRoot"
        );
        expect([...worker.parent.children]).to.deep.equal([worker.handle]);
        expect(worker.handle.sameRealm).to.equal(false);
        await expectServing(worker.handle);
    } finally {
        await worker.handle.dispose();
    }
}

/**
 * Releases every started worker, attempting each one even if another
 * disposal rejects, then reports the first failure.
 */
async function disposeWorkers(workers: ParentlessWorker[]): Promise<void> {
    const results = await Promise.allSettled(
        workers.map((worker) => worker.handle.dispose())
    );
    const failure = results.find(
        (result): result is PromiseRejectedResult =>
            result.status === "rejected"
    );
    if (failure) throw failure.reason;
}

export async function assertParentlessWorkersHaveDistinctParents(): Promise<void> {
    const started: ParentlessWorker[] = [];
    try {
        const first = await createParentlessWorker();
        started.push(first);
        const second = await createParentlessWorker();
        started.push(second);
        expect(first.parent === second.parent).to.equal(false);
        await expectServing(first.handle);
        await expectServing(second.handle);
    } finally {
        await disposeWorkers(started);
    }
}

export async function assertParentlessWorkerDisposalReleasesParent(): Promise<void> {
    const worker = await createParentlessWorker();
    await worker.handle.dispose();
    expectReleased(worker);
    // Repeated disposal shares the settled cleanup.
    await worker.handle.dispose();
    expectReleased(worker);
}

export async function assertParentlessWorkerStartupFailureReleasesParent(): Promise<void> {
    const parent = await failParentlessWorker();
    expect(parent.isDisposing).to.equal(true);
    expect(parent.connections.size).to.equal(0);
}

export async function assertDisposingOneParentlessWorkerKeepsOther(): Promise<void> {
    const started: ParentlessWorker[] = [];
    try {
        const first = await createParentlessWorker();
        started.push(first);
        const second = await createParentlessWorker();
        started.push(second);
        await first.handle.dispose();
        expectReleased(first);
        expect(second.parent.isDisposing).to.equal(false);
        await expectServing(second.handle);
    } finally {
        // Repeated disposal of the first shares its settled cleanup.
        await disposeWorkers(started);
    }
}

export async function assertFailedParentlessWorkerKeepsLiveOne(): Promise<void> {
    const live = await createParentlessWorker();
    try {
        const failedParent = await failParentlessWorker();
        expect(failedParent === live.parent).to.equal(false);
        expect(failedParent.isDisposing).to.equal(true);
        expect(live.parent.isDisposing).to.equal(false);
        await expectServing(live.handle);
    } finally {
        await live.handle.dispose();
    }
}

function hostOf(roots: Set<AInternalRpcRoot>): P2pRuntimeHostRoot {
    const host = [...roots].find(
        (root): root is P2pRuntimeHostRoot => root instanceof P2pRuntimeHostRoot
    );
    if (!host) throw new Error("Expected actual inline SDK host");
    return host;
}

/**
 * Two inline peers share this realm: each consumer RPC receives its own
 * host instance before that host is ready, parents its child there, and
 * disposing one peer leaves the other peer's child running.
 */
export async function assertInlineOwnersAreDistinct(): Promise<void> {
    const manifest = {
        module: path.join(__dirname, "../customRpc/OwnerContextRpcManifest.ts"),
        exportName: "OwnerContextRpc"
    };
    ownerContextRecords.length = 0;
    await withRuntimeRpc(
        async (first) => {
            const firstHost = hostOf(first.roots);
            let secondHost!: P2pRuntimeHostRoot;
            let secondChild!: RemoteRoot<ContractExecutorRoot>;
            await withRuntimeRpc(
                async (second) => {
                    secondHost = hostOf(second.roots);
                    expect(firstHost === secondHost).to.equal(false);
                    const records = [...ownerContextRecords];
                    expect(
                        records.map((record) => record.owner)
                    ).to.have.members([firstHost, secondHost]);
                    for (const record of records) {
                        expect(record.ownerRuntimeBuiltAtConstruction).to.equal(
                            false
                        );
                        const child = await record.child;
                        expect(record.owner.children.has(child)).to.equal(true);
                    }
                    secondChild = await records.find(
                        (record) => record.owner === secondHost
                    )!.child;
                },
                true,
                manifest
            );
            // The second peer is disposed; its child went with it.
            expect(secondChild.isClosed).to.equal(true);
            const firstChild = await ownerContextRecords.find(
                (record) => record.owner === firstHost
            )!.child;
            expect(firstChild.isClosed).to.equal(false);
            expect(firstHost.children.has(firstChild)).to.equal(true);
            expect(
                await first.remote.runtimeProbe.sum(2, 3).request()
            ).to.equal(5);
        },
        true,
        manifest
    );
}

/** Calls the crashing precompile and returns the call's rejection message. */
function crashWorker(worker: ParentlessWorker): Promise<string | null> {
    return worker.handle.rpc.executor
        .executeCall("0x1234", CRASH_ADDRESS)
        .request()
        .then(
            () => null,
            (error: Error) => error.message
        );
}

type CallerLogStore = { getAllLogs(): LogEntry[] };

function logsOf(logStore: CallerLogStore): string {
    return JSON.stringify(logStore.getAllLogs());
}

/** The messages of the errors the hidden parent logged into the caller's store. */
function parentReportedErrors(logStore: CallerLogStore): string[] {
    return logStore
        .getAllLogs()
        .filter((entry) => entry.message === PARENT_ERROR_LOG)
        .map((entry) => (entry.meta[0] as { error: Error }).error.message);
}

/**
 * The worker thread ends unexpectedly with no error listener on its handle:
 * the call is rejected with the exit cause, the hidden parent logs that cause,
 * and disposing the handle afterwards still releases the parent.
 */
export async function assertCrashedParentlessWorkerDisposalReleasesParent(): Promise<void> {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    try {
        const worker = await createCrashingParentlessWorker(logger);
        const call = crashWorker(worker);
        await waitFor(() => worker.handle.isClosed, 30_000);
        expect(worker.handle.failure?.message).to.equal(CRASH_CAUSE);
        expect(await call).to.equal(CRASH_CAUSE);
        await waitFor(() => parentReportedErrors(logStore).length > 0);
        expect(parentReportedErrors(logStore)).to.deep.equal([CRASH_CAUSE]);
        expect(worker.parent.isDisposing).to.equal(false);
        await worker.handle.dispose();
        expectReleased(worker);
    } finally {
        logger.dispose();
    }
}

/**
 * The worker thread ends unexpectedly while its handle has an error listener:
 * the listener receives exactly the exit cause and the hidden parent does not
 * log it.
 */
export async function assertCrashedParentlessWorkerReportsToHandleListener(): Promise<void> {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    try {
        const worker = await createCrashingParentlessWorker(logger);
        const received: Error[] = [];
        worker.handle.onError((error) => received.push(error));
        const call = crashWorker(worker);
        await waitFor(() => worker.handle.isClosed, 30_000);
        expect(await call).to.equal(CRASH_CAUSE);
        expect(received.map((error) => error.message)).to.deep.equal([
            CRASH_CAUSE
        ]);
        expect(received[0]).to.equal(worker.handle.failure);
        expect(parentReportedErrors(logStore)).to.deep.equal([]);
        await worker.handle.dispose();
        expectReleased(worker);
    } finally {
        logger.dispose();
    }
}

/**
 * A caller-supplied logger is only borrowed: the worker's reports reach the
 * caller's store, and disposing the handle leaves that logger usable.
 */
export async function assertParentlessWorkerBorrowsCallerLogger(): Promise<void> {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    try {
        const worker = await createParentlessWorker(logger);
        try {
            await probe(worker.handle)
                .reportError("reported from the parentless worker")
                .request();
            await waitFor(() => parentReportedErrors(logStore).length > 0);
            expect(parentReportedErrors(logStore)).to.deep.equal([
                "reported from the parentless worker"
            ]);
        } finally {
            await worker.handle.dispose();
        }
        expectReleased(worker);
        expect(logger.isDisposed).to.equal(false);
        logger.info(
            "caller logger remains usable after the handle is disposed"
        );
        expect(logsOf(logStore)).to.include(
            "caller logger remains usable after the handle is disposed"
        );
    } finally {
        logger.dispose();
    }
}
