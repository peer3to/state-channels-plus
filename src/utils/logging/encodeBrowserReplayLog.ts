export type BrowserReplayFile = {
    version: 1;
    generatedAt: string;
    logs: BrowserReplayEntry[];
};

export type BrowserReplayEntry = {
    ts: number;
    level: "error" | "warn" | "info" | "debug" | "verbose";

    // Display fields (optional)
    component?: string;
    peerAddress?: string;

    // Console payload
    args: unknown[];

    // Optional error for stack rendering
    error?: {
        message?: string;
        stack?: string;
    };

    // Preserve everything else
    meta?: Record<string, unknown>;
};

export function encodeBrowserReplayLog(logs: any[]): string {
    const replayFile: BrowserReplayFile = {
        version: 1,
        generatedAt: new Date().toISOString(),
        logs: []
    };

    // IMPORTANT: Preserve original order strictly - do NOT sort by timestamp
    // Some logs may have ts=0 or missing ts, but order matters more than timing
    for (const log of logs) {
        const entry: BrowserReplayEntry = {
            ts: typeof log.ts === "number" ? log.ts : Date.now(),
            level: normalizeLevel(log.level),
            args: extractArgs(log)
        };

        // Copy optional display fields if present
        if (log.component) {
            entry.component = log.component;
        }
        if (log.peerAddress) {
            entry.peerAddress = log.peerAddress;
        }

        // Extract error information
        const errorInfo = extractError(log);
        if (errorInfo) {
            entry.error = errorInfo;
        }

        // Preserve everything else in meta
        const meta = extractMeta(log);
        if (Object.keys(meta).length > 0) {
            entry.meta = meta;
        }

        replayFile.logs.push(entry);
    }

    return JSON.stringify(replayFile, bigintReplacer, 2);
}

function normalizeLevel(level: any): BrowserReplayEntry["level"] {
    const levelStr = String(level || "info").toLowerCase();

    switch (levelStr) {
        case "error":
            return "error";
        case "warn":
        case "warning":
            return "warn";
        case "info":
            return "info";
        case "debug":
            return "debug";
        case "verbose":
        case "trace":
            return "verbose";
        default:
            return "info";
    }
}

function extractArgs(log: any): unknown[] {
    // If original log has args, use them
    if (log.args && Array.isArray(log.args)) {
        return log.args;
    }

    // Else if message exists, push message as first arg
    if (log.message !== undefined) {
        return [log.message];
    }

    // Else empty args
    return [];
}

function extractError(
    log: any
): { message?: string; stack?: string } | undefined {
    let errorInfo: { message?: string; stack?: string } | undefined;

    // Check for stack property
    if (log.stack) {
        errorInfo = errorInfo || {};
        errorInfo.stack = String(log.stack);
    }

    // Check for Error-like objects in various places
    const errorLike = findErrorLike(log);
    if (errorLike) {
        errorInfo = errorInfo || {};
        if (errorLike.message && !errorInfo.message) {
            errorInfo.message = String(errorLike.message);
        }
        if (errorLike.stack && !errorInfo.stack) {
            errorInfo.stack = String(errorLike.stack);
        }
    }

    return errorInfo;
}

function isErrorLike(obj: any): boolean {
    return (
        obj instanceof Error ||
        (typeof obj === "object" &&
            obj !== null &&
            typeof obj.stack === "string" &&
            typeof obj.message === "string")
    );
}

function findErrorLike(obj: any): any {
    if (!obj || typeof obj !== "object") return null;

    // Check if obj itself is Error-like (only if has stack AND message, or instanceof Error)
    if (isErrorLike(obj)) {
        return obj;
    }

    // Check common error property names
    const errorProps = ["error", "err", "exception"];
    for (const prop of errorProps) {
        if (obj[prop] && typeof obj[prop] === "object") {
            const nested = findErrorLike(obj[prop]);
            if (nested) return nested;
        }
    }

    return null;
}

function extractMeta(log: any): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    // Copy all properties except the ones we've already handled
    // Include error-related keys to prevent duplication with entry.error
    const excludeKeys = new Set([
        "ts",
        "level",
        "message",
        "component",
        "peerAddress",
        "args",
        "stack",
        "error",
        "err",
        "exception"
    ]);

    for (const [key, value] of Object.entries(log)) {
        if (!excludeKeys.has(key)) {
            meta[key] = value;
        }
    }

    return meta;
}

function bigintReplacer(_key: string, value: any): any {
    return typeof value === "bigint" ? value.toString() : value;
}
