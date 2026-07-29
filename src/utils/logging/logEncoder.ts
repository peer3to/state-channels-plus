import { LogEntry, LogLevel } from "./Logger";
import { Buffer } from "buffer";
import { compressSync, decompressSync, strToU8, strFromU8 } from "fflate";

export function encodeLogs(logs: LogEntry[]): string {
    return JSON.stringify(logs.map((log) => encodeLogEntry(log)));
}

export function decodeLogs(encodedLogs: string): LogEntry[] {
    const parsed = JSON.parse(encodedLogs) as string[] | null;
    if (!parsed) throw new Error("Failed to deserialize log entries");

    return parsed.map((encodedLog) => decodeLogEntry(encodedLog));
}

// Reads one allowlisted Error field defensively. A hostile error can define a
// throwing getter (must not escape the crash handler that is trying to log it)
// or a getter that returns a non-string - e.g. the secret-bearing error itself -
// which must not slip a raw object into the "safe" record.
function readErrorField(error: Error, key: "name" | "message" | "stack"): string {
    try {
        const value = error[key];
        if (value === undefined || value === null) return "";
        return typeof value === "string" ? value : "[non-string]";
    } catch {
        return "[unreadable]";
    }
}

// Allowlist only safe fields. Never copy arbitrary own properties: rich error
// graphs (e.g. an AxiosError) own `config`, `request`, and `response`, so
// `config.headers.Authorization`, cookies, and request bodies must not be
// serialized. Keep a vetted `code` when it is a plain scalar.
function toSafeErrorRecord(error: Error): Record<string, unknown> {
    const safeError: Record<string, unknown> = {
        name: readErrorField(error, "name"),
        message: readErrorField(error, "message"),
        stack: readErrorField(error, "stack")
    };
    try {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" || typeof code === "number") {
            safeError.code = code;
        }
    } catch {
        // unreadable code getter - drop it
    }
    return safeError;
}

// Sanitize the whole graph BEFORE JSON.stringify. stringify invokes an object's
// own toJSON() before any replacer sees it, and AxiosError.toJSON() returns a
// plain object carrying `config` - so a replacer-only allowlist is bypassed.
// We therefore walk EVERY object into a safe clone: replacing every Error with
// the safe record no matter how deeply it is wrapped, and never returning an
// object to JSON.stringify (which would let it invoke a nested Error's toJSON or
// throw on a cycle). `Date` keeps its native serialization; an untrusted
// enumerable `toJSON` is neither copied nor invoked.
function sanitizeForEncoding(value: unknown, seen: WeakSet<object>): unknown {
    if (value instanceof Error) return toSafeErrorRecord(value);
    // Never hand a function to JSON.stringify: an own `toJSON` on a function is
    // invoked after this walk and can re-expose an Error graph. Functions carry
    // no log payload, so drop them.
    if (typeof value === "function") return undefined;
    if (typeof value !== "object" || value === null) return value;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForEncoding(item, seen));
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
        // Skip an enumerable `toJSON` so a nested error/secret can never be
        // re-serialized through an untrusted serializer on the clone.
        if (key === "toJSON") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        // Do not invoke accessors while building the wire-safe clone: a getter
        // can materialize an Error's `config`/`toJSON()` into a plain object,
        // erasing the Error identity before recursion can redact it.
        if (
            typeof descriptor.get === "function" ||
            typeof descriptor.set === "function"
        ) {
            sanitized[key] = "[accessor]";
            continue;
        }
        sanitized[key] = sanitizeForEncoding(descriptor.value, seen);
    }
    return sanitized;
}

export function encodeLogEntry(logEntry: LogEntry): string {
    const sanitized = sanitizeForEncoding(logEntry, new WeakSet<object>());
    return JSON.stringify(sanitized, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
    );
}

export function decodeLogEntry(encodedLogEntry: string): LogEntry {
    const parsed = JSON.parse(encodedLogEntry) as Partial<LogEntry> | null;
    if (!parsed || typeof parsed !== "object")
        throw new Error("Failed to deserialize log entry");

    const { time, level, context, sharedContext, message, meta, stack } =
        parsed;
    if (
        typeof time !== "string" ||
        !time ||
        typeof level !== "string" ||
        !level ||
        !context ||
        typeof context !== "object" ||
        !sharedContext ||
        typeof sharedContext !== "object" ||
        typeof message !== "string" ||
        !meta ||
        !Array.isArray(meta) ||
        typeof stack !== "string"
    ) {
        throw new Error("Failed to deserialize log entry - invalid fields");
    }

    return {
        time,
        level: level as LogLevel,
        context,
        sharedContext,
        message,
        meta,
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
