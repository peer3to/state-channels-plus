import dotenv from "dotenv";
import { Console } from "node:console";
import { once } from "node:events";
import { createWriteStream, existsSync, WriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { createLogger } from "../../src/utils/logging";
import { LogEntry } from "../../src/utils/logging/Logger";
import {
    decodeLogs,
    decompressFromBase64
} from "../../src/utils/logging/logEncoder";

dotenv.config();

const channelId = process.argv[2];

if (!channelId) {
    // eslint-disable-next-line no-console
    console.error("Usage: ts-node scripts/logging/fetch-logs.ts <channelId>");
    process.exit(1);
}

function getCrashLogBaseUrl(uploadEndpoint: string): string {
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

function sanitizeFileSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function findPackageRoot(startDir: string): string {
    let currentDir = path.resolve(startDir);

    while (true) {
        if (existsSync(path.join(currentDir, "package.json"))) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error("Could not find package.json from script location");
        }

        currentDir = parentDir;
    }
}

/** a channel id, or `<channelId>_<dd-mm-yyyy#hh:mm:ss>` once the dir has rotated */
type ChannelDirName = string;
/** a peer address as a path segment */
type PeerDirName = string;
/** the realm that wrote the stream - "main", "sdk" or "vm" */
type ThreadDirName = string;
/** `<storeId>/<fromSeq>-<toSeq>.b64` */
type ChunkFileName = string;
/** the channel id as a path segment - the on-disk dir may add a timestamp */
type ChannelIdSegment = string;

/** channel -> peer -> thread -> that thread's chunks */
type LogIndex = Record<
    ChannelDirName,
    Record<PeerDirName, Record<ThreadDirName, ChunkFileName[]>>
>;

type PeerStreams = {
    peerAddress: PeerDirName;
    threads: ThreadDirName[];
};

function getPeerStreamsForChannel(
    index: LogIndex,
    requestedChannelId: string
): PeerStreams[] {
    const matchingKeys = Object.keys(index).filter(
        (key) =>
            key === requestedChannelId ||
            key.startsWith(`${requestedChannelId}_`)
    );

    const threadsByPeer = new Map<PeerDirName, Set<ThreadDirName>>();
    for (const key of matchingKeys) {
        for (const [peerAddress, perThread] of Object.entries(
            index[key] ?? {}
        )) {
            let threads = threadsByPeer.get(peerAddress);
            if (!threads) {
                threads = new Set<ThreadDirName>();
                threadsByPeer.set(peerAddress, threads);
            }
            for (const threadName of Object.keys(perThread ?? {})) {
                threads.add(threadName);
            }
        }
    }

    return Array.from(threadsByPeer.entries())
        .map(([peerAddress, threads]) => ({
            peerAddress,
            threads: Array.from(threads).sort()
        }))
        .sort((left, right) =>
            left.peerAddress.localeCompare(right.peerAddress)
        );
}

function compareLogEntries(left: LogEntry, right: LogEntry): number {
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

async function fetchLogEntries(request: {
    baseUrl: string;
    channelId: ChannelIdSegment;
    peerAddress: PeerDirName;
    threadName?: ThreadDirName;
}): Promise<LogEntry[]> {
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
    return decodeLogs(serializedLogs).sort(compareLogEntries);
}

async function persistLogEntries(request: {
    outputDir: string;
    channelId: ChannelIdSegment;
    peerAddress: PeerDirName;
    logEntries: LogEntry[];
    threadName?: ThreadDirName;
}): Promise<string> {
    const { outputDir, channelId, peerAddress, logEntries, threadName } =
        request;
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

        for (const logEntry of logEntries) {
            replayLogger.logEntry(logEntry);
        }
    });

    return outputPath;
}

async function main() {
    const uploadEndpoint = process.env.CRASH_LOG_UPLOAD_ENDPOINT;
    if (!uploadEndpoint) {
        throw new Error("CRASH_LOG_UPLOAD_ENDPOINT is missing from .env");
    }

    const packageRoot = findPackageRoot(__dirname);
    const baseUrl = getCrashLogBaseUrl(uploadEndpoint);
    const outputDir = path.join(packageRoot, "logs", channelId);

    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    console.log("Derived crash log base URL", { baseUrl });
    console.log("Resolved output directory", { outputDir });

    const indexResponse = await fetch(`${baseUrl}/logs/index`);
    if (!indexResponse.ok) {
        throw new Error(
            `Failed to fetch log index: ${indexResponse.status} ${indexResponse.statusText}`
        );
    }

    const index = (await indexResponse.json()) as LogIndex;
    const peerStreams = getPeerStreamsForChannel(index, channelId);
    if (peerStreams.length === 0) {
        throw new Error(`No peer logs found for channelId ${channelId}`);
    }

    console.log("Found peer log files", {
        channelId,
        peerStreams,
        count: peerStreams.length
    });

    /** thread kind -> streams seen across every peer */
    const streamsByThread = new Map<ThreadDirName, number>();
    /** thread kind -> entries fetched across every peer */
    const entriesByThread = new Map<ThreadDirName, number>();
    let totalEntries = 0;

    for (const { peerAddress, threads } of peerStreams) {
        console.log("Fetching peer logs", { channelId, peerAddress, threads });
        const logEntries = await fetchLogEntries({
            baseUrl,
            channelId,
            peerAddress
        });
        const outputPath = await persistLogEntries({
            outputDir,
            channelId,
            peerAddress,
            logEntries
        });

        totalEntries += logEntries.length;
        console.log("Persisted peer logs", {
            channelId,
            peerAddress,
            count: logEntries.length,
            outputPath
        });

        for (const threadName of threads) {
            const threadEntries = await fetchLogEntries({
                baseUrl,
                channelId,
                peerAddress,
                threadName
            });
            const threadPath = await persistLogEntries({
                outputDir,
                channelId,
                peerAddress,
                logEntries: threadEntries,
                threadName
            });
            streamsByThread.set(
                threadName,
                (streamsByThread.get(threadName) ?? 0) + 1
            );
            entriesByThread.set(
                threadName,
                (entriesByThread.get(threadName) ?? 0) + threadEntries.length
            );
            // a missing thread shows up in the per-thread counts
            console.log("Persisted thread logs", {
                channelId,
                peerAddress,
                threadName,
                count: threadEntries.length,
                outputPath: threadPath
            });
        }
    }

    // what arrived. a thread the run had but the server never received is
    // absent here - the `Log flush round reached` entry names how many
    console.log("Collected log summary", {
        channelId,
        peers: peerStreams.length,
        entries: totalEntries,
        streamsByThread: Object.fromEntries(streamsByThread),
        entriesByThread: Object.fromEntries(entriesByThread)
    });
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
