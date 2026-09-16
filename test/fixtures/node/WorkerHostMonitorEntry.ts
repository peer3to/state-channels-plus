// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { MonitorProbeService } from "../runtimeRpc/probe/monitor/MonitorProbeService";
import { rootStartContext } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { ContractExecutorInitialization } from "@/rpc/internal/services/contractExecutor/ContractExecutorService";
import { createLogger } from "@platform/createLogger";
import {
    onRootBootstrap,
    adaptTransferredPort
} from "@platform/rootWorkerRuntime";
import { createScriptedSampleSource } from "@test/evm/workers/watchdogContractExecutorWorkerCore";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("Monitor entry requires a parent port");
globalThis.threadName = "vm";
onRootBootstrap<ContractExecutorInitialization>(
    async ({ port: transferredPort, payload }) => {
        const mode = workerData as "configured" | "disabled" | "injected";
        const logger = createLogger(
            { threadName: "vm" },
            { component: "WorkerHostMonitorTest" },
            { attachErrorListener: false }
        );
        const counts = { started: 0, stopped: 0, sourceStopped: 0 };
        const start = logger.startPerformanceMonitoring.bind(logger);
        const stop = logger.stopPerformanceMonitoring.bind(logger);
        logger.startPerformanceMonitoring = (options) => {
            counts.started++;
            start(
                mode === "injected"
                    ? {
                          ...options,
                          sampleSource: source,
                          delayErrorThresholdMs: 100
                      }
                    : options
            );
        };
        logger.stopPerformanceMonitoring = () => {
            counts.stopped++;
            stop();
        };
        const source = createScriptedSampleSource();
        const sourceStop = source.stop.bind(source);
        source.stop = () => {
            counts.sourceStopped++;
            sourceStop();
        };
        const context = rootStartContext(
            adaptTransferredPort(transferredPort),
            "worker",
            { close: () => logger.dispose(), logger }
        );
        const root = new ContractExecutorRoot(
            {
                ...payload,
                config: {
                    ...payload.config,
                    EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS:
                        mode === "disabled" ? 0 : 1
                }
            },
            undefined,
            context
        );
        Object.assign(root, {
            monitorProbe: new MonitorProbeService(root, () => ({ ...counts }))
        });
        await context.initialize(root);
    }
);
