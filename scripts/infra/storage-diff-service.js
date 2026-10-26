#!/usr/bin/env node

const path = require("node:path");
const { parseArgs } = require("node:util");

process.env.TS_NODE_PROJECT ||= path.join(
    __dirname,
    "..",
    "..",
    "tsconfig.json"
);
require("ts-node/register");
const {
    StorageDiffService
} = require("../../src/utils/node/storageDiff/StorageDiffService");
const { createLogger } = require("../../src/utils/logging/node/createLogger");

function parseCount(name, value) {
    if (!/^\d+$/.test(value)) {
        throw new Error(`--${name} must be a non-negative integer`);
    }
    return Number(value);
}

async function main() {
    const { values } = parseArgs({
        options: {
            upstream: { type: "string" },
            host: { type: "string" },
            port: { type: "string" },
            retention: { type: "string" }
        },
        strict: true,
        allowPositionals: false
    });
    if (!values.upstream) {
        throw new Error("--upstream <ws://... | wss://...> is required");
    }
    const service = await StorageDiffService.start({
        upstreamUrl: values.upstream,
        logger: createLogger({}, { component: "StorageDiffService" }),
        ...(values.host !== undefined && { host: values.host }),
        ...(values.port !== undefined && {
            port: parseCount("port", values.port)
        }),
        ...(values.retention !== undefined && {
            retention: parseCount("retention", values.retention)
        })
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
