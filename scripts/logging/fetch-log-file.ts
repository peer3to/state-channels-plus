import { createLogger } from "../../src/utils/logging";
import {
    decodeLogs,
    decompressFromBase64
} from "../../src/utils/logging/logEncoder";

const baseUrl = process.argv[2] || "http://localhost:3001";
const channelId = process.argv[3];
const peerAddress = process.argv[4];

if (!channelId || !peerAddress) {
    // eslint-disable-next-line no-console
    console.error(
        "Usage: ts-node scripts/logging/fetch-log-file.ts <baseUrl> <channelId> <peerAddress>"
    );
    process.exit(1);
}

async function main() {
    const logger = createLogger(
        {},
        { component: "LogFetch" },
        { level: "debug" }
    );
    const response = await fetch(
        `${baseUrl}/logs/${encodeURIComponent(channelId)}/${encodeURIComponent(peerAddress)}`
    );
    if (!response.ok) {
        throw new Error(
            `Failed to fetch log: ${response.status} ${response.statusText}`
        );
    }

    const base64 = await response.text();
    logger.info("Fetched log file base64", { base64 });
    const serializedLogs = decompressFromBase64(base64);
    logger.info("Decompressed log file", { serializedLogs });
    const logs = decodeLogs(serializedLogs);

    logger.info("Fetched log entries", {
        count: logs.length,
        channelId,
        peerAddress
    });
    for (const entry of logs) {
        logger.logEntry(entry);
    }
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
