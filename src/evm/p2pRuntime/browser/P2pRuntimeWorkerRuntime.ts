import type {
    P2pRuntimeWorker,
    RuntimePort,
    WorkerBootstrapMessage
} from "../types";
import { adaptPort } from "./P2pRuntimeChannel";

export function createP2pRuntimeWorker(): P2pRuntimeWorker {
    const worker = new Worker(
        new URL("../worker/P2pRuntimeWorkerEntry.js", import.meta.url),
        {
            type: "module"
        }
    );
    return {
        postMessage: (value, transfer) => {
            if (transfer) {
                worker.postMessage(value, transfer as Transferable[]);
                return;
            }
            worker.postMessage(value);
        },
        shutdown: async () => worker.terminate()
    };
}

/**
 * Register the worker bootstrap handler (browser Web Worker). The parent sends
 * a single {@link WorkerBootstrapMessage} carrying the serialized setup payload
 * and the transferred runtime port.
 */
export function onWorkerBootstrap(
    handler: (message: WorkerBootstrapMessage) => void
): void {
    const scope = self as unknown as {
        addEventListener: (
            type: "message",
            listener: (event: MessageEvent) => void
        ) => void;
    };
    scope.addEventListener("message", (event: MessageEvent) => {
        handler(event.data as WorkerBootstrapMessage);
    });
}

/** Close a disposed browser worker after its response has been posted. */
export function closeWorkerBootstrapPort(): void {
    self.close();
}

/** Adapt the transferred raw port to the platform-neutral surface. */
export function adaptTransferredPort(port: unknown): RuntimePort {
    return adaptPort(port as MessagePort);
}

/** Forward this worker's unhandled errors/rejections to `handler`. */
export function onUnhandledWorkerError(
    handler: (error: unknown) => void
): void {
    const scope = self as unknown as {
        addEventListener: (
            type: string,
            listener: (event: any) => void
        ) => void;
    };
    scope.addEventListener("unhandledrejection", (event) =>
        handler(event?.reason)
    );
    scope.addEventListener("error", (event) =>
        handler(event?.error ?? event?.message)
    );
}
