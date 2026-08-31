import type { WorkerClientMessage, WorkerHostMessage } from "./worker/protocol";

export type {
    ContractExecutorRequestPayload,
    WorkerCallMethod,
    WorkerClientMessage,
    WorkerCustomPrecompile,
    WorkerHostMessage,
    WorkerLogControlMessage,
    WorkerRequestMessage,
    WorkerResponseMessage
} from "./worker/protocol";

export type WorkerLike = {
    postMessage(message: WorkerClientMessage): void;
    shutdown?: () => Promise<void>;
};

export type ContractExecutorWorkerMessageHandler = (
    message: WorkerHostMessage
) => void;

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;
