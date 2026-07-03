import type { ContractExecutionResult } from "../AContractExecutor";
import type { Config } from "@/utils/config";

export type WorkerCustomPrecompile = {
    address: string;
    module: string;
    exportName?: string;
    options?: unknown;
};

export type WorkerCallMethod = "executeCall" | "simulateCall";

export type ContractExecutorRequestPayload =
    | {
          type: "init";
          customPrecompiles: WorkerCustomPrecompile[];
          // Config the worker re-establishes so its logger event-loop monitor
          // uses the same EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS as everyone.
          config: Partial<Config>;
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
      };

export type WorkerRequestMessage = {
    type: "request";
    requestId: number;
    payload: ContractExecutorRequestPayload;
};

export type WorkerReadyMessage = {
    type: "ready";
};

export type WorkerSuccessResponseMessage = {
    type: "response";
    requestId: number;
    ok: true;
    result: null | ContractExecutionResult;
};

export type WorkerErrorResponseMessage = {
    type: "response";
    requestId: number;
    ok: false;
    error: {
        message: string;
        data?: string;
        name?: string;
        stack?: string;
    };
};

export type WorkerResponseMessage =
    | WorkerReadyMessage
    | WorkerSuccessResponseMessage
    | WorkerErrorResponseMessage;

export type WorkerHostMessage = WorkerResponseMessage;
