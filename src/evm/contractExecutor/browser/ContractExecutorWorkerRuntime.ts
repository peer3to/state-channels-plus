import type {
    WorkerRequestMessage,
    WorkerResponseMessage
} from "../worker/protocol";
import type { WorkerLike } from "../types";

export type ContractExecutorWorkerMessageHandler = (
    message: WorkerResponseMessage
) => void;

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;

export function createContractExecutorWorker(
    onMessage: ContractExecutorWorkerMessageHandler,
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    return createContractExecutorWorkerFromUrl(
        new URL("./ContractExecutorWorkerEntry.js", import.meta.url),
        onMessage,
        onError
    );
}

/**
 * Spawn a contract-executor worker from an explicit module URL. Production
 * uses the platform entry above; the browser gate loads a scripted entry
 * whose selection rides in the worker `name`, which the worker reads back as
 * `self.name` (a query on the module URL is not preserved by every server).
 */
export function createContractExecutorWorkerFromUrl(
    workerUrl: URL,
    onMessage: ContractExecutorWorkerMessageHandler,
    onError: ContractExecutorWorkerErrorHandler,
    name?: string
): WorkerLike {
    const worker = new Worker(workerUrl, { type: "module", name });

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        onMessage(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
        const details = [
            event.message || "Contract executor worker failed",
            event.filename ? `file: ${event.filename}` : undefined,
            event.lineno ? `line: ${event.lineno}` : undefined,
            event.colno ? `column: ${event.colno}` : undefined
        ].filter(Boolean);
        onError(new Error(details.join(" ")));
    };
    worker.onmessageerror = () => {
        onError(
            new Error("Contract executor worker message could not be cloned")
        );
    };
    return {
        postMessage: (message) => worker.postMessage(message),
        shutdown: async () => worker.terminate()
    };
}
