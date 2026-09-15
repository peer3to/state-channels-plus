import "../threadName";
import type { RootWorker } from "../createRoot";
import type { WorkerBootstrapMessage } from "@/evm/p2pRuntime/types";
import { adaptPort } from "@platform/p2pRuntimeChannel";

export function createRootWorker(
    workerUrl: string | URL,
    onError: (error: Error) => void,
    name?: string
): RootWorker & { shutdown(): Promise<void> } {
    return observeWorker(
        new Worker(workerUrl, { type: "module", name }),
        onError
    );
}

function observeWorker(
    worker: Worker,
    onError: (error: Error) => void
): RootWorker & { shutdown(): Promise<void> } {
    worker.onerror = (event: ErrorEvent) => {
        const details = [
            event.message || "Root worker failed",
            event.filename ? `file: ${event.filename}` : undefined,
            event.lineno ? `line: ${event.lineno}` : undefined,
            event.colno ? `column: ${event.colno}` : undefined
        ].filter(Boolean);
        onError(new Error(details.join(" ")));
    };
    worker.onmessageerror = () =>
        onError(new Error("Root worker message could not be cloned"));
    return {
        // Browser workers have no exit event to classify; termination stays in shutdown.
        expectShutdown: () => {},
        postMessage: (value, transfer) =>
            worker.postMessage(value, (transfer as Transferable[]) ?? []),
        shutdown: async () => worker.terminate()
    };
}

export function isRootWorker(): boolean {
    return typeof document === "undefined" && typeof self !== "undefined";
}

export function onRootBootstrap<T>(
    handler: (message: WorkerBootstrapMessage<T>) => void | Promise<void>
): void {
    self.addEventListener(
        "message",
        (event: MessageEvent) => {
            globalThis.threadName =
                event.data.threadName ?? globalThis.threadName;
            void handler(event.data);
        },
        { once: true }
    );
}
export function closeRootWorker(): void {
    self.close();
}

/**
 * Forward this worker's unhandled errors/rejections to `handler`. Both events
 * are marked handled so the browser neither reports them on the console nor
 * raises the parent's `worker.onerror`, which would count the report as a
 * fatal worker failure instead of the detached report it is.
 */
export function onUnhandledWorkerError(
    handler: (error: unknown) => void
): void {
    self.addEventListener(
        "unhandledrejection",
        (event: PromiseRejectionEvent) => {
            event.preventDefault();
            handler(event.reason);
        }
    );
    self.addEventListener("error", (event: ErrorEvent) => {
        event.preventDefault();
        handler(event.error ?? event.message);
    });
}

export const adaptTransferredPort = adaptPort;

export function reportRootStartupTiming(timing: {
    runtimeReadyMs: number;
    runtimeThread?: string;
}): void {
    // The browser runner observes readiness through its worker protocol.
}

/** Node-style dynamic entries are unavailable in browser builds; built-ins use bundled assets. */
export function rootWorkerUrl(_file: string): undefined {
    return undefined;
}
