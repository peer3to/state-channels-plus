import type { RuntimePort } from "@/transport/RuntimePort";

/** a running vm worker: the port its router speaks on, and how to end it */
export type WorkerLike = {
    port: RuntimePort;
    shutdown?: () => Promise<void>;
};

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;
