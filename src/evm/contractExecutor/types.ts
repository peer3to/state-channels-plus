import type {
    WorkerRequestMessage,
    WorkerResponseMessage
} from "./worker/protocol";

export type {
    ContractExecutorRequestPayload,
    WorkerCallMethod,
    WorkerCustomPrecompile,
    WorkerHostMessage,
    WorkerRequestMessage,
    WorkerResponseMessage
} from "./worker/protocol";

export type WorkerLike = {
    postMessage(message: WorkerRequestMessage): void;
    shutdown?: () => Promise<void>;
};

export type ContractExecutorWorkerMessageHandler = (
    message: WorkerResponseMessage
) => void;

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;
