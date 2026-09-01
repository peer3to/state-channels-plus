import type { RuntimePort } from "@/transport/RuntimePort";

export type { WorkerCustomPrecompile } from "./rpc/contractExecutor/ContractExecutorRpcMethods";

/** a running vm worker: the port its router speaks on, and how to end it */
export type WorkerLike = {
    port: RuntimePort;
    shutdown?: () => Promise<void>;
};

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;
