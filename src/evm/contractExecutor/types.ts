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
      };
