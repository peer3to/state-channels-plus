import type { StorageDiffServiceOptions } from "./StorageDiffService";
import { parseArgs } from "node:util";

/** Environment variable the upstream URL is read from without `--upstream`. */
export const UPSTREAM_URL_ENV = "STORAGE_DIFF_UPSTREAM_URL";

/** Count flags and the service option each one sets. */
const COUNT_FLAGS = {
    port: "port",
    retention: "retention",
    "max-peer-buffered-bytes": "maxPeerBufferedBytes",
    "max-addresses-per-request": "maxAddressesPerRequest",
    "max-subscriptions-per-connection": "maxSubscriptionsPerConnection",
    "max-connections": "maxConnections",
    "max-in-flight-requests": "maxInFlightRequests",
    "max-watched-addresses": "maxWatchedAddresses"
} as const;

function parseCount(name: string, value: string): number {
    if (!/^\d+$/.test(value)) {
        throw new Error(`--${name} must be a non-negative integer`);
    }
    return Number(value);
}

/**
 * Service options from the command line of
 * `scripts/infra/storage-diff-service.js`. Rejects unknown flags; the
 * logger is the caller's. The upstream URL may come from
 * {@link UPSTREAM_URL_ENV} instead of `--upstream`, which keeps credentials
 * in it out of the process list.
 */
export function parseStorageDiffArgs(
    argv: string[],
    env: NodeJS.ProcessEnv = process.env
): Omit<StorageDiffServiceOptions, "logger"> {
    const { values } = parseArgs({
        args: argv,
        options: {
            upstream: { type: "string" },
            host: { type: "string" },
            "allow-origin": { type: "string", multiple: true },
            port: { type: "string" },
            retention: { type: "string" },
            "max-peer-buffered-bytes": { type: "string" },
            "max-addresses-per-request": { type: "string" },
            "max-subscriptions-per-connection": { type: "string" },
            "max-connections": { type: "string" },
            "max-in-flight-requests": { type: "string" },
            "max-watched-addresses": { type: "string" }
        },
        strict: true,
        allowPositionals: false
    });
    const upstreamUrl = values.upstream ?? env[UPSTREAM_URL_ENV];
    if (!upstreamUrl) {
        throw new Error(
            `--upstream <ws://... | wss://...> or ${UPSTREAM_URL_ENV} is required`
        );
    }
    const options: Omit<StorageDiffServiceOptions, "logger"> = { upstreamUrl };
    if (values.host !== undefined) options.host = values.host;
    if (values["allow-origin"] !== undefined)
        options.allowedOrigins = values["allow-origin"];
    for (const flag of Object.keys(
        COUNT_FLAGS
    ) as (keyof typeof COUNT_FLAGS)[]) {
        const value = values[flag];
        if (value !== undefined)
            options[COUNT_FLAGS[flag]] = parseCount(flag, value);
    }
    return options;
}
