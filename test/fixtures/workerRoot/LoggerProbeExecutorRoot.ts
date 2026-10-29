// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import {
    installLoggerProbe,
    type LoggerProbeRoot
} from "@test/fixtures/runtimeRpc/probe/logger/LoggerProbeService";

/** The real executor root, which installs no config itself, with the logger probe. */
export class LoggerProbeExecutorRoot extends ContractExecutorRoot {
    declare public readonly loggerProbe: LoggerProbeRoot["loggerProbe"];

    // Overrides ContractExecutorRoot.start to install the probe before real initialization.
    public override async start(): Promise<void> {
        installLoggerProbe(this);
        await super.start();
    }
}

/** The thread name NamedLoggerProbeRootEntry starts its worker with. */
export const NAMED_WORKER_THREAD = "prover";
