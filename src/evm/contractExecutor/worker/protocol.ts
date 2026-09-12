import type { ContractExecutionResult } from "../AContractExecutor";
import type { SerializedError } from "@/evm/p2pRuntime/types";
import type { Config } from "@/utils/config";
import type { LogControlMessage } from "@/utils/logging/logControl";

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
          // Config the worker re-establishes so logging and timing use the same
          // thresholds as the rest of the runtime.
          config: Partial<Config>;
          // The host Clock's adjustment from wall time to estimated chain
          // time; the worker keeps the same perception as ambient block time.
          // Absent for a host without a Clock (time zero, as before).
          clockAdjustmentSeconds?: number;
      }
    | {
          type: "dispose";
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
    error: SerializedError;
};

/**
 * An error the worker caught outside any request (uncaught exception,
 * unhandled rejection, or its own event-loop watchdog). The worker keeps
 * serving; the host decides what the report means.
 */
export type WorkerDetachedErrorMessage = {
    type: "detachedError";
    error: SerializedError;
};

export type WorkerResponseMessage =
    | WorkerReadyMessage
    | WorkerSuccessResponseMessage
    | WorkerErrorResponseMessage
    | WorkerDetachedErrorMessage;

/** log-control message riding the executor port either way. no requestId, never
 *  answered by the dispatcher. */
export type WorkerLogControlMessage = {
    type: "logControl";
    message: LogControlMessage;
};

export type WorkerHostMessage = WorkerResponseMessage | WorkerLogControlMessage;

export type WorkerClientMessage =
    | WorkerRequestMessage
    | WorkerLogControlMessage;
