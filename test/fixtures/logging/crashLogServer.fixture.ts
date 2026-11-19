// @spec-test-coverage-ignore: crash-log server staging shared by its suites; the suites own the declarations
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "path";

export type UploadValidation =
    | { ok: true }
    | { ok: false; status: number; error: string };

type CrashLogServerModule = {
    app: { listen: (port: number, host: string) => Server };
    sanitizeSegment: (value: unknown) => string;
    validateUploadBody: (body: unknown) => UploadValidation;
    MAX_UPLOAD_BODY_BYTES: number;
};

/** the server module. it reads CRASH_LOG_DIR at import, so a fresh dir is set
 *  before the require and reused by every later caller in this process. its
 *  start() is behind `require.main === module`, so requiring spins nothing up. */
export function loadCrashLogServer(): CrashLogServerModule & {
    logDir: string;
} {
    process.env.CRASH_LOG_DIR ??= mkdtempSync(
        path.join(tmpdir(), "crash-log-server-test-")
    );
    const server =
        require("../../../scripts/logging/crash-log-server.js") as CrashLogServerModule;
    return { ...server, logDir: process.env.CRASH_LOG_DIR };
}

export const { encodeChunk, decodeChunk } =
    require("../../../scripts/logging/logChunks.js") as {
        encodeChunk: (entries: unknown[]) => string;
        decodeChunk: (base64: string) => { message: string }[];
    };

export function logEntries(count: number): unknown[] {
    return Array.from({ length: count }, (_unused, index) => ({
        time: "1",
        wallTimeMs: 1 + index,
        level: "info",
        context: {},
        sharedContext: { threadName: "vm" },
        message: `entry ${index}`,
        meta: [],
        stack: "stack"
    }));
}

/** entries fat enough that a handful of chunks exhaust a lowered merge budget */
export function paddedLogEntries(count: number, marker: string): unknown[] {
    return Array.from({ length: count }, (_unused, index) => ({
        time: "1",
        wallTimeMs: 1 + index,
        level: "info",
        context: {},
        sharedContext: { threadName: "vm" },
        message: `${marker} ${index}`,
        meta: [],
        stack: `${marker}-${index}-`.padEnd(1000, "x")
    }));
}

export function uploadBody(overrides: Record<string, unknown> = {}) {
    return {
        channelId: "0x" + "ab".repeat(32),
        peerAddress: "0x" + "cd".repeat(20),
        threadName: "vm",
        storeId: "a1b2c3d4",
        compressedLogs: encodeChunk(logEntries(3)),
        fromSeq: 0,
        toSeq: 2,
        ...overrides
    };
}

/** the app on a free loopback port */
export async function listenOn(
    app: CrashLogServerModule["app"]
): Promise<{ server: Server; baseUrl: string }> {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** one upload, as the SDK sends it; returns the status */
export async function upload(
    baseUrl: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
): Promise<number> {
    const response = await fetch(`${baseUrl}/logs/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
    });
    return response.status;
}

/** runs `action` with the server's per-chunk inflate ceiling lowered: a fat
 *  chunk is refused on upload and skipped from a merged read. restores the
 *  ceiling afterwards. */
export async function withInflateCeiling<T>(
    maxSizeMb: string,
    action: () => Promise<T>
): Promise<T> {
    const previous = process.env.CRASH_LOG_MAX_CHUNK_MB;
    process.env.CRASH_LOG_MAX_CHUNK_MB = maxSizeMb;
    try {
        return await action();
    } finally {
        if (previous === undefined) delete process.env.CRASH_LOG_MAX_CHUNK_MB;
        else process.env.CRASH_LOG_MAX_CHUNK_MB = previous;
    }
}

/**
 * Uploads `chunks` chunks of random entries, each about 9 MiB inflated and
 * barely compressible: a merged read of them outgrows every socket buffer, so
 * a client that stops reading holds the server's write.
 */
export async function uploadIncompressibleLog(
    baseUrl: string,
    channelId: string,
    peerAddress: string,
    chunks: number
): Promise<void> {
    const perChunk = 128;
    for (let index = 0; index < chunks; index += 1) {
        const entries = logEntries(perChunk).map((entry) => ({
            ...(entry as Record<string, unknown>),
            message: randomBytes(54 * 1024).toString("base64")
        }));
        const status = await upload(
            baseUrl,
            uploadBody({
                channelId,
                peerAddress,
                compressedLogs: encodeChunk(entries),
                fromSeq: index * perChunk,
                toSeq: (index + 1) * perChunk - 1
            })
        );
        if (status !== 200)
            throw new Error(`incompressible chunk upload answered ${status}`);
    }
}

/**
 * Opens a merged read and never reads its body: the server's write stalls
 * once the socket buffers are full. Resolves once the headers arrived, with
 * that time; `destroy` ends the connection from the client side. A paused
 * client never sees the server cut it, since it never reads up to the close.
 */
export async function holdMergedRead(
    url: string
): Promise<{ startedAt: number; destroy: () => void }> {
    const request = get(url);
    request.on("error", () => undefined);
    await once(request, "response");
    return { startedAt: Date.now(), destroy: () => request.destroy() };
}

/** runs `action` with the merged read's stall timeout lowered */
export async function withMergedReadTimeout<T>(
    timeoutMs: number,
    action: () => Promise<T>
): Promise<T> {
    const previous = process.env.CRASH_LOG_MERGED_READ_TIMEOUT_MS;
    process.env.CRASH_LOG_MERGED_READ_TIMEOUT_MS = String(timeoutMs);
    try {
        return await action();
    } finally {
        if (previous === undefined)
            delete process.env.CRASH_LOG_MERGED_READ_TIMEOUT_MS;
        else process.env.CRASH_LOG_MERGED_READ_TIMEOUT_MS = previous;
    }
}
