import { Logger } from "./types";
import { encodePlainLog } from "./logEncoder";
import { encodeBrowserReplayLog } from "./encodeBrowserReplayLog";
import { setLogObserver, StoredLog } from "./logStore";

export interface CrashUploadConfig {
    enabled: boolean;
    uploadEndpoint: string;
    apiToken?: string;
    prefix?: string;
}

const POST_ERROR_TIMEOUT_MS = 2000;

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

async function maybeCompress(
    json: string
): Promise<{ blob: Blob; contentEncoding?: "gzip" }> {
    if (typeof CompressionStream === "undefined") {
        return {
            blob: new Blob([json], { type: "application/json" })
        };
    }

    const stream = new Blob([json])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));

    const blob = await new Response(stream).blob();
    return {
        blob,
        contentEncoding: "gzip"
    };
}

function generateBaseFilename(logs: any[]): string {
    let channelId: string | undefined;
    let peerAddress: string | undefined;

    for (let i = logs.length - 1; i >= Math.max(0, logs.length - 10); i--) {
        const log = logs[i];
        if (log.channelId) channelId = log.channelId;
        if (log.peerAddress) peerAddress = log.peerAddress;
        if (channelId && peerAddress) break;
    }

    const now = new Date();
    const timestamp = now
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "-")
        .slice(0, -5);
    const channelSuffix = channelId ? `-ch_${channelId.slice(0, 8)}` : "";
    const peerSuffix = peerAddress ? `-peer_${peerAddress.slice(2, 8)}` : "";

    return `crash-${timestamp}${channelSuffix}${peerSuffix}`;
}

async function uploadFile(
    blob: Blob,
    filename: string,
    config: CrashUploadConfig,
    contentEncoding?: string
): Promise<void> {
    const headers: Record<string, string> = {
        "Content-Type":
            contentEncoding === "gzip"
                ? "application/gzip"
                : filename.endsWith(".json")
                  ? "application/json"
                  : "text/plain",
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
        const baseFilename = generateBaseFilename(logs);

        // Generate plain log and compress before upload
        const plainLog = encodePlainLog(logs);
        const { blob: plainLogBlob, contentEncoding } =
            await maybeCompress(plainLog);
        const plainLogFilename = contentEncoding
            ? `${baseFilename}.log.gz`
            : `${baseFilename}.log`;

        await uploadFile(
            plainLogBlob,
            plainLogFilename,
            config,
            contentEncoding
        );

        // Generate and upload browser replay log (for DevTools replayer)
        const browserReplayJson = encodeBrowserReplayLog(logs);
        const browserReplayBlob = new Blob([browserReplayJson], {
            type: "application/json"
        });
        await uploadFile(
            browserReplayBlob,
            `${baseFilename}.replay.json`,
            config
        );

        logger.clearLogs();
    } catch (uploadError) {
        console.error("CrashHandler upload failed:", uploadError);
    } finally {
        crashUploadInProgress = false;
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
    ) => {
        return handleCrash(error, context, logger, config);
    };

    // Register log observer to trigger crash handling on error logs
    setLogObserver((entry: StoredLog) => {
        if (entry.level !== "error") return;
        if (crashUploadInProgress) return;

        const error = new Error(entry.message);

        // Delay crash handling to capture post-error logs (stack, follow-ups)
        setTimeout(() => {
            handle(error, "error-log");
        }, POST_ERROR_TIMEOUT_MS);
    });

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
