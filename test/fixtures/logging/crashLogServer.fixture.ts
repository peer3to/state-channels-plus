// @spec-test-coverage-ignore: crash-log server staging shared by its suites; the suites own the declarations
import path from "path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

export type UploadValidation =
    | { ok: true }
    | { ok: false; status: number; error: string };

type CrashLogServerModule = {
    app: { listen: (port: number, host: string) => Server };
    sanitizeSegment: (value: unknown) => string;
    validateUploadBody: (body: unknown) => UploadValidation;
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

/** runs `action` with the server's per-chunk inflate ceiling lowered, so a fat
 *  chunk is skipped from a merged read. restores the ceiling afterwards. */
export async function withInflateCeiling<T>(
    maxSizeMb: string,
    action: () => Promise<T>
): Promise<T> {
    const previous = process.env.CRASH_LOG_MAX_SIZE_MB;
    process.env.CRASH_LOG_MAX_SIZE_MB = maxSizeMb;
    try {
        return await action();
    } finally {
        if (previous === undefined) delete process.env.CRASH_LOG_MAX_SIZE_MB;
        else process.env.CRASH_LOG_MAX_SIZE_MB = previous;
    }
}
