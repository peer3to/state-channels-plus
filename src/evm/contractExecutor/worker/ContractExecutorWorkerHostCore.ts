import { Buffer } from "buffer";
import ContractExecutor from "../ContractExecutor";
import { createEvm } from "../../EvmFactory";
import { config, createConfig } from "@/utils/config";
import { createLogger } from "@platform/createLogger";
import type { Logger } from "@/utils";
import type { PerformanceMonitorInternalOptions } from "@/utils/logging/performanceMonitorInternal";
import { serializeError } from "@/evm/p2pRuntime/errorWire";
import type {
    ContractExecutorRequestPayload,
    WorkerHostMessage,
    WorkerRequestMessage
} from "./protocol";

const workerGlobal = globalThis as unknown as {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    window?: typeof globalThis;
};

workerGlobal.Buffer ||= Buffer;
workerGlobal.global ||= globalThis;
workerGlobal.window ||= globalThis;

/**
 * Internal construction options for the worker host. Tests inject a monitor
 * configuration (scripted sample source, low threshold); production passes
 * nothing and the monitor follows the runtime config.
 */
export type ContractExecutorWorkerHostOptions = {
    monitorOptions?: PerformanceMonitorInternalOptions;
};

/** What a worker entry needs from the host besides the port. */
export type ContractExecutorWorkerHostHandle = {
    /**
     * Report an error caught outside any request (the platform funnel's
     * uncaught exception, unhandled rejection, or the watchdog's throw). The
     * worker keeps serving; the executor decides what the report means.
     * Usable as soon as the handle exists, before request handling starts.
     */
    reportUnhandledError(error: unknown): void;
    /** Install request handling and post readiness. Call once. */
    start(
        onMessage: (handler: (message: WorkerRequestMessage) => void) => void,
        onDisposed?: () => void
    ): void;
};

class ContractExecutorWorkerHost {
    private executor: ContractExecutor | undefined;
    private logger: Logger | undefined;
    private readonly post: (response: WorkerHostMessage) => void;
    private readonly monitorOptions:
        | PerformanceMonitorInternalOptions
        | undefined;

    constructor(
        post: (response: WorkerHostMessage) => void,
        options: ContractExecutorWorkerHostOptions = {}
    ) {
        this.post = post;
        this.monitorOptions = options.monitorOptions;
    }

    private async init(
        request: Extract<ContractExecutorRequestPayload, { type: "init" }>
    ) {
        // Re-establish config in this worker and build its logger, then monitor
        // this thread with the same fatal delay threshold as every service loop.
        createConfig(request.config);
        const logger = createLogger(
            {},
            { component: "ContractExecutorWorker" },
            { attachErrorListener: false }
        );
        this.logger = logger;
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                customPrecompiles: request.customPrecompiles.map(
                    ({ address, module, exportName, options }) => ({
                        address,
                        module,
                        exportName,
                        options
                    })
                )
            },
            logger
        );
        // The same perception as the host Clock, advancing with wall time.
        const adjustment = request.clockAdjustmentSeconds;
        this.executor = new ContractExecutor(evm, logger, {
            clock:
                adjustment === undefined
                    ? undefined
                    : () => Math.floor(Date.now() / 1000) + adjustment
        });
        // An injected monitor configuration always starts the monitor: its own
        // threshold, not the runtime config, decides when it trips.
        if (this.monitorOptions) {
            logger.startPerformanceMonitoring({
                threadLabel: "vm",
                ...this.monitorOptions
            });
        } else if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0) {
            logger.startPerformanceMonitoring({ threadLabel: "vm" });
        }
        return null;
    }

    private dispose() {
        this.logger?.stopPerformanceMonitoring();
        this.logger = undefined;
        this.executor = undefined;
        return null;
    }

    private getExecutor(): ContractExecutor {
        if (!this.executor) {
            throw new Error(
                "Contract executor worker has not been initialized"
            );
        }
        return this.executor;
    }

    private async call(
        request: Extract<ContractExecutorRequestPayload, { type: "call" }>
    ) {
        const executor = this.getExecutor();
        return request.method === "deploy"
            ? await executor.deploy(request.data)
            : request.method === "executeCall"
              ? await executor.executeCall(
                    request.data,
                    request.contractAddress
                )
              : await executor.simulateCall(
                    request.data,
                    request.contractAddress
                );
    }

    private async handleRequest(
        message: WorkerRequestMessage
    ): Promise<WorkerHostMessage> {
        const { requestId, payload } = message;
        try {
            const result =
                payload.type === "init"
                    ? await this.init(payload)
                    : payload.type === "dispose"
                      ? this.dispose()
                      : await this.call(payload);

            return { type: "response", requestId, ok: true, result };
        } catch (error) {
            const err =
                error instanceof Error ? error : new Error(String(error));
            return {
                type: "response",
                requestId,
                ok: false,
                error: {
                    message: err.message,
                    data: (err as any).data,
                    name: err.name,
                    stack: err.stack
                }
            };
        }
    }

    reportUnhandledError(error: unknown): void {
        this.logger?.error("Contract executor worker caught a detached error", {
            error
        });
        this.post({ type: "detachedError", error: serializeError(error) });
    }

    start(
        onMessage: (handler: (message: WorkerRequestMessage) => void) => void,
        onDisposed?: () => void
    ): void {
        onMessage((message) => {
            if (message.type !== "request") return;
            void this.handleRequest(message).then((response) => {
                this.post(response);
                if (message.payload.type === "dispose") onDisposed?.();
            });
        });

        this.post({ type: "ready" });
    }
}

/**
 * Create the host around the reporting port. The entry registers the
 * platform error funnel on the handle first, so report-and-continue begins
 * before request handling and readiness; then it calls `start`.
 */
export function createContractExecutorWorkerHost(
    post: (response: WorkerHostMessage) => void,
    options?: ContractExecutorWorkerHostOptions
): ContractExecutorWorkerHostHandle {
    const host = new ContractExecutorWorkerHost(post, options);
    return {
        reportUnhandledError: (error) => host.reportUnhandledError(error),
        start: (onMessage, onDisposed) => host.start(onMessage, onDisposed)
    };
}
