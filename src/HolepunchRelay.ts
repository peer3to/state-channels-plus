//@ts-ignore
import Hyperswarm from "hyperswarm";
//@ts-ignore
import DHT from "@hyperswarm/dht-relay";
//@ts-ignore
import Stream from "@hyperswarm/dht-relay/ws";
import { Logger } from "@/utils";
// Base/cap for exponential backoff applied when a full round of relayers
// has just been exhausted (all configured relayers failed since the last
// success), so a fully-down network doesn't tight-loop hammering reconnects.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;
// Upper bound for the randomized delay before retrying after a single
// relayer failure, so many clients failing over at the same instant don't
// all pile onto the next relayer at once (thundering herd).
const FAILOVER_JITTER_MAX_MS = 250;

class HolepunchRelay {
    relayerUrls: string[];
    updateCallback: Function;
    swarm: any;
    logger: Logger;

    // Relayers that failed since the last successful connection. Never
    // mutates relayerUrls - this is purely an exclusion filter that gets
    // reset once every configured relayer has failed (retry the pool) or
    // once a connection succeeds.
    private excludedRelayers: Set<string> = new Set();
    // Number of consecutive full-round exhaustions (every relayer excluded)
    // since the last successful connection. Drives the backoff delay.
    private backoffAttempt = 0;

    private static instance: HolepunchRelay;

    public static init(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ) {
        HolepunchRelay.instance = new HolepunchRelay(
            relayerUrls,
            updateCallback,
            logger
        );
        HolepunchRelay.instance.connectToRelayer();
    }
    public static getInstance(): HolepunchRelay {
        if (!HolepunchRelay.instance)
            throw new Error("HolepunchRelay not initialized");
        return HolepunchRelay.instance;
    }
    public getSwarm(): any {
        return this.swarm;
    }

    private connectToRelayer(): void {
        if (this.relayerUrls.length === 0) {
            this.logger.warn("No holepunch relayers configured");
            return;
        }

        if (this.isRelayerPoolExhausted()) {
            this.scheduleRetryAfterExhaustion();
            return;
        }

        const relayerUrl = this.pickRandomRelayer();
        this.logger.info("Connecting to holepunch relayer", {
            relayerUrl
        });
        if (!relayerUrl) return;
        try {
            const ws = new WebSocket(relayerUrl);
            const dht = new DHT(new Stream(true, ws));
            this.swarm = new Hyperswarm({
                dht: dht
            });
            ws.onopen = () => {
                this.logger.info("Holepunch relayer connected", {
                    relayerUrl
                });
                this.excludedRelayers.clear();
                this.backoffAttempt = 0;
            };
            ws.onclose = () => {
                this.logger.warn("Holepunch relayer disconnected", {
                    relayerUrl
                });
                this.excludeAndConnectToRelayer(relayerUrl);
            };
            ws.onerror = (error) => {
                this.logger.warn("Holepunch relayer error", {
                    relayerUrl,
                    error
                });
                this.excludeAndConnectToRelayer(relayerUrl);
            };

            this.updateCallback();
        } catch (e) {
            this.logger.error("Failed to connect to holepunch relayer", {
                relayerUrl,
                error: e
            });
            this.excludeAndConnectToRelayer(relayerUrl);
        }
    }

    private constructor(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ) {
        this.relayerUrls = relayerUrls;
        this.updateCallback = updateCallback;
        this.logger = logger.child({ component: "HolepunchRelay" });
    }

    private pickRandomRelayer(): string | undefined {
        const available = this.relayerUrls.filter(
            (url) => !this.excludedRelayers.has(url)
        );
        if (available.length === 0) return undefined;
        const index = Math.floor(Math.random() * available.length);
        return available[index];
    }

    // True once every configured relayer has failed since the last success
    // (or since the last reset). Never true when relayerUrls is empty.
    private isRelayerPoolExhausted(): boolean {
        return (
            this.relayerUrls.length > 0 &&
            this.relayerUrls.every((url) => this.excludedRelayers.has(url))
        );
    }

    private scheduleRetryAfterExhaustion(): void {
        // Full jitter (AWS-style): pick uniformly in [0, cappedBackoff] rather
        // than retrying at the deterministic cappedBackoff mark, so clients
        // that exhaust the pool at the same moment don't retry in lockstep.
        const cappedBackoffMs = Math.min(
            BACKOFF_BASE_MS * 2 ** this.backoffAttempt,
            BACKOFF_CAP_MS
        );
        const delayMs = Math.random() * cappedBackoffMs;
        this.backoffAttempt++;
        this.logger.warn(
            "All holepunch relayers failed, retrying pool after backoff",
            { delayMs, cappedBackoffMs, relayerUrls: this.relayerUrls }
        );
        this.excludedRelayers.clear();
        setTimeout(() => this.connectToRelayer(), delayMs);
    }

    private excludeAndConnectToRelayer(relayerUrl: string): void {
        this.excludedRelayers.add(relayerUrl);
        this.logger.debug("Excluded holepunch relayer after failure", {
            excluded: relayerUrl,
            excludedCount: this.excludedRelayers.size,
            total: this.relayerUrls.length
        });
        // Branch immediately so a pool-exhausting failure schedules only the
        // exhaustion backoff, never the failover jitter as well - one timer
        // owner per failure, not two stacked delays.
        if (this.isRelayerPoolExhausted()) {
            this.scheduleRetryAfterExhaustion();
            return;
        }
        // Randomized delay so many clients failing over off the same
        // relayer at once don't all hit the next relayer simultaneously.
        const delayMs = Math.random() * FAILOVER_JITTER_MAX_MS;
        setTimeout(() => this.connectToRelayer(), delayMs);
    }
}

export default HolepunchRelay;
