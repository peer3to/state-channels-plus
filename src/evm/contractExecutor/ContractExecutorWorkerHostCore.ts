import { Buffer } from "buffer";
import ContractExecutor from "./ContractExecutor";
import type { ContractExecutionResult } from "./AContractExecutor";
import { createEvm } from "../EvmFactory";
import noOpLogger from "./NoOpLogger";
import { createLogger } from "@platform/createLogger";
import type { Logger, LogLevel } from "@/utils/logging/Logger";
import type {
    WorkerRequest,
    WorkerRequestPayload,
    WorkerResponse
} from "./types";

const workerGlobal = globalThis as unknown as {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    window?: typeof globalThis;
};

workerGlobal.Buffer ||= Buffer;
workerGlobal.global ||= globalThis;
workerGlobal.window ||= globalThis;

let evm: Awaited<ReturnType<typeof createEvm>> | undefined;
let executor: ContractExecutor | undefined;
let workerLogger: Logger = noOpLogger;

async function init(request: Extract<WorkerRequestPayload, { type: "init" }>) {
    const loggerConfig = request.loggerConfig;
    // The worker's own config singleton is DEFAULT_CONFIG (createConfig only
    // runs on the main thread), so logger config must be injected explicitly.
    workerLogger = loggerConfig
        ? createLogger(
              loggerConfig.sharedContext,
              { component: "ContractExecutorWorker" },
              {
                  logUploaderConfig: {
                      uploadEndpoint: loggerConfig.uploadEndpoint,
                      apiToken: loggerConfig.apiToken
                  },
                  level: loggerConfig.level as LogLevel | undefined,
                  skipWriting: loggerConfig.skipWriting,
                  attachErrorListener: true
              }
          )
        : noOpLogger;

    evm = await createEvm(
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
        workerLogger
    );
    executor = new ContractExecutor(evm, workerLogger);
    return null;
}

function diagnostics(
    request: Extract<WorkerRequestPayload, { type: "diagnostics" }>
): void {
    if (request.op === "updateContext") {
        workerLogger.updateSharedContext(request.context);
    } else {
        // Fire-and-forget: ack immediately, let the upload run detached.
        void workerLogger.uploadLogs(
            request.message ?? "worker report-bug flush"
        );
    }
}

function getExecutor(): ContractExecutor {
    if (!executor) {
        throw new Error("Contract executor worker has not been initialized");
    }
    return executor;
}

async function call(request: Extract<WorkerRequestPayload, { type: "call" }>) {
    const executor = getExecutor();
    const result =
        request.method === "deploy"
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

    return result;
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
    const { requestId, workerRequestPayload } = request;
    try {
        let result: null | ContractExecutionResult;
        switch (workerRequestPayload.type) {
            case "init":
                result = await init(workerRequestPayload);
                break;
            case "diagnostics":
                diagnostics(workerRequestPayload);
                result = null;
                break;
            default:
                result = await call(workerRequestPayload);
        }

        return {
            requestId,
            ok: true,
            result
        };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
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

export function startContractExecutorWorkerHost(
    post: (response: WorkerResponse) => void,
    onMessage: (handler: (message: WorkerRequest) => void) => void
): void {
    onMessage((request) => {
        void handleRequest(request).then(post);
    });

    post({ type: "ready" });
}
