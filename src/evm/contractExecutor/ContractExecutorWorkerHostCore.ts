import { Buffer } from "buffer";
import ContractExecutor from "./ContractExecutor";
import type { ContractExecutionResult } from "./AContractExecutor";
import { createEvm } from "../EvmFactory";
import noOpLogger from "./NoOpLogger";
import { createLogger } from "@platform/createLogger";
import type { Logger, LogLevel } from "@/utils/logging/Logger";
import { AWorkerHost } from "@/utils/worker/AWorkerHost";
import type { WorkerRequestPayload } from "./types";

const workerGlobal = globalThis as unknown as {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    window?: typeof globalThis;
};
workerGlobal.Buffer ||= Buffer;
workerGlobal.global ||= globalThis;
workerGlobal.window ||= globalThis;

export class ContractExecutorWorkerHost extends AWorkerHost<
    WorkerRequestPayload,
    ContractExecutionResult | null
> {
    private evm?: Awaited<ReturnType<typeof createEvm>>;
    private executor?: ContractExecutor;
    private workerLogger: Logger = noOpLogger;

    protected async handle(
        payload: WorkerRequestPayload
    ): Promise<ContractExecutionResult | null> {
        switch (payload.type) {
            case "init":
                return this.init(payload);
            default:
                return this.call(payload);
        }
    }

    private async init(
        request: Extract<WorkerRequestPayload, { type: "init" }>
    ): Promise<null> {
        const loggerConfig = request.loggerConfig;
        this.workerLogger = loggerConfig
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
        // Only wire gossip with a real logger; the no-op sink would swallow the ops.
        if (loggerConfig) this.attachLogger(this.workerLogger);

        this.evm = await createEvm(
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
            this.workerLogger
        );
        this.executor = new ContractExecutor(this.evm, this.workerLogger);
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
        request: Extract<WorkerRequestPayload, { type: "call" }>
    ): Promise<ContractExecutionResult | null> {
        const executor = this.getExecutor();
        return request.method === "deploy"
            ? executor.deploy(request.data)
            : request.method === "executeCall"
              ? executor.executeCall(request.data, request.contractAddress)
              : executor.simulateCall(request.data, request.contractAddress);
    }
}
