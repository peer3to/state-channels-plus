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

function getPeerAddressesForChannel(
    index: Record<string, string[]>,
    requestedChannelId: string
): string[] {
    const matchingKeys = Object.keys(index).filter(
        (key) =>
            key === requestedChannelId ||
            key.startsWith(`${requestedChannelId}_`)
    );

    const peerAddresses = new Set<string>();
    for (const key of matchingKeys) {
        for (const peerAddress of index[key] ?? []) {
            peerAddresses.add(peerAddress);
        }
    }

    return Array.from(peerAddresses).sort();
}

function compareLogEntries(left: LogEntry, right: LogEntry): number {
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

async function fetchLogEntries(
    baseUrl: string,
    requestedChannelId: string,
    peerAddress: string
): Promise<LogEntry[]> {
    const response = await fetch(
        `${baseUrl}/logs/${encodeURIComponent(requestedChannelId)}/${encodeURIComponent(peerAddress)}`
    );
    if (!response.ok) {
        throw new Error(
            `Failed to fetch logs for ${requestedChannelId}:${peerAddress}: ${response.status} ${response.statusText}`
        );
    }

    const base64 = await response.text();
    const serializedLogs = decompressFromBase64(base64);
    return decodeLogs(serializedLogs).sort(compareLogEntries);
}

async function persistLogEntries(
    outputDir: string,
    requestedChannelId: string,
    peerAddress: string,
    logEntries: LogEntry[]
): Promise<string> {
    await mkdir(outputDir, { recursive: true });

    const outputPath = path.join(
        outputDir,
        `${sanitizeFileSegment(peerAddress)}.ansi`
    );
    const replayLogger = createLogger(
        { channelId: requestedChannelId, peerAddress: peerAddress as any },
        { component: "LogReplay" },
        { level: "debug" }
    );

    const stream = createWriteStream(outputPath, { flags: "w" });
    await withConsoleRedirect(stream, async () => {
        replayLogger.info("Replaying fetched logs", {
            channelId: requestedChannelId,
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

    const index = (await indexResponse.json()) as Record<string, string[]>;
    const peerAddresses = getPeerAddressesForChannel(index, channelId);
    if (peerAddresses.length === 0) {
        throw new Error(`No peer logs found for channelId ${channelId}`);
    }

    console.log("Found peer log files", {
        channelId,
        peerAddresses,
        count: peerAddresses.length
    });

    for (const peerAddress of peerAddresses) {
        console.log("Fetching peer logs", { channelId, peerAddress });
        const logEntries = await fetchLogEntries(
            baseUrl,
            channelId,
            peerAddress
        );
        const outputPath = await persistLogEntries(
            outputDir,
            channelId,
            peerAddress,
            logEntries
        );

        console.log("Persisted peer logs", {
            channelId,
            peerAddress,
            count: logEntries.length,
            outputPath
        });
    }
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
