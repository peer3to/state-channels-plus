import { createLogger } from "../../src/utils/logging";

const baseUrl = process.argv[2] || "http://localhost:3001";

async function main() {
    const logger = createLogger(
        {},
        { component: "LogIndex" },
        { level: "info" }
    );
    const response = await fetch(`${baseUrl}/logs/index`);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch index: ${response.status} ${response.statusText}`
        );
    }
    const data = (await response.json()) as Record<string, string[]>;
    logger.info("Log index", data);
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
