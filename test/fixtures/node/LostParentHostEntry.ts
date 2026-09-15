// @spec-test-coverage-ignore: real SDK worker fault staging exercised by RuntimeLifecycle tests
import { installLoggerProbe } from "../runtimeRpc/probe/logger/LoggerProbeService";
import { installRuntimeProbe } from "../runtimeRpc/probe/runtime/RuntimeProbeService";
import { startRootWorker } from "@/rpc/internal/createRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { BroadcastChannel, workerData } from "node:worker_threads";

class LostParentHostRoot extends P2pRuntimeHostRoot {
    // Overrides P2pRuntimeHostRoot.start to hold real cleanup across parent loss.
    public override async start(): Promise<void> {
        installLoggerProbe(this);
        installRuntimeProbe(this);
        await super.start();
        const channel = new BroadcastChannel(workerData.channel);
        channel.unref();
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        channel.onmessage = (event) => {
            const { data } = event as MessageEvent;
            if (data === "release") release();
            if (data === "exit") process.exit(23);
        };
        const build = this.sdkSetup["buildRuntime"];
        Object.defineProperty(this.sdkSetup, "buildRuntime", {
            value: async (...args: Parameters<typeof build>) => {
                await build(...args);
                const manager = this.hostRpc.requireManager().stateManager;
                const stop = manager.stop.bind(manager);
                if (workerData.selfAbort) {
                    const transport = this.parent!["transport"];
                    const send = transport.send.bind(transport);
                    transport.send = (rpc, transfer) => {
                        if (
                            "service" in rpc &&
                            rpc.service === "lifecycle" &&
                            rpc.method === "disposed"
                        ) {
                            const signal = new Int32Array(
                                workerData.disposedSignal
                            );
                            Atomics.store(signal, 0, 1);
                            Atomics.notify(signal, 0);
                        }
                        send(rpc, transfer);
                    };
                    channel.onmessage = (event) => {
                        if ((event as MessageEvent).data === "abort")
                            manager.abort();
                    };
                    return;
                }
                manager.stop = async () => {
                    channel.ref();
                    channel.postMessage("cleanup-held");
                    await held;
                    await stop();
                };
                if (workerData.failSetup)
                    throw new Error("Staged SDK setup failure");
            }
        });
        const close = this.lifecycle.closeAfterDispose;
        this.lifecycle.closeAfterDispose = async () => {
            channel.postMessage("final-close");
            channel.close();
            await close?.();
        };
    }
}

globalThis.threadName = "sdk";
startRootWorker(LostParentHostRoot);
