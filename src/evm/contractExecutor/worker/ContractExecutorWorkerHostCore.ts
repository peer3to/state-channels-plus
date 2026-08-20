import { Buffer } from "buffer";
import ContractExecutor from "../ContractExecutor";
import { createEvm } from "../../EvmFactory";
import { config, createConfig } from "@/utils/config";
import { createLogger } from "@platform/createLogger";
import type { Logger } from "@/utils";
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

class ContractExecutorWorkerHost {
    private executor: ContractExecutor | undefined;
    private logger: Logger | undefined;

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
        this.executor = new ContractExecutor(evm, logger);
        if (config.EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS > 0) {
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

    start(
        post: (response: WorkerHostMessage) => void,
        onMessage: (handler: (message: WorkerRequestMessage) => void) => void,
        onDisposed?: () => void
    ): void {
        onMessage((message) => {
            if (message.type !== "request") return;
            void this.handleRequest(message).then((response) => {
                post(response);
                if (message.payload.type === "dispose") onDisposed?.();
            });
        });

        post({ type: "ready" });
    }
}

export function startContractExecutorWorkerHost(
    post: (response: WorkerHostMessage) => void,
    onMessage: (handler: (message: WorkerRequestMessage) => void) => void,
    onDisposed?: () => void
): void {
    new ContractExecutorWorkerHost().start(post, onMessage, onDisposed);
}
