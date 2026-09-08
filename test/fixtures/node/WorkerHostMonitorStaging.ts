// @spec-test-coverage-ignore: real worker-host protocol and logger lifecycle staging
import { createScriptedSampleSource } from "../../evm/workers/watchdogContractExecutorWorkerCore";
import { createContractExecutorWorkerHost } from "@/evm/contractExecutor/worker/ContractExecutorWorkerHostCore";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "@/evm/contractExecutor/worker/protocol";
import { config, createConfig } from "@/utils/config";
import * as loggerFactory from "@platform/createLogger";
import { expect } from "chai";

export async function assertWorkerHostMonitor(
    mode: "configured" | "disabled" | "injected"
) {
    const previousConfig = { ...config };
    const originalCreateLogger = loggerFactory.createLogger;
    const logger = originalCreateLogger(
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
    let receive!: (message: WorkerRequestMessage) => void;
    let respond: ((message: WorkerHostMessage) => void) | undefined;
    const host = createContractExecutorWorkerHost(
        (message) => respond?.(structuredClone(message)),
        mode === "injected"
            ? {
                  logger,
                  monitorOptions: {
                      sampleSource: source,
                      delayErrorThresholdMs: 100
                  }
              }
            : { logger }
    );
    host.start((handler) => {
        receive = handler;
    });
    // the worker announces its log identity on the link as soon as init
    // attaches it, so a reply is the one carrying this request's id
    const request = (message: WorkerRequestMessage) =>
        new Promise<WorkerHostMessage>((resolve) => {
            respond = (reply) => {
                if (
                    reply.type === "response" &&
                    reply.requestId === message.requestId
                ) {
                    resolve(reply);
                }
            };
            receive(structuredClone(message));
        });
    try {
        const response = await request({
            type: "request",
            requestId: 1,
            payload: {
                type: "init",
                customPrecompiles: [],
                config: {
                    ...previousConfig,
                    EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS:
                        mode === "configured" ? 1 : 0
                }
            }
        });
        expect(response).to.have.property("ok", true);
        expect(started).to.equal(mode === "disabled" ? 0 : 1);
        stopped = 0;
        const disposal = await request({
            type: "request",
            requestId: 2,
            payload: { type: "dispose" }
        });
        expect(disposal).to.have.property("ok", true);
        expect(stopped).to.equal(1);
        expect(sourceStopped).to.equal(mode === "injected" ? 1 : 0);
    } finally {
        await request({
            type: "request",
            requestId: 3,
            payload: { type: "dispose" }
        });
        logger.stopPerformanceMonitoring();
        createConfig(previousConfig);
    }
}
