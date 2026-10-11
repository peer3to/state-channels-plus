// @spec-test-coverage-ignore: real worker entry used by the Node and browser root-creation tests
import { startRootWorker } from "@/rpc/internal/createRoot";
import { LoggerProbeExecutorRoot } from "@test/fixtures/workerRoot/LoggerProbeExecutorRoot";

startRootWorker(LoggerProbeExecutorRoot);
