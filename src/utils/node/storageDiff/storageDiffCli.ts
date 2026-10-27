import { DepthIncludedHeadStrategy } from "./includedHead/DepthIncludedHeadStrategy";
import { RelayIncludedHeadStrategy } from "./includedHead/RelayIncludedHeadStrategy";
import type { StorageDiffServiceOptions } from "./StorageDiffService";
import { parseArgs } from "node:util";

const DEFAULT_PARA_ID = 1000;

function parseCount(name: string, value: string): number {
    if (!/^\d+$/.test(value)) {
        throw new Error(`--${name} must be a non-negative integer`);
    }
    return Number(value);
}

/**
 * Service options from the command line of
 * `scripts/infra/storage-diff-service.js`. Rejects unknown flags and
 * inconsistent combinations; the logger is the caller's.
 */
export function parseStorageDiffArgs(
    argv: string[]
): Omit<StorageDiffServiceOptions, "logger"> {
    const { values } = parseArgs({
        args: argv,
        options: {
            upstream: { type: "string" },
            host: { type: "string" },
            port: { type: "string" },
            retention: { type: "string" },
            "max-peer-buffered-bytes": { type: "string" },
            "included-relay-url": { type: "string" },
            "included-asset-hub-url": { type: "string" },
            "included-para-id": { type: "string" },
            "included-dev-depth": { type: "string" }
        },
        strict: true,
        allowPositionals: false
    });
    if (!values.upstream) {
        throw new Error("--upstream <ws://... | wss://...> is required");
    }
    const relayUrl = values["included-relay-url"];
    const assetHubUrl = values["included-asset-hub-url"];
    const paraId = values["included-para-id"];
    const devDepth = values["included-dev-depth"];
    const relayFlags = [relayUrl, assetHubUrl, paraId].some(
        (flag) => flag !== undefined
    );
    if (relayFlags && devDepth !== undefined) {
        throw new Error(
            "--included-dev-depth cannot be combined with the --included-relay-url flags"
        );
    }
    let includedHead;
    if (relayFlags) {
        if (relayUrl === undefined || assetHubUrl === undefined) {
            throw new Error(
                "--included-relay-url and --included-asset-hub-url are required together"
            );
        }
        includedHead = new RelayIncludedHeadStrategy({
            relayUrl,
            assetHubUrl,
            paraId:
                paraId === undefined
                    ? DEFAULT_PARA_ID
                    : parseCount("included-para-id", paraId)
        });
    } else if (devDepth !== undefined) {
        includedHead = new DepthIncludedHeadStrategy(
            parseCount("included-dev-depth", devDepth)
        );
    }
    return {
        upstreamUrl: values.upstream,
        ...(values.host !== undefined && { host: values.host }),
        ...(values.port !== undefined && {
            port: parseCount("port", values.port)
        }),
        ...(values.retention !== undefined && {
            retention: parseCount("retention", values.retention)
        }),
        ...(values["max-peer-buffered-bytes"] !== undefined && {
            maxPeerBufferedBytes: parseCount(
                "max-peer-buffered-bytes",
                values["max-peer-buffered-bytes"]
            )
        }),
        ...(includedHead && { includedHead })
    };
}
