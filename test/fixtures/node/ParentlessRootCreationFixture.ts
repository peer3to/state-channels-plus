// @spec-test-coverage-ignore: real SDK root-creation staging; executable evidence is mapped from test/rpc/RootCreation.test.ts
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
async function createParentlessWorker(): Promise<ParentlessWorker> {
    const parents: AInternalRpcRoot[] = [];
    const handle = await RootCreationControl.observe(
        () =>
            createRoot(ContractExecutorRoot, {
                mode: "worker",
                workerUrl: PROBE_EXECUTOR_ENTRY,
                args: { config, customPrecompiles: [] }
            }),
        (root) => parents.push(root)
    );
    expect(parents).to.have.length(1);
    return { handle, parent: parents[0] };
}

const CRASH_ADDRESS = "0x00000000000000000000000000000000000000ab";

/**
 * A parentless worker whose precompile ends its thread on the first call,
 * and the hidden parent it received.
 */
async function createCrashingParentlessWorker(): Promise<ParentlessWorker> {
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
                                exitCode: 31
                            }
                        }
                    ]
                }
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

/**
 * The worker thread ends unexpectedly; disposing its handle afterwards still
 * releases the hidden parent and its connection.
 */
export async function assertCrashedParentlessWorkerDisposalReleasesParent(): Promise<void> {
    const worker = await createCrashingParentlessWorker();
    const call = worker.handle.rpc.executor
        .executeCall("0x1234", CRASH_ADDRESS)
        .request()
        .then(
            () => null,
            (error: Error) => error.message
        );
    await waitFor(() => worker.handle.isClosed, 30_000);
    expect(await call).to.be.a("string");
    expect(worker.parent.isDisposing).to.equal(false);
    await worker.handle.dispose();
    expectReleased(worker);
}
