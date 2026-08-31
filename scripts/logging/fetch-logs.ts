import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
    fetchLogEntries,
    getCrashLogBaseUrl,
    persistLogEntries,
    type PeerDirName,
    type ThreadDirName
} from "./logFetch";

dotenv.config();

const channelId = process.argv[2];

if (!channelId) {
    // eslint-disable-next-line no-console
    console.error("Usage: ts-node scripts/logging/fetch-logs.ts <channelId>");
    process.exit(1);
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
/** `<storeId>/<fromSeq>-<toSeq>.b64` */
type ChunkFileName = string;
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
    let totalSkippedChunks = 0;

    for (const { peerAddress, threads } of peerStreams) {
        console.log("Fetching peer logs", { channelId, peerAddress, threads });
        const fetched = await fetchLogEntries({
            baseUrl,
            channelId,
            peerAddress
        });
        const outputPath = await persistLogEntries({
            outputDir,
            channelId,
            peerAddress,
            ...fetched
        });

        totalEntries += fetched.logEntries.length;
        totalSkippedChunks += fetched.skippedChunks;
        console.log("Persisted peer logs", {
            channelId,
            peerAddress,
            count: fetched.logEntries.length,
            skippedChunks: fetched.skippedChunks,
            outputPath
        });

        for (const threadName of threads) {
            const thread = await fetchLogEntries({
                baseUrl,
                channelId,
                peerAddress,
                threadName
            });
            const threadPath = await persistLogEntries({
                outputDir,
                channelId,
                peerAddress,
                ...thread,
                threadName
            });
            streamsByThread.set(
                threadName,
                (streamsByThread.get(threadName) ?? 0) + 1
            );
            entriesByThread.set(
                threadName,
                (entriesByThread.get(threadName) ?? 0) +
                    thread.logEntries.length
            );
            totalSkippedChunks += thread.skippedChunks;
            // a missing thread shows up in the per-thread counts
            console.log("Persisted thread logs", {
                channelId,
                peerAddress,
                threadName,
                count: thread.logEntries.length,
                skippedChunks: thread.skippedChunks,
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
        skippedChunks: totalSkippedChunks,
        streamsByThread: Object.fromEntries(streamsByThread),
        entriesByThread: Object.fromEntries(entriesByThread)
    });
    if (totalSkippedChunks > 0) {
        console.warn(
            `Incomplete: the server skipped ${totalSkippedChunks} stored chunk(s); each affected file says so at its top`
        );
    }
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
