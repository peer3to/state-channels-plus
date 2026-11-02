import type { StorageDiffServiceOptions } from "./StorageDiffService";
import { parseArgs } from "node:util";

function parseCount(name: string, value: string): number {
    if (!/^\d+$/.test(value)) {
        throw new Error(`--${name} must be a non-negative integer`);
    }
    return Number(value);
}

/**
 * Service options from the command line of
 * `scripts/infra/storage-diff-service.js`. Rejects unknown flags; the
 * logger is the caller's.
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
            "max-peer-buffered-bytes": { type: "string" }
        },
        strict: true,
        allowPositionals: false
    });
    if (!values.upstream) {
        throw new Error("--upstream <ws://... | wss://...> is required");
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
        })
    };
}
