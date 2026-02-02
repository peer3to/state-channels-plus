import { LogEntry, LogLevel } from "./Logger";
import { Buffer } from "buffer";
import { compressSync, decompressSync, strToU8, strFromU8 } from "fflate";

export function encodeLogs(logs: LogEntry[]): string {
    return JSON.stringify(logs.map((log) => encodeLogEntry(log)));
}

export function decodeLogs(encodedLogs: string): LogEntry[] {
    const parsed = JSON.parse(encodedLogs) as string[] | null;

    if (!parsed || !Array.isArray(parsed))
        throw new Error("Failed to deserialize log entries");

    return parsed.map((encodedLog) => decodeLogEntry(encodedLog));
}

export function encodeLogEntry(logEntry: LogEntry): string {
    return JSON.stringify(logEntry, (_key, value) => {
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (value instanceof Error) {
            return {
                message: value.message,
                stack: value.stack
            };
        }
        if (
            typeof value === "object" &&
            value &&
            (value as { message?: string; stack?: string }).message &&
            (value as { message?: string; stack?: string }).stack
        ) {
            return {
                message: (value as { message?: string }).message,
                stack: (value as { stack?: string }).stack
            };
        }
        return value;
    });
}

export function decodeLogEntry(encodedLogEntry: string): LogEntry {
    const parsed = JSON.parse(encodedLogEntry) as Partial<LogEntry> | null;

    if (!parsed || typeof parsed !== "object")
        throw new Error("Failed to deserialize log entry");

    const { time, level, context, message, meta, stack } = parsed;
    if (
        typeof time !== "string" ||
        !time ||
        typeof level !== "string" ||
        !level ||
        !context ||
        typeof context !== "object" ||
        typeof message !== "string" ||
        !meta ||
        typeof meta !== "object" ||
        typeof stack !== "string"
    ) {
        throw new Error("Failed to deserialize log entry");
    }

    return {
        time,
        level: level as LogLevel,
        context,
        message,
        meta: meta as object,
        stack
    };
}

export function compressToBase64(json: string) {
    const compressed = compressSync(strToU8(json));
    return Buffer.from(compressed).toString("base64");
}

export function decompressFromBase64(compressedLogs: string): string {
    const bytes = Uint8Array.from(Buffer.from(compressedLogs, "base64"));
    const unzipped = decompressSync(bytes);
    return strFromU8(unzipped);
}
