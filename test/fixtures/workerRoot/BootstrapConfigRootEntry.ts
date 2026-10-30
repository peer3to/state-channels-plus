// @spec-test-coverage-ignore: real worker entry used by the Node and browser root-creation tests
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { config } from "@/utils/config";
import { BOOTSTRAP_CONFIG_MARKER_MB } from "@test/fixtures/workerRoot/BootstrapConfigMarker";

class BootstrapConfigExecutor extends ContractExecutorRoot {
    constructor(...args: ConstructorParameters<typeof ContractExecutorRoot>) {
        // Checked before the root is built. No root installs a config itself,
        // so only the worker bootstrap can have installed the creator's value.
        if (config.CRASH_LOG_MAX_SIZE_MB !== BOOTSTRAP_CONFIG_MARKER_MB)
            throw new Error(
                `Worker config was not bootstrapped: CRASH_LOG_MAX_SIZE_MB is ${config.CRASH_LOG_MAX_SIZE_MB}`
            );
        super(...args);
    }
}

startRootWorker(BootstrapConfigExecutor);
