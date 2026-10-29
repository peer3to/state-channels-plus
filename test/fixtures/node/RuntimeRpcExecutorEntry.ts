// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { installLoggerProbe } from "../runtimeRpc/probe/logger/LoggerProbeService";
import { installRuntimeProbe } from "../runtimeRpc/probe/runtime/RuntimeProbeService";
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";

class RuntimeRpcExecutorRoot extends ContractExecutorRoot {
    // Overrides ContractExecutorRoot.start to install probes before real initialization.
    public override async start(): Promise<void> {
        installLoggerProbe(this);
        installRuntimeProbe(this);
        await super.start();
    }
}

globalThis.threadName = "vm";
startRootWorker(RuntimeRpcExecutorRoot);
