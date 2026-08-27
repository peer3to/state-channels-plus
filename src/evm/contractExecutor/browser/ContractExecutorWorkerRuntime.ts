import type { WorkerHostMessage } from "../worker/protocol";
import type { WorkerLike } from "../types";

export type ContractExecutorWorkerMessageHandler = (
    message: WorkerHostMessage
) => void;

export type ContractExecutorWorkerErrorHandler = (error: Error) => void;

export function createContractExecutorWorker(
    onMessage: ContractExecutorWorkerMessageHandler,
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    const worker = new Worker(
        new URL("./ContractExecutorWorkerEntry.js", import.meta.url),
        { type: "module" }
    );

    worker.onmessage = (event: MessageEvent<WorkerHostMessage>) => {
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
