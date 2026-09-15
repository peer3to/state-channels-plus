// @spec-test-coverage-ignore: real SDK root-creation staging; executable evidence is mapped from test/rpc/RootCreation.test.ts
import { withRuntimeRpc } from "./RpcRouterFixture";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { config } from "@/utils/config";
import { rootWorkerUrl } from "@platform/rootWorkerRuntime";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { expect } from "chai";

export async function assertRootCreation(mode: "inline" | "worker") {
    await withRuntimeRpc(async (sdk) => {
        const parent = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!parent) throw new Error("Expected SDK host root");
        const before = parent.connections.size;
        const globalsBefore = {
            Buffer: globalThis.Buffer,
            global: globalThis.global,
            window: typeof window,
            threadName: globalThis.threadName
        };
        const failures: Error[] = [];
        let startedWithParent = false;
        const child = await RootCreationControl.observe(
            () =>
                createRoot(ContractExecutorRoot, {
                    parent,
                    mode,
                    workerUrl: rootWorkerUrl(
                        "../../../../test/fixtures/node/ThreadNameRootEntry.js"
                    ),
                    args: { config, customPrecompiles: [] }
                }),
            (root) => {
                if (!(root instanceof ContractExecutorRoot)) return;
                const start = root.start;
                root.start = async () => {
                    startedWithParent = root.parent !== null;
                    await start.call(root);
                };
            }
        );
        if (mode === "inline") expect(startedWithParent).to.equal(true);
        let ready = false;
        const waiting = child.awaitReady().then(() => {
            ready = true;
        });
        expect(parent.connections.size).to.equal(before + 1);
        await waiting;
        expect(ready).to.equal(true);
        try {
            expect(globalThis.Buffer === globalsBefore.Buffer).to.equal(true);
            expect(globalThis.global === globalsBefore.global).to.equal(true);
            expect(typeof window).to.equal(globalsBefore.window);
            expect(globalThis.threadName).to.equal(globalsBefore.threadName);
            await waiting;
            expect(failures).to.have.length(0);
            const remoteRoot = RootCreationControl.connection(parent, child)!;
            expect(remoteRoot.sameRealm).to.equal(mode === "inline");
            expect(Boolean(remoteRoot["localPeerRemoteRoot"])).to.equal(
                mode === "inline"
            );
            // An imported executor root does not start a second worker entry.
            expect(parent.connections.size).to.equal(before + 1);
            await child.dispose();
            await child.dispose();
            expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(
                5
            );
        } finally {
            await child.dispose();
        }
        expect(parent.connections.size).to.equal(before);
    });
}

export async function assertRootCreationCloneFailure(
    mode: "inline" | "worker"
) {
    await withRuntimeRpc(async (sdk) => {
        const parent = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!parent) throw new Error("Expected SDK host root");
        const before = parent.connections.size;
        let error: unknown;
        try {
            // Deliberately untyped input exercises the actual bootstrap clone boundary.
            await Reflect.apply(createRoot, undefined, [
                ContractExecutorRoot,
                {
                    parent,
                    mode,
                    workerUrl: rootWorkerUrl(
                        "../worker/ContractExecutorRootEntry.js"
                    ),
                    args: () => {}
                }
            ]);
        } catch (failure) {
            error = failure;
        }
        expect(error instanceof Error).to.equal(true);
        expect(parent.connections.size).to.equal(before);
        expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(5);
    });
}

async function assertCreatedRootTypes(
    parent: P2pRuntimeHostRoot
): Promise<void> {
    // @ts-expect-error - top-level roots cannot select worker placement without a parent connection.
    await createRoot(ContractExecutorRoot, {
        mode: "worker",
        args: { config, customPrecompiles: [] }
    });
    await createRoot(ContractExecutorRoot, {
        mode: "inline",
        args: { config, customPrecompiles: [] }
    });
    const child = await createRoot(ContractExecutorRoot, {
        parent,
        mode: "inline",
        args: { config, customPrecompiles: [] }
    });
    const disposed: Promise<void | null> = child.rpc.lifecycle
        .dispose()
        .request();
    // @ts-expect-error - executor roots do not expose SDK signer endpoints.
    child.rpc.p2pSigner;
    // @ts-expect-error - concrete executor endpoint arguments remain checked.
    child.rpc.executor.deploy(123);
    // @ts-expect-error - the remote handle keeps transport ownership private.
    child.transport;
    // @ts-expect-error - callers cannot extract its connection record.
    child.connection;
    // @ts-expect-error - cleanup is installed through the explicit setter.
    child.afterDispose = () => {};
    void disposed;
}
void assertCreatedRootTypes;

export async function assertTopLevelRoot(inline: boolean): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const root = sdk.clientRoot;
        expect(root instanceof P2pRuntimeClientRoot).to.equal(true);
        expect(
            [...root.connections.values()].some(
                (connection) => connection.remoteRelation === "parent"
            )
        ).to.equal(false);
        expect(root.connections.has(sdk.parentTransport)).to.equal(true);
        await root.lifecycle.awaitReady(sdk.parentTransport);
        const errors: Error[] = [];
        const remove = sdk.instance.onHostError((error) => errors.push(error));
        try {
            root.reportError(new Error("top-level application error"));
            expect(errors.map((error) => error.message)).to.deep.equal([
                "top-level application error"
            ]);
            expect(await sdk.remote.runtimeProbe.sum(4, 5).request()).to.equal(
                9
            );
        } finally {
            remove();
        }
    }, inline);
}

export async function assertMissingRootWorkerUrl(): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const parent = sdk.clientRoot;
        const before = parent.connections.size;
        let failure: unknown;
        try {
            await createRoot(ContractExecutorRoot, {
                parent,
                mode: "worker",
                args: { config, customPrecompiles: [] }
            });
        } catch (error) {
            failure = error;
        }
        expect((failure as Error).message).to.equal(
            "Worker roots require an explicit workerUrl"
        );
        expect(parent.connections.size).to.equal(before);
        expect(await sdk.remote.runtimeProbe.sum(3, 4).request()).to.equal(7);
    });
}

export async function assertDisposingParentRejectsChild(
    mode: "inline" | "worker"
) {
    await withRuntimeRpc(async (sdk) => {
        const parent = sdk.clientRoot;
        const disposal = sdk.instance.dispose();
        const create = () =>
            createRoot(ContractExecutorRoot, {
                parent,
                mode,
                workerUrl: rootWorkerUrl(
                    "../worker/ContractExecutorRootEntry.js"
                ),
                args: { config, customPrecompiles: [] }
            }).then(
                () => "created",
                (error: Error) => error.message
            );
        expect(await create()).to.equal(
            "Cannot create a child of a disposing root"
        );
        await disposal;
        expect(await create()).to.equal(
            "Cannot create a child of a disposing root"
        );
        expect(parent.children.size).to.equal(0);
        expect(parent.connections.size).to.equal(0);
    });
}

export async function assertParentCloseDuringRootStartup(
    duringStartup: boolean
) {
    await withRuntimeRpc(async (sdk) => {
        const parent = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!parent) throw new Error("Expected SDK host root");
        const before = parent.children.size;
        let child: ContractExecutorRoot | undefined;
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const creation = RootCreationControl.observe(
            () =>
                createRoot(ContractExecutorRoot, {
                    parent,
                    mode: "inline",
                    args: { config, customPrecompiles: [] }
                }),
            (root) => {
                if (!(root instanceof ContractExecutorRoot)) return;
                child = root;
                const start = root.start;
                root.start = async () => {
                    expect(root.parent !== null).to.equal(true);
                    entered();
                    await held;
                    await start.call(root);
                };
            }
        );
        // Observe rejection immediately while startup is deliberately held.
        const outcome = creation.then(
            (root) => ({ root, error: undefined }),
            (error: unknown) => ({ root: undefined, error })
        );
        try {
            await started;
            if (!child?.parent)
                throw new Error("Expected attached executor parent");
            const parentSide = [...parent.connections.values()].find(
                (connection) =>
                    connection["localPeerRemoteRoot"]?.["owner"] === child
            );
            if (!parentSide)
                throw new Error("Expected reciprocal child connection");
            const closed = Promise.all([
                new Promise<void>((resolve) => child!.onClosed(resolve)),
                new Promise<void>((resolve) => parentSide.onClosed(resolve))
            ]);
            if (!duringStartup) {
                release();
                await creation;
            }
            const parentConnection = RootCreationControl.connection(
                child,
                child.parent
            );
            parentConnection.closeWithReason(
                new Error("Parent closed during root test")
            );
            release();
            const result = await outcome;
            if (duringStartup) expect(result.error).to.be.instanceOf(Error);
            else expect(result.error).to.equal(undefined);
            await closed;
            expect(child.isDisposing).to.equal(true);
            expect(child.connections.size).to.equal(0);
            expect(parent.children.size).to.equal(before);
            expect(await sdk.remote.runtimeProbe.sum(2, 3).request()).to.equal(
                5
            );
        } finally {
            release();
            await outcome;
            await child?.dispose();
        }
    });
}
