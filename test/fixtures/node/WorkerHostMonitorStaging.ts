// @spec-test-coverage-ignore: real worker-root protocol and logger lifecycle staging
import { createScriptedSampleSource } from "../../evm/workers/watchdogContractExecutorWorkerCore";
import { ContractExecutorClientRoot } from "@/evm/contractExecutor/rpc/ContractExecutorClientRoot";
import { ContractExecutorRoot } from "@/evm/contractExecutor/rpc/ContractExecutorRoot";
import { RpcRouter } from "@/rpc/RpcRouter";
import MessagePortTransport from "@/transport/MessagePortTransport";
import { config, createConfig } from "@/utils/config";
import * as loggerFactory from "@platform/createLogger";
import { createRuntimeChannel } from "@platform/p2pRuntimeChannel";
import { expect } from "chai";

export async function assertWorkerHostMonitor(
    mode: "configured" | "disabled" | "injected"
) {
    const previousConfig = { ...config };
    const logger = loggerFactory.createLogger(
        {},
        { component: "WorkerHostMonitorTest" },
        { attachErrorListener: false }
    );
    const originalStart = logger.startPerformanceMonitoring.bind(logger);
    const originalStop = logger.stopPerformanceMonitoring.bind(logger);
    let started = 0;
    let stopped = 0;
    let sourceStopped = 0;
    logger.startPerformanceMonitoring = (options) => {
        started += 1;
        return originalStart(options);
    };
    logger.stopPerformanceMonitoring = () => {
        stopped += 1;
        return originalStop();
    };
    const source = createScriptedSampleSource();
    const originalSourceStop = source.stop;
    source.stop = () => {
        sourceStopped += 1;
        originalSourceStop();
    };

    // the real thing in one process: the worker's root on one end of a
    // channel, its owner's on the other
    const channel = createRuntimeChannel();
    const workerRouter = new RpcRouter<
        ContractExecutorRoot,
        ContractExecutorClientRoot
    >(
        (self) =>
            new ContractExecutorRoot(self, {
                logger,
                ...(mode === "injected"
                    ? {
                          monitorOptions: {
                              sampleSource: source,
                              delayErrorThresholdMs: 100
                          }
                      }
                    : {})
            }),
        undefined
    );
    new MessagePortTransport(channel.port2, workerRouter, "parent");
    const ownerRouter = new RpcRouter<
        ContractExecutorClientRoot,
        ContractExecutorRoot
    >(
        (self) =>
            new ContractExecutorClientRoot(self, undefined, {
                onDetachedError: () => undefined
            }),
        undefined
    );
    new MessagePortTransport(channel.port1, ownerRouter, "child");
    const vm = ownerRouter.remoteRpc;

    try {
        await vm.contractExecutor
            .init(
                [],
                {
                    ...previousConfig,
                    EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS:
                        mode === "configured" ? 1 : 0
                },
                {}
            )
            .request({ timeoutMs: null });
        expect(started).to.equal(mode === "disabled" ? 0 : 1);
        stopped = 0;
        await vm.contractExecutor.dispose().request({ timeoutMs: null });
        expect(stopped).to.equal(1);
        expect(sourceStopped).to.equal(mode === "injected" ? 1 : 0);
    } finally {
        logger.stopPerformanceMonitoring();
        createConfig(previousConfig);
    }
}
