// @spec-test-coverage-ignore: storage diff service staging; executable evidence belongs to its calling test declarations
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import { StorageDiffClient } from "./StorageDiffClient";
import { UpstreamRelay } from "./UpstreamRelay";
import { createLogger } from "@/utils";
import type ABackfillBlockSource from "@/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource";
import type AIncludedHeadStrategy from "@/utils/node/storageDiff/includedHead/AIncludedHeadStrategy";
import {
    StorageDiffService,
    type BackfillRecord
} from "@/utils/node/storageDiff/StorageDiffService";
import { type JsonRpcProvider, type JsonRpcSigner } from "ethers";

/** What `promise` rejected with, or undefined when it resolved. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    return await promise.then(
        () => undefined,
        (error: unknown) => error
    );
}

/**
 * How many field reads (slot, balance, nonce, code) reached the upstream
 * through `relay`: the observable count of the service's lazy fetches.
 */
export function fieldReads(relay: UpstreamRelay): number {
    return [
        "eth_getStorageAt",
        "eth_getBalance",
        "eth_getTransactionCount",
        "eth_getCode"
    ].reduce((sum, method) => sum + relay.requestCount(method), 0);
}

export type StorageDiffServiceSettings = {
    retention?: number;
    cacheDir?: string;
    maxPeerBufferedBytes?: number;
    includedHead?: AIncludedHeadStrategy;
    backfillBlocks?: ABackfillBlockSource;
};

/** A `warn` call of the service's logger. */
export type LoggedWarning = { message: string; meta: unknown[] };

export type StorageDiffUpstream = {
    provider: JsonRpcProvider;
    /** Sits between the service and the node, for upstream faults. */
    relay: UpstreamRelay;
    signer: JsonRpcSigner;
    /** Warnings the services' loggers got, oldest first. */
    warnings: LoggedWarning[];
    /** What each backfill the services finished cost and found, oldest first. */
    backfills: BackfillRecord[];
    /** Starts a service on the relay; it is closed in `finally`. */
    start: (
        settings?: StorageDiffServiceSettings
    ) => Promise<StorageDiffService>;
};

export type StorageDiffSession = Omit<StorageDiffUpstream, "start"> & {
    service: StorageDiffService;
    client: StorageDiffClient;
};

/**
 * Runs `use` with a private node and a relay to it; services started through
 * `start` and the relay end in `finally`.
 */
export async function withStorageDiffUpstream<T>(
    use: (upstream: StorageDiffUpstream) => Promise<T>
): Promise<T> {
    return await withIsolatedHardhatNode(async (provider) => {
        // anvil mines on submit: poll receipts often, not every 4 s
        provider.pollingInterval = 50;
        // anvil serves WebSocket subscriptions on its HTTP port
        const relay = await UpstreamRelay.start(
            provider._getConnection().url.replace(/^http/, "ws")
        );
        const services: StorageDiffService[] = [];
        const warnings: LoggedWarning[] = [];
        const backfills: BackfillRecord[] = [];
        try {
            const signer = await provider.getSigner(0);
            const start = async (settings: StorageDiffServiceSettings = {}) => {
                const logger = createLogger(
                    {},
                    { component: "StorageDiffService" }
                );
                // Records each warning, then logs it as usual.
                const warn = logger.warn.bind(logger);
                logger.warn = (message: unknown, ...meta: unknown[]) => {
                    warnings.push({ message: String(message), meta });
                    warn(message, ...meta);
                };
                // Records each finished backfill, then logs it as usual.
                const info = logger.info.bind(logger);
                logger.info = (message: unknown, ...meta: unknown[]) => {
                    if (message === "Backfilled an account")
                        backfills.push(meta[0] as BackfillRecord);
                    info(message, ...meta);
                };
                const service = await StorageDiffService.start({
                    upstreamUrl: relay.url,
                    port: 0,
                    ...settings,
                    logger
                });
                services.push(service);
                return service;
            };
            return await use({
                provider,
                relay,
                signer,
                warnings,
                backfills,
                start
            });
        } finally {
            for (const service of services) await service.close();
            await relay.close();
        }
    });
}

/**
 * Runs `use` with a private node, a service following it through a relay and
 * a connected client; all of them end in `finally`.
 */
export async function withStorageDiffSession<T>(
    use: (session: StorageDiffSession) => Promise<T>,
    settings: StorageDiffServiceSettings = {}
): Promise<T> {
    return await withStorageDiffUpstream(async ({ start, ...upstream }) => {
        const service = await start(settings);
        const client = await StorageDiffClient.connect(service.url);
        try {
            return await use({ ...upstream, service, client });
        } finally {
            client.close();
        }
    });
}
