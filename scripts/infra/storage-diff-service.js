#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

// A source checkout runs the service's TypeScript through ts-node; the
// compiled tree (dist/scripts/infra) has no tsconfig and loads the compiled
// modules instead.
const tsconfig = path.join(__dirname, "..", "..", "tsconfig.json");
if (fs.existsSync(tsconfig)) {
    process.env.TS_NODE_PROJECT ||= tsconfig;
    require("ts-node/register");
}
const {
    StorageDiffService
} = require("../../src/utils/node/storageDiff/StorageDiffService");
const {
    parseStorageDiffArgs
} = require("../../src/utils/node/storageDiff/storageDiffCli");
const { createLogger } = require("../../src/utils/logging/node/createLogger");

async function main() {
    const service = await StorageDiffService.start({
        ...parseStorageDiffArgs(process.argv.slice(2)),
        logger: createLogger({}, { component: "StorageDiffService" })
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "listening", url: service.url }));

    const shutdown = () => {
        service.close().then(
            () => process.exit(0),
            () => process.exit(1)
        );
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await service.closed;
}

main().then(
    () => process.exit(0),
    (error) => {
        // eslint-disable-next-line no-console
        console.error(`storage-diff-service failed: ${error.message}`);
        process.exit(1);
    }
);
