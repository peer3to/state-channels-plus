import winston from "winston";
import { LoggingConfig, CrashUploadConfig, isBrowser } from "./LoggingConfig";

interface CompressionResult {
    blob: Blob;
    isCompressed: boolean;
}

/**
 * Compress logs as NDJSON (newline-delimited JSON)
 *
 */
async function compressLogs(logs: unknown[]): Promise<CompressionResult> {
    // Convert to NDJSON format (one JSON object per line)
    const ndjson = logs.map((l) => JSON.stringify(l)).join("\n");

    //  only compress if CompressionStream is available
    if (typeof CompressionStream === "undefined") {
        // Uncompressed: return plain NDJSON blob
        // No Content-Encoding header will be set, filename will be .ndjson
        return {
            blob: new Blob([ndjson], { type: "application/x-ndjson" }),
            isCompressed: false
        };
    }

    // Compressed: use gzip streaming
    // Content-Encoding: gzip header will be set, filename will be .ndjson.gz
    const stream = new Blob([ndjson])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));

    return {
        blob: await new Response(stream).blob(),
        isCompressed: true
    };
}

async function uploadCrashLogs(
    compressionResult: CompressionResult,
    config: CrashUploadConfig,
    errorInfo: {
        error: Error;
        timestamp: number;
        userAgent?: string;
        url?: string;
    }
): Promise<void> {
    const extension = compressionResult.isCompressed ? ".ndjson.gz" : ".ndjson";
    const filename = `${config.prefix || "crash-"}${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;

    const metadata = {
        timestamp: errorInfo.timestamp,
        errorName: errorInfo.error.name,
        errorMessage: errorInfo.error.message.slice(0, 200), // Truncate message
        userAgent: errorInfo.userAgent?.slice(0, 100), // Truncate UA
        url: errorInfo.url?.split("?")[0] // Remove query params
    };

    const metadataHeader = btoa(JSON.stringify(metadata));

    // Build headers: Content-Encoding only set if compressed
    const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/x-ndjson",
        "X-Filename": filename,
        "X-Metadata": metadataHeader
    };

    if (compressionResult.isCompressed) {
        headers["Content-Encoding"] = "gzip";
    }

    const response = await fetch(config.uploadEndpoint, {
        method: "POST",
        headers,
        body: compressionResult.blob
    });

    if (!response.ok) {
        throw new Error(
            `Failed to upload crash logs: ${response.status} ${response.statusText}`
        );
    }
}

/**
 * Get storage transport from logger
 */
function getStorageTransport(logger: winston.Logger): {
    getAllLogs: () => Promise<any[]>;
    flush: () => Promise<void>;
    clearLogs: () => Promise<void>;
} | null {
    const transport = logger.transports.find(
        (t: any) => t.getAllLogs && typeof t.getAllLogs === "function"
    ) as any;

    if (!transport || !transport.getAllLogs) {
        return null;
    }

    return {
        getAllLogs: transport.getAllLogs.bind(transport),
        flush: transport.flush?.bind(transport) || (async () => {}),
        clearLogs: transport.clearLogs?.bind(transport) || (async () => {})
    };
}

/**
 * Crash handler state - tracks upload progress to prevent cascading uploads
 */
class CrashHandlerState {
    private crashUploadInProgress = false;

    /**
     * Check if upload is in progress and mark it as started
     */
    tryStartUpload(): boolean {
        if (this.crashUploadInProgress) {
            return false;
        }
        this.crashUploadInProgress = true;
        return true;
    }
}

/**
 *  handles crash, uploads logs, and clears storage
 */
async function handleCrashEvent(
    error: Error,
    context: "exception" | "rejection",
    storageTransport: {
        getAllLogs: () => Promise<any[]>;
        flush: () => Promise<void>;
        clearLogs: () => Promise<void>;
    },
    crashUploadConfig: CrashUploadConfig,
    state: CrashHandlerState
): Promise<void> {
    // Prevent concurrent uploads - one upload per page lifetime
    if (!state.tryStartUpload()) {
        return;
    }

    try {
        // Flush any buffered logs to ensure we capture everything
        await storageTransport.flush();

        // Get all stored logs
        const logs = await storageTransport.getAllLogs();

        // Add the crash error as the last log entry
        logs.push({
            ts: Date.now(),
            level: "error",
            message: `Uncaught ${context}: ${error.message}`,
            component: "CrashHandler",
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });

        // Compress logs (or return uncompressed if CompressionStream unavailable)
        const compressionResult = await compressLogs(logs);

        // Upload crash logs with headers based on compression
        await uploadCrashLogs(compressionResult, crashUploadConfig, {
            error,
            timestamp: Date.now(),
            userAgent:
                typeof navigator !== "undefined"
                    ? navigator.userAgent
                    : undefined,
            url:
                typeof window !== "undefined" ? window.location.href : undefined
        });

        // Clear logs after successful upload
        // This prevents duplicate uploads and frees storage for new logs
        await storageTransport.clearLogs();
    } catch (uploadError) {
        // Silently fail - we don't want to break the app further
        console.error(
            "[CrashHandler] Failed to upload crash logs:",
            uploadError
        );
    }
    // Do NOT reset flag - prevents cascading crashes from triggering multiple uploads
}

/**
 * Set up crash handler with shared state
 * Returns handle function for testing
 */
export function setupCrashHandler(
    logger: winston.Logger,
    config: LoggingConfig
): {
    handle: (error: Error, context: "exception" | "rejection") => Promise<void>;
} | void {
    const storage = getStorageTransport(logger);
    const state = new CrashHandlerState();

    if (!storage || !config.crashUpload?.enabled) {
        if (!storage) {
            console.warn(
                "[CrashHandler] Browser storage transport not found, crash logs won't be uploaded"
            );
        }
        return;
    }

    const handle = (error: Error, context: "exception" | "rejection") =>
        handleCrashEvent(error, context, storage, config.crashUpload!, state);

    // Browser event handlers
    if (isBrowser()) {
        window.addEventListener("error", (e) => {
            if (e.error) {
                handle(e.error, "exception");
            }
        });

        window.addEventListener("unhandledrejection", (e) => {
            handle(
                e.reason instanceof Error
                    ? e.reason
                    : new Error(String(e.reason)),
                "rejection"
            );
        });
    }

    // Node.js event handlers
    if (typeof process !== "undefined") {
        process.on("uncaughtException", (e) => handle(e, "exception"));
        process.on("unhandledRejection", (r) =>
            handle(r instanceof Error ? r : new Error(String(r)), "rejection")
        );
    }

    return { handle };
}
