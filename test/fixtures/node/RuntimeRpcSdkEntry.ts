// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { installLoggerProbe } from "../runtimeRpc/probe/logger/LoggerProbeService";
import { installRuntimeProbe } from "../runtimeRpc/probe/runtime/RuntimeProbeService";
import { startRootWorker } from "@/rpc/internal/createRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { RootWorkerControl } from "@test/fixtures/node/RootWorkerControl";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import path from "node:path";

class RuntimeRpcHostRoot extends P2pRuntimeHostRoot {
    // Overrides P2pRuntimeHostRoot.start to install test controls around real startup.
    public override async start(): Promise<void> {
        RootCreationControl.track(this);
        installLoggerProbe(this);
        installRuntimeProbe(this);
        await RootCreationControl.observe(
            () =>
                RootWorkerControl.run(
                    "vm",
                    {
                        workerUrl: path.join(
                            __dirname,
                            "RuntimeRpcExecutorEntry.ts"
                        ),
                        workerData: {}
                    },
                    () => super.start()
                ),
            (root) => {
                installLoggerProbe(root);
                installRuntimeProbe(root);
            }
        );
    }
}

globalThis.threadName = "sdk";
startRootWorker(RuntimeRpcHostRoot);
