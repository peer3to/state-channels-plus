import type { ContractExecutorWorkerErrorHandler, WorkerLike } from "../types";
import type { RuntimePort } from "@/transport/RuntimePort";

export function createContractExecutorWorker(
    onError: ContractExecutorWorkerErrorHandler
): WorkerLike {
    return createContractExecutorWorkerFromUrl(
        new URL("./ContractExecutorWorkerEntry.js", import.meta.url),
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
    onError: ContractExecutorWorkerErrorHandler,
    name?: string
): WorkerLike {
    const worker = new Worker(workerUrl, { type: "module", name });
    const closeHandlers: (() => void)[] = [];
    const messageHandlers: ((message: unknown) => void)[] = [];
    worker.onmessage = (event: MessageEvent) => {
        for (const handler of messageHandlers) handler(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
        const details = [
            event.message || "Contract executor worker failed",
            event.filename ? `file: ${event.filename}` : undefined,
            event.lineno ? `line: ${event.lineno}` : undefined,
            event.colno ? `column: ${event.colno}` : undefined
        ].filter(Boolean);
        onError(new Error(details.join(" ")));
        for (const handler of closeHandlers) handler();
    };
    worker.onmessageerror = () => {
        onError(
            new Error("Contract executor worker message could not be cloned")
        );
    };
    // the worker as a port. a browser worker has no exit event: an error
    // closes the line, and a clean end comes through dispose
    const port: RuntimePort = {
        post: (message) => worker.postMessage(message),
        onMessage: (handler) => {
            messageHandlers.push(handler);
        },
        start: () => {},
        onClose: (handler) => {
            closeHandlers.push(handler);
        },
        close: () => {}
    };
    return {
        port,
        shutdown: async () => worker.terminate()
    };
}
