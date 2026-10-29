import { Console } from "node:console";
import { once } from "node:events";
import { createWriteStream, WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createLogger } from "../../src/utils/logging";
import { LogEntry } from "../../src/utils/logging/Logger";
import {
    decodeLogs,
    decompressFromBase64
} from "../../src/utils/logging/logEncoder";

/** a peer address as a path segment */
export type PeerDirName = string;
/** the realm that wrote the stream - "main", "sdk" or "vm" */
export type ThreadDirName = string;
/** the channel id as a path segment - the on-disk dir may add a timestamp */
export type ChannelIdSegment = string;

/** one merged read. `skippedChunks` is what the server left out of it. */
export type FetchedLog = {
    logEntries: LogEntry[];
    skippedChunks: number;
};

export function getCrashLogBaseUrl(uploadEndpoint: string): string {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(uploadEndpoint);
    } catch {
        throw new Error(
            `CRASH_LOG_UPLOAD_ENDPOINT is not a valid URL: ${uploadEndpoint}`
        );
    }

    const suffix = "/logs/upload";
    if (!parsedUrl.pathname.endsWith(suffix)) {
        throw new Error(
            `CRASH_LOG_UPLOAD_ENDPOINT must end with ${suffix}, got: ${parsedUrl.pathname}`
        );
    }

    const basePath = parsedUrl.pathname.slice(0, -suffix.length);
    return `${parsedUrl.origin}${basePath}`;
}

export function sanitizeFileSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** how many stored chunks a merged read left out. the body is a plain blob, so
 *  the server says it on a header, and a read that ignores it looks complete. */
export function skippedChunksOf(response: Response): number {
    return Number(response.headers.get("x-skipped-chunks") ?? 0);
}

export function compareLogEntries(left: LogEntry, right: LogEntry): number {
    // wall clock first - the only field that orders three realms
    if (left.wallTimeMs !== right.wallTimeMs) {
        return left.wallTimeMs - right.wallTimeMs;
    }

    const leftTime = Number(left.time);
    const rightTime = Number(right.time);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        if (leftTime !== rightTime) {
            return leftTime - rightTime;
        }
    } else if (left.time !== right.time) {
        return left.time.localeCompare(right.time);
    }

    const leftPeer = String(left.sharedContext.peerAddress ?? "");
    const rightPeer = String(right.sharedContext.peerAddress ?? "");
    if (leftPeer !== rightPeer) {
        return leftPeer.localeCompare(rightPeer);
    }

    return left.message.localeCompare(right.message);
}

async function withConsoleRedirect<T>(
    stream: WriteStream,
    action: () => Promise<T>
): Promise<T> {
    const fileConsole = new Console({
        stdout: stream,
        stderr: stream,
        colorMode: true,
        inspectOptions: {
            depth: null
        }
    });

    const methodNames = [
        "debug",
        "info",
        "log",
        "warn",
        "error",
        "trace",
        "group",
        "groupCollapsed",
        "groupEnd"
    ] as const;

    const originalMethods = Object.fromEntries(
        methodNames.map((name) => [name, (console as any)[name]])
    ) as Record<(typeof methodNames)[number], (...args: any[]) => void>;

    for (const name of methodNames) {
        const nextMethod = (fileConsole as any)[name];
        if (typeof nextMethod === "function") {
            (console as any)[name] = nextMethod.bind(fileConsole);
        }
    }

    try {
        return await action();
    } finally {
        for (const name of methodNames) {
            (console as any)[name] = originalMethods[name];
        }
        stream.end();
        await once(stream, "finish");
    }
}

export async function fetchLogEntries(request: {
    baseUrl: string;
    channelId: ChannelIdSegment;
    peerAddress: PeerDirName;
    threadName?: ThreadDirName;
}): Promise<FetchedLog> {
    const { baseUrl, channelId, peerAddress, threadName } = request;
    const threadSuffix = threadName ? `/${encodeURIComponent(threadName)}` : "";
    const response = await fetch(
        `${baseUrl}/logs/${encodeURIComponent(channelId)}/${encodeURIComponent(peerAddress)}${threadSuffix}`
    );
    if (!response.ok) {
        throw new Error(
            `Failed to fetch logs for ${channelId}:${peerAddress}${threadSuffix}: ${response.status} ${response.statusText}`
        );
    }

    const base64 = await response.text();
    const serializedLogs = decompressFromBase64(base64);
    return {
        logEntries: decodeLogs(serializedLogs).sort(compareLogEntries),
        skippedChunks: skippedChunksOf(response)
    };
}

/** replays the entries into `<outputDir>/<peer>[.<thread>].ansi`. a short read
 *  is marked at the top of the file, where a reader starts. */
export async function persistLogEntries(request: {
    outputDir: string;
    channelId: ChannelIdSegment;
    peerAddress: PeerDirName;
    logEntries: LogEntry[];
    skippedChunks: number;
    threadName?: ThreadDirName;
}): Promise<string> {
    const {
        outputDir,
        channelId,
        peerAddress,
        logEntries,
        skippedChunks,
        threadName
    } = request;
    await mkdir(outputDir, { recursive: true });

    const fileStem = threadName
        ? `${sanitizeFileSegment(peerAddress)}.${sanitizeFileSegment(threadName)}`
        : sanitizeFileSegment(peerAddress);
    const outputPath = path.join(outputDir, `${fileStem}.ansi`);
    const replayLogger = createLogger(
        { channelId, peerAddress },
        { component: "LogReplay" },
        { level: "debug" }
    );

    const stream = createWriteStream(outputPath, { flags: "w" });
    await withConsoleRedirect(stream, async () => {
        replayLogger.info("Replaying fetched logs", {
            channelId,
            peerAddress,
            count: logEntries.length
        });
        if (skippedChunks > 0) {
            replayLogger.error(
                "Incomplete log: the server skipped stored chunks in this read",
                { skippedChunks }
            );
        }

        for (const logEntry of logEntries) {
            replayLogger.logEntry(logEntry);
        }
    });

    return outputPath;
}
