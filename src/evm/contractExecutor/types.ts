import type { ContractExecutionResult } from "./AContractExecutor";
import type { SerializableLoggerConfig } from "@/utils/logging/Logger";

export type WorkerCustomPrecompile = {
    address: string;
    module: string;
    exportName?: string;
    options?: unknown;
};

export type WorkerCallMethod = "executeCall" | "simulateCall";

export type WorkerRequestPayload =
    | {
          type: "init";
          customPrecompiles: WorkerCustomPrecompile[];
          loggerConfig?: SerializableLoggerConfig;
      }
    | {
          type: "call";
          method: "deploy";
          data: string;
      }
    | {
          type: "call";
          contractAddress: string;
          method: WorkerCallMethod;
          data: string;
      }
    | {
          type: "uploadLogs";
      };

export type WorkerRequest = {
    requestId: number;
    workerRequestPayload: WorkerRequestPayload;
};

export type WorkerResponse =
    | {
          type: "ready";
      }
    | {
          requestId: number;
          ok: true;
          result: null | ContractExecutionResult;
      }
    | {
          requestId: number;
          ok: false;
          error: {
              message: string;
              data?: string;
              name?: string;
              stack?: string;
          };
      };

export type WorkerLike = {
    postMessage(message: WorkerRequest): void;
    terminate?: () => Promise<unknown> | unknown;
};

export type ContractExecutorWorkerMessageHandler = (
    message: WorkerResponse
) => void;

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;
