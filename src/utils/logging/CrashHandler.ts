import { Logger } from "./types";

export interface CrashUploadConfig {
    enabled: boolean;
    uploadEndpoint: string;
    apiToken?: string;
    prefix?: string;
}

let crashUploadInProgress = false;

function generateGasSummary(logs: any[]): string {
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

function serializeLogsToNdjson(logs: unknown[]): string {
    return logs
        .map((l) =>
            JSON.stringify(l, (_key, v) =>
                typeof v === "bigint" ? v.toString() : v
            )
        )
        .join("\n");
}

async function maybeCompress(
    ndjson: string
): Promise<{ blob: Blob; contentEncoding?: "gzip" }> {
    if (typeof CompressionStream === "undefined") {
        return {
            blob: new Blob([ndjson], { type: "application/x-ndjson" })
        };
    }

    const stream = new Blob([ndjson])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));

    const blob = await new Response(stream).blob();
    return {
        blob,
        contentEncoding: "gzip"
    };
}

async function uploadLogs(
    { blob, contentEncoding }: { blob: Blob; contentEncoding?: "gzip" },
    config: CrashUploadConfig,
    logs: any[]
): Promise<void> {
    // Extract channel ID and peer address from logs
    let channelId: string | undefined;
    let peerAddress: string | undefined;

    for (let i = logs.length - 1; i >= Math.max(0, logs.length - 10); i--) {
        const log = logs[i];
        if (log.channelId) channelId = log.channelId;
        if (log.peerAddress) peerAddress = log.peerAddress;
        if (channelId && peerAddress) break;
    }

    // Generate filename with channel ID and peer address
    const extension = contentEncoding === "gzip" ? ".ndjson.gz" : ".ndjson";
    const channelSuffix = channelId ? `-ch${channelId}` : "";
    const peerSuffix = peerAddress ? `-${peerAddress.slice(0, 8)}` : "";
    const filename = `${config.prefix || "crash-"}${Date.now()}${channelSuffix}${peerSuffix}-${Math.random().toString(36).slice(2, 8)}${extension}`;

    const headers: Record<string, string> = {
        "Content-Type": "application/x-ndjson",
        "X-Filename": filename
    };

    if (config.apiToken) {
        headers["Authorization"] = `Bearer ${config.apiToken}`;
    }

    if (contentEncoding) {
        headers["Content-Encoding"] = contentEncoding;
    }

    const response = await fetch(config.uploadEndpoint, {
        method: "POST",
        headers,
        body: blob
    });

    if (!response.ok) {
        throw new Error(
            `Failed to send crash logs: ${response.status} ${response.statusText}`
        );
    }
}

async function handleCrash(
    error: Error,
    context: "exception" | "rejection" | "error-log",
    logger: Logger,
    config: CrashUploadConfig
): Promise<void> {
    if (crashUploadInProgress) {
        return;
    }
    crashUploadInProgress = true;

    try {
        const logs = logger.getAllLogs();

        // Extract context information from logs
        let channelId: string | undefined;
        let peerAddress: string | undefined;

        for (let i = logs.length - 1; i >= Math.max(0, logs.length - 10); i--) {
            const log = logs[i];
            if (log.channelId) channelId = log.channelId;
            if (log.peerAddress) peerAddress = log.peerAddress;
            if (channelId && peerAddress) break;
        }

        // Generate gas summary
        const gasSummary = generateGasSummary(logs);

        // Add crash error as final log entry
        const contextMessage =
            context === "error-log"
                ? `Error logged: ${error.message}`
                : `Uncaught ${context}: ${error.message}`;

        logs.push({
            ts: Date.now(),
            level: "error",
            message: contextMessage,
            component: "CrashHandler",
            channelId,
            peerAddress,
            gasSummary,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });

        const ndjson = serializeLogsToNdjson(logs);
        const compressed = await maybeCompress(ndjson);
        await uploadLogs(compressed, config, logs);

        logger.clearLogs();
    } catch (uploadError) {
        console.error("CrashHandler upload failed:", uploadError);
    }
}

export function setupCrashHandler(
    logger: Logger,
    config: CrashUploadConfig
): {
    handle: (
        error: Error,
        context: "exception" | "rejection" | "error-log"
    ) => Promise<void>;
} | void {
    if (!config.enabled || !config.uploadEndpoint) {
        return;
    }

    const handle = (
        error: Error,
        context: "exception" | "rejection" | "error-log"
    ) => handleCrash(error, context, logger, config);

    // Intercept logger.error
    if (typeof logger.error === "function") {
        const originalError = logger.error.bind(logger);
        logger.error = function (message: any, meta?: any, ...args: any[]) {
            const result = originalError(message, meta, ...args);

            setTimeout(() => {
                const error =
                    message instanceof Error
                        ? message
                        : new Error(
                              typeof message === "string"
                                  ? message
                                  : "Error logged"
                          );
                handle(error, "error-log");
            }, 0);

            return result;
        };
    }

    // Browser global handlers
    if (typeof window !== "undefined") {
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

    return { handle };
}
