import type {
    ContractExecutorWorkerErrorHandler,
    ContractExecutorWorkerMessageHandler,
    WorkerLike,
    WorkerResponse
} from "../types";

export type {
    ContractExecutorWorkerErrorHandler,
    ContractExecutorWorkerMessageHandler,
    WorkerLike
};

export function createContractExecutorWorker(
    onMessage: ContractExecutorWorkerMessageHandler,
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    const worker = new Worker(
        new URL("./ContractExecutorWorkerHost.js", import.meta.url),
        { type: "module" }
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
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
    return worker;
}
