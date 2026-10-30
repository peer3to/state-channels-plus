// @spec-test-coverage-ignore: real worker entry used by the browser startup-failure case
import { startRootWorker } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import {
    installLoggerProbe,
    type LoggerProbeRoot
} from "@test/fixtures/runtimeRpc/probe/logger/LoggerProbeService";
import { catchWasmTrap } from "@test/fixtures/WasmTestModules";
import {
    STARTUP_TRAP_THREAD,
    STARTUP_TRAP_UPLOAD_JITTER_MS
} from "@test/fixtures/workerRoot/StartupTrapRoot";

/** The real executor root, whose start fails with a real WebAssembly trap after its logger exists. */
class StartupTrapRoot extends ContractExecutorRoot {
    declare public readonly loggerProbe: LoggerProbeRoot["loggerProbe"];

    // Overrides ContractExecutorRoot.start: pins this realm's upload jitter
    // and throws a WebAssembly trap instead of loading the executor.
    public override async start(): Promise<void> {
        installLoggerProbe(this);
        this.loggerProbe.pinUploadJitter(STARTUP_TRAP_UPLOAD_JITTER_MS);
        throw await catchWasmTrap();
    }
}

startRootWorker(StartupTrapRoot, { threadName: STARTUP_TRAP_THREAD });
