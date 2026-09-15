// @spec-test-coverage-ignore: real worker entry used by RootCreation tests
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";

class NamedThreadExecutor extends ContractExecutorRoot {
    // Override ContractExecutorRoot.start to check bootstrap state before initialization.
    public override async start(
        ...args: Parameters<ContractExecutorRoot["start"]>
    ) {
        if (!this.parent)
            throw new Error(
                "Common startup did not attach the executor parent"
            );
        if (globalThis.threadName !== "executor-test-thread")
            throw new Error(
                "Worker thread name was not installed before root startup"
            );
        if (!P2pRuntimeHostRoot.prototype)
            throw new Error("Expected the other root module to be imported");
        return super.start(...args);
    }
}

globalThis.threadName = "executor-test-thread";
startRootWorker(NamedThreadExecutor);
