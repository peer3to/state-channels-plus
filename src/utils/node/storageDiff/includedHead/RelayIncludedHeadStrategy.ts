import AIncludedHeadStrategy, {
    type IncludedHead,
    type IncludedHeadHost
} from "./AIncludedHeadStrategy";
import {
    decodeParaHead,
    paraHeadKey,
    reviveBlockHashKey
} from "./assetHubInclusion";
import { isObject } from "../blockStorageDiff";
import {
    RECONCILE_RETRY_BACKOFF_MS,
    RECONCILE_RETRY_LIMIT,
    UPSTREAM_RECONNECT_BACKOFF_MS,
    UPSTREAM_RECONNECT_LIMIT
} from "../StorageDiffService";
import {
    UpstreamLostError,
    UpstreamRequestError,
    UpstreamRpcClient,
    UpstreamTimeoutError
} from "../UpstreamRpcClient";
import { errorMessage } from "@/utils/errorMessage";
import { retry } from "@/utils/retry";

export interface RelayIncludedHeadOptions {
    /** `ws://` or `wss://` relay chain node, e.g. wss://rpc.polkadot.io. */
    relayUrl: string;
    /** `ws://` or `wss://` Asset Hub Substrate node (not eth-rpc). */
    assetHubUrl: string;
    /** Relay chain id of the parachain; 1000 is Polkadot Asset Hub. */
    paraId: number;
}

/** `Revive::BlockHash` had no entry for an included block (yet). */
class BlockHashMissingError extends Error {}

function isTransient(error: unknown): boolean {
    return (
        error instanceof BlockHashMissingError ||
        error instanceof UpstreamRequestError ||
        error instanceof UpstreamTimeoutError
    );
}

/**
 * Asset Hub production strategy. The relay chain announces the parachain head
 * it included (`Paras::Heads(paraId)`, one storage subscription, a change per
 * inclusion). The announced Substrate block maps to the eth block through
 * `Revive::BlockHash(number)` read on Asset Hub at that block: one read per
 * inclusion. Nothing is polled.
 */
export class RelayIncludedHeadStrategy extends AIncludedHeadStrategy {
    private readonly options: RelayIncludedHeadOptions;
    private readonly headKey: string;
    private readonly stopping = new AbortController();
    private host?: IncludedHeadHost;
    private relay?: UpstreamRpcClient;
    private assetHub?: UpstreamRpcClient;
    private reconnecting = false;
    private reportedFirst: () => void = () => undefined;
    private firstFailed: (error: Error) => void = () => undefined;
    // Announcements are resolved one at a time, in order.
    private tail: Promise<void> = Promise.resolve();

    constructor(options: RelayIncludedHeadOptions) {
        super();
        this.options = options;
        this.headKey = paraHeadKey(options.paraId);
    }

    public async start(host: IncludedHeadHost): Promise<void> {
        this.host = host;
        const first = new Promise<void>((resolve, reject) => {
            this.reportedFirst = resolve;
            this.firstFailed = reject;
        });
        first.catch(() => undefined);
        // The subscription answers with the current head at once.
        await this.connect();
        await first;
    }

    public close(): void {
        this.stopping.abort();
        const reason = new Error("RelayIncludedHeadStrategy closed");
        this.relay?.close(reason);
        this.assetHub?.close(reason);
        this.firstFailed(reason);
    }

    public bestHeadCommitted(_head: IncludedHead): void {
        // The relay chain, not the upstream's best head, drives inclusion.
    }

    /** Opens both nodes and the head subscription, with bounded retries. */
    private async connect(): Promise<void> {
        await retry(
            async () => {
                const onLost = () => this.reconnect();
                const relay = await UpstreamRpcClient.connect(
                    this.options.relayUrl,
                    { onLost }
                );
                let assetHub: UpstreamRpcClient | undefined;
                try {
                    assetHub = await UpstreamRpcClient.connect(
                        this.options.assetHubUrl,
                        { onLost }
                    );
                    await relay.subscribe(
                        "state_subscribeStorage",
                        [[this.headKey]],
                        (result) => this.announced(assetHub!, result)
                    );
                    this.relay = relay;
                    this.assetHub = assetHub;
                } catch (error) {
                    const failed = new UpstreamLostError("Setup failed");
                    relay.close(failed);
                    assetHub?.close(failed);
                    throw error;
                }
            },
            {
                maxRetries: UPSTREAM_RECONNECT_LIMIT,
                delayMs: UPSTREAM_RECONNECT_BACKOFF_MS,
                useExponentialBackoff: true,
                signal: this.stopping.signal,
                shouldRetry: (error) =>
                    error instanceof UpstreamLostError || isTransient(error),
                onRetry: (attempt, error) =>
                    this.host?.logger.warn("Retrying the inclusion nodes", {
                        attempt,
                        reason: errorMessage(error)
                    })
            }
        );
        if (this.stopping.signal.aborted) {
            const closed = new Error("RelayIncludedHeadStrategy closed");
            this.relay?.close(closed);
            this.assetHub?.close(closed);
            throw closed;
        }
    }

    /** Replaces both connections after one was lost. */
    private reconnect(): void {
        if (this.reconnecting || this.stopping.signal.aborted) return;
        this.reconnecting = true;
        const lost = new UpstreamLostError("Inclusion connection replaced");
        this.relay?.close(lost);
        this.assetHub?.close(lost);
        this.host?.logger.warn("Inclusion connection lost; reconnecting");
        this.connect().then(
            () => {
                this.reconnecting = false;
            },
            (error) => this.host?.fail(error)
        );
    }

    /** A relay storage change: queues the mapping of the announced head. */
    private announced(assetHub: UpstreamRpcClient, result: unknown): void {
        this.tail = this.tail.then(async () => {
            try {
                const value = this.paraHeadOf(result);
                if (value === undefined) return;
                await this.report(assetHub, value);
            } catch (error) {
                // A lost connection is replaced; its subscription restarts
                // with the current head.
                if (error instanceof UpstreamLostError) return;
                const failure =
                    error instanceof Error ? error : new Error("unknown error");
                this.firstFailed(failure);
                this.host?.fail(failure);
            }
        });
    }

    private paraHeadOf(result: unknown): string | undefined {
        if (!isObject(result) || !Array.isArray(result.changes)) {
            throw new Error("Malformed storage change from the relay chain");
        }
        for (const change of result.changes) {
            if (!Array.isArray(change) || change[0] !== this.headKey) continue;
            if (change[1] === null) return undefined;
            if (typeof change[1] !== "string") {
                throw new Error(
                    "Malformed parachain head from the relay chain"
                );
            }
            return change[1];
        }
        return undefined;
    }

    /** Maps the included Substrate block to its eth block and reports it. */
    private async report(
        assetHub: UpstreamRpcClient,
        paraHead: string
    ): Promise<void> {
        const host = this.host!;
        const { number, substrateHash } = decodeParaHead(paraHead);
        const hash = await retry(
            async () => {
                const value = await assetHub.request("state_getStorage", [
                    reviveBlockHashKey(number),
                    substrateHash
                ]);
                if (value === null) {
                    throw new BlockHashMissingError(
                        `Revive::BlockHash(${number}) has no entry`
                    );
                }
                if (
                    typeof value !== "string" ||
                    !/^0x[0-9a-fA-F]{64}$/.test(value)
                ) {
                    throw new Error("Malformed Revive::BlockHash value");
                }
                return value.toLowerCase();
            },
            {
                maxRetries: RECONCILE_RETRY_LIMIT,
                delayMs: RECONCILE_RETRY_BACKOFF_MS,
                useExponentialBackoff: true,
                signal: this.stopping.signal,
                shouldRetry: isTransient,
                onRetry: (attempt, error) =>
                    host.logger.warn("Retrying the included block mapping", {
                        attempt,
                        reason: errorMessage(error)
                    })
            }
        );
        await host.advance({ number: BigInt(number), hash });
        this.reportedFirst();
    }
}
