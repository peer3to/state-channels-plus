// @spec-test-coverage-ignore: real worker entry used by the Node and browser root-creation tests
import { startRootWorker } from "@/rpc/internal/createRoot";
import {
    LoggerProbeExecutorRoot,
    NAMED_WORKER_THREAD
} from "@test/fixtures/workerRoot/LoggerProbeExecutorRoot";

startRootWorker(LoggerProbeExecutorRoot, { threadName: NAMED_WORKER_THREAD });
