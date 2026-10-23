// @spec-test-coverage-ignore: real worker lifecycle fault staging exercised by RuntimeLifecycle tests
import { setupObservedP2pRuntime } from "./ObservedP2pSetup";
import { withRuntimeRpc } from "../RpcRouterFixture";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
import { prepareRuntimeSetup } from "../RuntimeTransportModesFixture";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { randomUUID } from "node:crypto";
import { BroadcastChannel } from "node:worker_threads";

export async function assertWorkerParentLoss(
    mode:
        | "dispose"
        | "setup"
        | "exit"
        | "abort"
        | "parent-dispose"
        | "closed-parent"
): Promise<void> {
    await withRuntimeRpc(async (sibling) => {
        const setup = await prepareRuntimeSetup({
            runSdkInThread: true,
            vmDedicatedThread: mode === "abort" || mode === "parent-dispose"
        });
        const disposedSignal = new SharedArrayBuffer(4);
        const channelName = randomUUID();
        const channel = new BroadcastChannel(channelName);
        let held = false;
        let closeCount = 0;
        let exited = false;
        let client!: P2pRuntimeClientRoot;
        const errors: Error[] = [];
        let releaseClientCleanup = () => {};
        let restoreClientCleanup = () => {};
        channel.onmessage = (event) => {
            const { data } = event as MessageEvent;
            if (data === "cleanup-held") held = true;
            if (data === "final-close") closeCount++;
        };
        const creating = setupObservedP2pRuntime(
            setup.scm,
            setup.deployedStateMachine,
            setup.deployStateMachine,
            {
                ...setup.setupOptions,
                // Log collection off: an abort then does not flush, so its disposal
                // does not wait for this parent while it blocks its thread.
                config: {
                    ...setup.setupOptions.config,
                    CRASH_LOG_UPLOAD_ENDPOINT: ""
                }
            },
            {
                workerUrl: require.resolve("./LostParentHostEntry"),
                workerData: {
                    channel: channelName,
                    failSetup: mode === "setup",
                    selfAbort: mode === "abort" || mode === "parent-dispose",
                    disposedSignal
                },
                onWorker(worker) {
                    worker.once("exit", () => {
                        exited = true;
                    });
                },
                onRuntimeRoot(root) {
                    if (root instanceof P2pRuntimeClientRoot) {
                        client = root;
                        client.onHostError((error) => errors.push(error));
                    }
                }
            }
        ).catch((error: Error) => error);
        try {
            if (mode === "setup") {
                await waitFor(() => held);
                client.p2pRuntimeHostRemoteRoot!.close();
                channel.postMessage("release");
                expect((await creating) instanceof Error).to.equal(true);
            } else {
                const instance = await creating;
                if (instance instanceof Error) throw instance;
                const host = client.p2pRuntimeHostRemoteRoot!;
                if (mode === "abort" || mode === "parent-dispose") {
                    // Observes the real frames, so a flush the host sent would show here.
                    const control = RuntimeRpcControl.attachTo(host);
                    const requested =
                        mode === "parent-dispose" ? host.dispose() : undefined;
                    // Let RemoteRoot post its request before this parent blocks.
                    if (requested) await Promise.resolve();
                    else channel.postMessage("abort");
                    const signal = new Int32Array(disposedSignal);
                    // Block this parent through the child's actual disposed post. Without
                    // acknowledgement Node can deliver worker exit before the queued port frame.
                    expect(Atomics.wait(signal, 0, 0, 10_000)).not.to.equal(
                        "timed-out"
                    );
                    Atomics.wait(signal, 0, 1, 30);
                    await requested;
                    await waitFor(() => exited);
                    expect(errors).to.have.length(0);
                    // With log collection off the abort asked no thread to flush. The port
                    // delivers every frame the host posted before its close.
                    await waitFor(() =>
                        control.events.some(
                            (event) => event.direction === "close"
                        )
                    );
                    expect(
                        control.events.filter(
                            (event) => event.method === "flush"
                        )
                    ).to.deep.equal([]);
                } else if (mode === "closed-parent") {
                    const failures: Error[] = [];
                    const fail = host.fail.bind(host);
                    host.fail = (error) => {
                        failures.push(error);
                        fail(error);
                    };
                    const dispose = client.dispose.bind(client);
                    const heldClientCleanup = new Promise<void>((resolve) => {
                        releaseClientCleanup = resolve;
                    });
                    client.dispose = async () => {
                        await heldClientCleanup;
                        await dispose();
                    };
                    restoreClientCleanup = () => {
                        client.dispose = dispose;
                    };
                    // Hold the real parent cleanup so its later worker.shutdown cannot
                    // classify the child's exit. Closing the port must mark it first.
                    host.close();
                    await waitFor(() => held);
                    channel.postMessage("release");
                    await waitFor(() => exited);
                    expect(
                        failures.map((error) => error.message)
                    ).to.deep.equal([]);
                    expect(errors.map((error) => error.message)).to.deep.equal([
                        "P2P runtime host closed the connection"
                    ]);
                    restoreClientCleanup();
                    releaseClientCleanup();
                } else if (mode === "exit") {
                    // Hold an actual SDK endpoint response so worker exit must reject pending work.
                    const control = RuntimeRpcControl.attachTo(host);
                    const heldResponse = control.holdNextResponse("quiesce");
                    const pending = host.rpc.lifecycle
                        .quiesce()
                        .request()
                        .catch((error: Error) => error);
                    await heldResponse;
                    channel.postMessage("exit");
                    await waitFor(() => exited);
                    expect((await pending) instanceof Error).to.equal(true);
                    await waitFor(() => errors.length > 0);
                    expect(errors.map((error) => error.message)).to.deep.equal([
                        "Root worker exited with 23"
                    ]);
                    await client.dispose();
                    expect(client.connections.size).to.equal(0);
                } else {
                    const disposing = host
                        .dispose()
                        .catch((error: Error) => error);
                    await waitFor(() => held);
                    host.close();
                    channel.postMessage("release");
                    await disposing;
                }
                await instance.dispose();
            }
            await waitFor(() => exited);
            if (mode !== "exit") expect(closeCount).to.equal(1);
            expect(
                await sibling.remote.runtimeProbe.sum(4, 5).request()
            ).to.equal(9);
        } finally {
            restoreClientCleanup();
            releaseClientCleanup();
            channel.postMessage("release");
            await creating.then((instance) =>
                instance instanceof Error ? undefined : instance.dispose()
            );
            channel.close();
        }
    });
}
