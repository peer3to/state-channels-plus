import "../threadName";
import type { RootWorker, UncaughtFailureKind } from "../createRoot";
import type { WorkerBootstrapMessage } from "@/evm/p2pRuntime/types";
import { config, createConfig } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import type { Logger } from "@/utils/logging/Logger";
import { adaptPort } from "@platform/p2pRuntimeChannel";

/** Worker-global message the child posts just before it closes itself. */
const ROOT_WORKER_CLOSING_MESSAGE = "rootWorkerClosing";

/** Bound on the one diagnostic fetch of a worker script that failed. */
const WORKER_FAILURE_FETCH_TIMEOUT_MS = 2_000;

/**
 * Added to the flush bound for the parent's drain wait: the child settles its
 * uploads for the flush bound itself, then posts its closing message.
 */
const ROOT_WORKER_CLOSE_MARGIN_MS = 1_000;

/** What the server answers to one fetch of the script now, read in full. */
type FetchedWorkerScript =
    | {
          status: number;
          contentType: string | null;
          bytes: number;
      }
    | { error: string };

/** The browser's recorded load of the script; undefined when it recorded none. `status` is absent when the browser does not report it. */
type ReceivedWorkerScript = {
    status?: number;
    bytes: number;
};

export function createRootWorker(
    url: string | URL,
    onError: (error: Error) => void,
    logger: Logger,
    name?: string
): RootWorker & { shutdown(): Promise<void> } {
    const workerUrl = new URL(url, globalThis.location?.href).href;
    const spawnedAt = Date.now();
    const scriptLoad = observeScriptLoad(workerUrl);
    const worker = new Worker(workerUrl, { type: "module", name });
    let resolveClosing: () => void = () => {};
    const closing = new Promise<void>((resolve) => {
        resolveClosing = resolve;
    });
    worker.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === ROOT_WORKER_CLOSING_MESSAGE) resolveClosing();
    });
    let isScriptFetchStarted = false;
    worker.onerror = (event: Event) => {
        // Handled here: the failure is reported with its cause, not on the console.
        event.preventDefault();
        resolveClosing();
        const isErrorEvent = event instanceof ErrorEvent;
        const details = {
            eventType: isErrorEvent ? "ErrorEvent" : "Event",
            ...(isErrorEvent && {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            }),
            workerUrl,
            workerName: name,
            msSinceSpawn: Date.now() - spawnedAt
        };
        const report = (summary: string, meta: object) => {
            try {
                logger.error("Root worker failed", meta);
            } catch (error) {
                // As thrown from the event handler: an uncaught error, not a rejection.
                reportError(error);
            } finally {
                // A failing log call must not keep the root from failing.
                onError(new Error(summary));
            }
        };
        // A runtime error names its own cause, also one at the script's top
        // level. A bare event means the script did not load, parse, or link:
        // what the browser received and what the server answers now tell which.
        if (isErrorEvent) {
            const position = `${event.filename || workerUrl}:${event.lineno}:${event.colno}`;
            report(
                event.message
                    ? `Root worker failed: ${event.message} (${position})`
                    : `Root worker failed with no error message (${position})`,
                details
            );
            return;
        }
        if (isScriptFetchStarted) return;
        isScriptFetchStarted = true;
        void fetchWorkerScript(workerUrl).then((fetched) => {
            // Read after the fetch: the browser adds its entry after the response.
            const received = scriptLoad.take();
            report(scriptFailureSummary(workerUrl, received, fetched), {
                ...details,
                received: received ?? null,
                fetched
            });
        });
    };
    worker.onmessageerror = () =>
        onError(new Error("Root worker message could not be cloned"));
    return {
        // Browser workers have no exit event to classify; termination stays in shutdown.
        expectShutdown: () => {},
        postMessage: (value, transfer) =>
            worker.postMessage(value, (transfer as Transferable[]) ?? []),
        // The child settles its log uploads before it closes itself; wait for
        // its closing message, at most the flush bound plus the close margin.
        drain: async () => {
            const drainTimeoutMs =
                config.CRASH_LOG_FLUSH_MS + ROOT_WORKER_CLOSE_MARGIN_MS;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const isClosing = await Promise.race([
                closing.then(() => true),
                new Promise<boolean>((resolve) => {
                    timer = setTimeout(() => resolve(false), drainTimeoutMs);
                })
            ]);
            clearTimeout(timer);
            if (isClosing) return;
            try {
                logger.warn(
                    "Root worker did not close within the log flush bound; terminating it",
                    { workerUrl, workerName: name, drainTimeoutMs }
                );
            } catch (error) {
                // A failing log call must not fail the disposal.
                reportError(error);
            }
        },
        shutdown: async () => {
            scriptLoad.stop();
            worker.terminate();
        }
    };
}

/** Received but failed: it did not parse or link; not received: it did not load. */
function scriptFailureSummary(
    workerUrl: string,
    received: ReceivedWorkerScript | undefined,
    fetched: FetchedWorkerScript
): string {
    const now =
        "error" in fetched
            ? `a fetch now fails: ${fetched.error}`
            : `a fetch now returns HTTP ${fetched.status}, ${fetched.bytes} bytes`;
    if (received) {
        const status =
            received.status === undefined ? "" : `HTTP ${received.status}, `;
        return `Root worker script failed to parse or link (the browser received ${status}${received.bytes} bytes; ${now}): ${workerUrl}`;
    }
    if (
        !("error" in fetched) &&
        (fetched.status < 200 || fetched.status >= 300)
    )
        return `Root worker script failed to load (HTTP ${fetched.status}): ${workerUrl}`;
    return `Root worker script failed to load (the browser's request failed; ${now}): ${workerUrl}`;
}

/** Records the browser's load of the script; an observer still sees it when the timing buffer is full. */
function observeScriptLoad(workerUrl: string): {
    take(): ReceivedWorkerScript | undefined;
    stop(): void;
} {
    let received: ReceivedWorkerScript | undefined;
    const record = (entries: PerformanceEntryList) => {
        // The diagnostic fetch of the same URL is not the worker's load.
        const entry = (
            entries as (PerformanceResourceTiming & {
                responseStatus?: number;
            })[]
        ).find(
            (timing) =>
                timing.name === workerUrl && timing.initiatorType !== "fetch"
        );
        // An error status is a script the browser did not receive.
        if (!entry || received || (entry.responseStatus ?? 0) >= 400) return;
        received = {
            status: entry.responseStatus || undefined,
            bytes: entry.decodedBodySize
        };
        observer.disconnect();
    };
    const observer = new PerformanceObserver((list) =>
        record(list.getEntries())
    );
    observer.observe({ type: "resource" });
    return {
        take: () => {
            record(observer.takeRecords());
            observer.disconnect();
            return received;
        },
        stop: () => observer.disconnect()
    };
}

/** One bounded fetch of the failed worker script: what the server answers now. */
async function fetchWorkerScript(
    workerUrl: string
): Promise<FetchedWorkerScript> {
    try {
        const signal = AbortSignal.timeout(WORKER_FAILURE_FETCH_TIMEOUT_MS);
        const response = await fetch(workerUrl, { cache: "no-store", signal });
        return {
            status: response.status,
            contentType: response.headers.get("content-type"),
            bytes: (await response.arrayBuffer()).byteLength
        };
    } catch (error) {
        return {
            error: errorMessage(error)
        };
    }
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
            // Every root in this worker logs, stores, and uploads with its
            // creator's config, also a root that never restores one itself.
            if (event.data.config) createConfig(event.data.config);
            void handler(event.data);
        },
        { once: true }
    );
}
/** Tell the parent this worker drained and closes, then close it. */
export function closeRootWorker(): void {
    self.postMessage({ type: ROOT_WORKER_CLOSING_MESSAGE });
    self.close();
}

/**
 * Forward this worker's unhandled errors/rejections to `handler`. Both events
 * are marked handled so the browser neither reports them on the console nor
 * raises the parent's `worker.onerror`, which would count the report as a
 * fatal worker failure instead of the detached report it is.
 */
export function onUnhandledWorkerError(
    handler: (failure: unknown, kind: UncaughtFailureKind) => void
): void {
    self.addEventListener(
        "unhandledrejection",
        (event: PromiseRejectionEvent) => {
            event.preventDefault();
            handler(event.reason, "unhandled rejection");
        }
    );
    self.addEventListener("error", (event: ErrorEvent) => {
        event.preventDefault();
        // The event carries the thrown value, an Error or not. When it
        // carries none, its own message and location are what is known.
        handler(
            event.error ??
                new Error(
                    `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
                ),
            "uncaught exception"
        );
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
