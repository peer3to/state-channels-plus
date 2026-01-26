import winston from "winston";

export interface CrashUploadConfig {
    enabled: boolean;
    uploadEndpoint: string; // Server endpoint to receive crash logs
    apiToken?: string; // Optional API token for authentication
    prefix?: string; // Log file prefix (default: "crash-")
}

interface CompressionResult {
    blob: Blob;
    isCompressed: boolean;
}

/**
 * Compress logs as NDJSON (newline-delimited JSON) using browser CompressionStream
 */
async function compressLogs(logs: unknown[]): Promise<CompressionResult> {
    console.log("[CrashHandler] compressLogs: Starting compression", {
        logCount: logs.length
    });

    // Convert to NDJSON format (one JSON object per line)
    const ndjson = logs
        .map((l) =>
            JSON.stringify(l, (_key, v) =>
                typeof v === "bigint" ? v.toString() : v
            )
        )
        .join("\n");
    console.log("[CrashHandler] compressLogs: NDJSON created", {
        size: ndjson.length
    });

    // Use CompressionStream (browser API)
    if (typeof CompressionStream === "undefined") {
        console.log(
            "[CrashHandler] compressLogs: CompressionStream not available, using uncompressed"
        );
        // Fallback: return uncompressed NDJSON blob
        return {
            blob: new Blob([ndjson], { type: "application/x-ndjson" }),
            isCompressed: false
        };
    }

    // Compressed: use gzip streaming
    console.log("[CrashHandler] compressLogs: Using CompressionStream (gzip)");
    const stream = new Blob([ndjson])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));

    const blob = await new Response(stream).blob();
    console.log("[CrashHandler] compressLogs: Compression complete", {
        originalSize: ndjson.length,
        compressedSize: blob.size,
        ratio: ((blob.size / ndjson.length) * 100).toFixed(2) + "%"
    });

    return {
        blob,
        isCompressed: true
    };
}

/**
 * Send compressed logs to server endpoint
 */
async function sendLogsToServer(
    compressionResult: CompressionResult,
    config: CrashUploadConfig,
    errorInfo: {
        error: Error;
        timestamp: number;
        userAgent?: string;
        url?: string;
    },
    memoryTransport: {
        getAllLogs: () => any[];
        clearLogs: () => void;
    }
): Promise<void> {
    // Extract peer info from logs if available
    const logs = memoryTransport.getAllLogs();
    let peerId: number | undefined;
    let peerAddress: string | undefined;
    for (let i = logs.length - 1; i >= Math.max(0, logs.length - 10); i--) {
        const log = logs[i];
        if (log.peerId !== undefined) peerId = log.peerId;
        if (log.peerAddress) peerAddress = log.peerAddress;
        if (peerId !== undefined && peerAddress) break;
    }

    const extension = compressionResult.isCompressed ? ".ndjson.gz" : ".ndjson";
    // Include peer info in filename for easy identification
    const peerSuffix =
        peerId !== undefined
            ? `-peer${peerId}`
            : peerAddress
              ? `-${peerAddress.slice(0, 8)}`
              : "";
    const filename = `${config.prefix || "crash-"}${Date.now()}${peerSuffix}-${Math.random().toString(36).slice(2, 8)}${extension}`;

    const metadata = {
        timestamp: errorInfo.timestamp,
        errorName: errorInfo.error.name,
        errorMessage: errorInfo.error.message.slice(0, 200), // Truncate message
        userAgent: errorInfo.userAgent?.slice(0, 100), // Truncate UA
        url: errorInfo.url?.split("?")[0], // Remove query params
        peerId,
        peerAddress
    };

    const metadataHeader = btoa(JSON.stringify(metadata));

    // Build headers
    const headers: Record<string, string> = {
        "Content-Type": "application/x-ndjson",
        "X-Filename": filename,
        "X-Metadata": metadataHeader
    };

    // Add API token if provided
    if (config.apiToken) {
        headers["Authorization"] = `Bearer ${config.apiToken}`;
    }

    if (compressionResult.isCompressed) {
        headers["Content-Encoding"] = "gzip";
    }

    try {
        const response = await fetch(config.uploadEndpoint, {
            method: "POST",
            headers,
            body: compressionResult.blob
        });

        if (!response.ok) {
            const errorText = await response
                .text()
                .catch(() => "Unable to read response");

            throw new Error(
                `Failed to send crash logs: ${response.status} ${response.statusText}`
            );
        }

        const responseData = await response.json().catch(() => ({}));
    } catch (error) {
        console.error("[CrashHandler] sendLogsToServer: Fetch error", error);
        throw error;
    }
}

/**
 * Get memory transport from logger (works with both Winston and BrowserLogger)
 */
function getMemoryTransport(logger: any): {
    getAllLogs: () => any[];
    clearLogs: () => void;
} | null {
    // Check if logger has getAllLogs directly (BrowserLogger)
    if (logger.getAllLogs && typeof logger.getAllLogs === "function") {
        return {
            getAllLogs: logger.getAllLogs.bind(logger),
            clearLogs: logger.clearLogs?.bind(logger) || (() => {})
        };
    }

    // Check Winston transports
    if (logger.transports && Array.isArray(logger.transports)) {
        const transport = logger.transports.find(
            (t: any) => t.getAllLogs && typeof t.getAllLogs === "function"
        ) as any;

        if (transport && transport.getAllLogs) {
            return {
                getAllLogs: transport.getAllLogs.bind(transport),
                clearLogs: transport.clearLogs?.bind(transport) || (() => {})
            };
        }
    }

    return null;
}

/**
 * Generate gas usage summary from logs (optional)
 */
function generateGasSummary(logs: any[]): string {
    // Look for gas-related logs - this is optional and can be extended
    const gasLogs = logs.filter(
        (log) =>
            (log.data?.gasUsed || log.gasUsed) &&
            (log.data?.operation || log.operation)
    );

    if (gasLogs.length === 0) {
        return "No gas data collected";
    }

    const byOperation: Record<string, { count: number; total: bigint }> = {};
    let totalGas = BigInt(0);

    for (const log of gasLogs) {
        const operation = log.data?.operation || log.operation || "unknown";
        const gas = BigInt(log.data?.gasUsed || log.gasUsed || 0);

        if (!byOperation[operation]) {
            byOperation[operation] = { count: 0, total: BigInt(0) };
        }
        byOperation[operation].count++;
        byOperation[operation].total += gas;
        totalGas += gas;
    }

    let summary = `\n=== GAS USAGE SUMMARY ===\n`;
    summary += `Total transactions: ${gasLogs.length}\n`;
    summary += `Total gas used: ${totalGas.toString()}\n\n`;

    for (const [operation, stats] of Object.entries(byOperation)) {
        const avg = stats.total / BigInt(stats.count);
        summary += `${operation}:\n`;
        summary += `  Count: ${stats.count}\n`;
        summary += `  Total: ${stats.total.toString()}\n`;
        summary += `  Average: ${avg.toString()}\n`;
    }
    summary += `========================\n`;

    return summary;
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
 * Handles crash, sends logs to server, and clears memory
 */
async function handleCrashEvent(
    error: Error,
    context: "exception" | "rejection" | "error-log",
    memoryTransport: {
        getAllLogs: () => any[];
        clearLogs: () => void;
    },
    crashUploadConfig: CrashUploadConfig,
    state: CrashHandlerState
): Promise<void> {
    // Prevent concurrent uploads - one upload per page lifetime
    if (!state.tryStartUpload()) {
        return;
    }

    try {
        // Get all stored logs from memory
        const logs = memoryTransport.getAllLogs();

        // Extract peer information from logs (look for peerId/peerAddress in recent logs)
        let peerId: number | undefined;
        let peerAddress: string | undefined;
        let component: string | undefined;

        // Look through recent logs to find peer context
        for (let i = logs.length - 1; i >= Math.max(0, logs.length - 10); i--) {
            const log = logs[i];
            if (log.peerId !== undefined) peerId = log.peerId;
            if (log.peerAddress) peerAddress = log.peerAddress;
            if (log.component && !component) component = log.component;
            if (peerId !== undefined && peerAddress) break; // Found both, stop looking
        }

        // Generate gas summary (optional)
        const gasSummary = generateGasSummary(logs);

        // Add the crash error as the last log entry
        const contextMessage =
            context === "error-log"
                ? `Error logged: ${error.message}`
                : `Uncaught ${context}: ${error.message}`;

        logs.push({
            ts: Date.now(),
            level: "error",
            message: contextMessage,
            component: "CrashHandler",
            peerId,
            peerAddress,
            gasSummary,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });

        // Compress logs
        const compressionResult = await compressLogs(logs);

        // Send logs to server
        await sendLogsToServer(
            compressionResult,
            crashUploadConfig,
            {
                error,
                timestamp: Date.now(),
                userAgent:
                    typeof navigator !== "undefined"
                        ? navigator.userAgent
                        : undefined,
                url:
                    typeof window !== "undefined"
                        ? window.location.href
                        : undefined
            },
            memoryTransport
        );

        // Clear logs after successful send
        // This prevents duplicate uploads and frees memory for new logs
        memoryTransport.clearLogs();
    } catch (sendError) {
        // Log the error but don't throw - we don't want to break the app further
        console.error(
            "[CrashHandler] handleCrashEvent: Failed to send crash logs:",
            sendError
        );
        console.error("[CrashHandler] handleCrashEvent: Error details:", {
            name: sendError instanceof Error ? sendError.name : "Unknown",
            message:
                sendError instanceof Error
                    ? sendError.message
                    : String(sendError),
            stack: sendError instanceof Error ? sendError.stack : undefined
        });
    }
    // Do NOT reset flag - prevents cascading crashes from triggering multiple uploads
}

/**
 * Set up crash handler with memory transport
 * Intercepts logger.error() calls to trigger crash handler
 * Works with both Winston Logger and BrowserLogger
 * Returns handle function for testing
 */
export function setupCrashHandler(
    logger: any, // Can be winston.Logger or BrowserLogger
    config: CrashUploadConfig
): {
    handle: (
        error: Error,
        context: "exception" | "rejection" | "error-log"
    ) => Promise<void>;
} | void {
    const memory = getMemoryTransport(logger);
    const state = new CrashHandlerState();

    if (!memory || !config.enabled) {
        if (!memory) {
            console.warn(
                "[CrashHandler] Memory transport not found, crash logs won't be collected"
            );
        }
        return;
    }

    if (!config.uploadEndpoint) {
        console.warn(
            "[CrashHandler] Upload endpoint not configured, crash logs won't be sent"
        );
        return;
    }

    const handle = (
        error: Error,
        context: "exception" | "rejection" | "error-log"
    ) => handleCrashEvent(error, context, memory, config, state);

    // Intercept logger.error() calls - trigger crash handler for any error log
    // For BrowserLogger, we need to intercept at the prototype level so child loggers also get it
    const loggerConstructor = logger.constructor;
    const loggerName = loggerConstructor?.name || "";
    // Check for BrowserLogger (with or without underscore prefix, which can happen with minification)
    const isBrowserLogger =
        loggerName === "BrowserLogger" ||
        loggerName === "_BrowserLogger" ||
        loggerName.includes("BrowserLogger") ||
        (logger.getAllLogs &&
            typeof logger.getAllLogs === "function" &&
            logger.clearLogs &&
            typeof logger.clearLogs === "function");

    console.log("[CrashHandler] Determining interception strategy", {
        loggerType: loggerName,
        isBrowserLogger,
        hasErrorMethod: typeof logger.error === "function",
        hasGetAllLogs: typeof logger.getAllLogs === "function"
    });

    if (isBrowserLogger) {
        // Intercept at prototype level for BrowserLogger so all instances (including children) get it
        const BrowserLoggerPrototype = loggerConstructor.prototype;
        if (
            BrowserLoggerPrototype &&
            !(BrowserLoggerPrototype as any)._crashHandlerInstalled
        ) {
            const originalError = BrowserLoggerPrototype.error;
            (BrowserLoggerPrototype as any).error = function (
                this: any,
                message: any,
                meta?: any,
                ...args: any[]
            ) {
                console.log(
                    "[CrashHandler] logger.error intercepted (prototype)",
                    {
                        message:
                            typeof message === "string"
                                ? message
                                : "Non-string message",
                        hasMeta: !!meta,
                        loggerType: this.constructor.name,
                        hasMemoryStorage: this.enableMemoryStorage
                    }
                );

                // Call original error method first (this logs to memory transport)
                const result = originalError.call(this, message, meta, ...args);

                // Trigger crash handler asynchronously - error is already in memory logs
                // Create a generic error for the crash handler (the actual error is in the logs)
                setTimeout(() => {
                    const error =
                        message instanceof Error
                            ? message
                            : new Error(
                                  typeof message === "string"
                                      ? message
                                      : "Error logged"
                              );
                    console.log(
                        "[CrashHandler] Triggering handleCrashEvent from logger.error (prototype)"
                    );
                    handle(error, "error-log");
                }, 0);

                return result;
            };
            (BrowserLoggerPrototype as any)._crashHandlerInstalled = true;
            console.log(
                "[CrashHandler] ✅ Installed error interceptor at BrowserLogger prototype level"
            );
        } else {
            console.log(
                "[CrashHandler] Error interceptor already installed on BrowserLogger prototype"
            );
        }
    } else {
        // For Winston or other loggers, intercept on the instance
        const originalError = logger.error.bind(logger);
        logger.error = function (message: any, meta?: any, ...args: any[]) {
            console.log("[CrashHandler] logger.error intercepted (instance)", {
                message:
                    typeof message === "string"
                        ? message
                        : "Non-string message",
                hasMeta: !!meta
            });

            // Call original error method first (this logs to memory transport)
            const result = originalError(message, meta, ...args);

            // Trigger crash handler asynchronously - error is already in memory logs
            // Create a generic error for the crash handler (the actual error is in the logs)
            setTimeout(() => {
                const error =
                    message instanceof Error
                        ? message
                        : new Error(
                              typeof message === "string"
                                  ? message
                                  : "Error logged"
                          );
                console.log(
                    "[CrashHandler] Triggering handleCrashEvent from logger.error (instance)"
                );
                handle(error, "error-log");
            }, 0);

            return result;
        };
        console.log(
            "[CrashHandler] ✅ Installed error interceptor at logger instance level"
        );
    }

    // Browser event handlers
    if (typeof window !== "undefined") {
        window.addEventListener("error", (e) => {
            console.log("[CrashHandler] window.error event caught", {
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno,
                hasError: !!e.error
            });
            if (e.error) {
                handle(e.error, "exception");
            }
        });

        window.addEventListener("unhandledrejection", (e) => {
            console.log("[CrashHandler] unhandledrejection event caught", {
                reason:
                    e.reason instanceof Error
                        ? e.reason.message
                        : String(e.reason)
            });
            handle(
                e.reason instanceof Error
                    ? e.reason
                    : new Error(String(e.reason)),
                "rejection"
            );
        });
    }

    return { handle };
}
