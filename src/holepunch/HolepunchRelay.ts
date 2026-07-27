import type { Logger } from "@/utils";
import { RetryLifecycle, type RetryAttemptToken } from "@/utils/RetryLifecycle";

import {
    HolepunchRetryPolicy,
    type HolepunchRetryPolicyOptions
} from "./HolepunchRetryPolicy";
import type {
    HolepunchRelayConnectionFactory,
    HolepunchRelayResources,
    HolepunchSwarmUpdate,
    RelayerUrl
} from "./HolepunchTypes";

interface ActiveRelayResources {
    resources: HolepunchRelayResources;
    relayerUrl: RelayerUrl;
    attemptToken: RetryAttemptToken;
    teardownPromise?: Promise<void>;
}

export class HolepunchRelay {
    private readonly relayerUrls: readonly RelayerUrl[];
    private readonly updateCallback: HolepunchSwarmUpdate;
    private readonly connectionFactory: HolepunchRelayConnectionFactory;
    private readonly retryPolicy: HolepunchRetryPolicy;
    private readonly retryLifecycle = new RetryLifecycle();
    private readonly logger: Logger;
    // Relayers that failed since the last successful connection. Never
    // mutates relayerUrls - this is purely an exclusion filter that gets
    // reset once every configured relayer has failed (retry the pool) or
    // once a connection succeeds.
    private readonly excludedRelayers = new Set<RelayerUrl>();
    // Number of consecutive full-round exhaustions (every relayer excluded)
    // since the last successful connection. Drives the backoff delay.
    private backoffAttempt = 0;
    private active?: ActiveRelayResources;
    private teardownChain: Promise<void> = Promise.resolve();
    private started = false;
    private disposed = false;
    private disposalPromise?: Promise<void>;

    public constructor(
        relayerUrls: readonly RelayerUrl[],
        updateCallback: HolepunchSwarmUpdate,
        connectionFactory: HolepunchRelayConnectionFactory,
        logger: Logger,
        retryPolicy = new HolepunchRetryPolicy()
    ) {
        this.relayerUrls = [...relayerUrls];
        this.updateCallback = updateCallback;
        this.connectionFactory = connectionFactory;
        this.retryPolicy = retryPolicy;
        this.logger = logger.child({ component: "HolepunchRelay" });
    }

    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        this.connectToRelayer();
    }

    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.disposed = true;
        this.retryLifecycle.dispose();
        const active = this.active;
        this.disposalPromise = (async () => {
            if (active) {
                await this.queueTeardown(active);
            }
            await this.teardownChain;
        })();
        return this.disposalPromise;
    }

    private connectToRelayer(): void {
        if (this.disposed) {
            return;
        }
        if (this.relayerUrls.length === 0) {
            this.logger.warn("No holepunch relayers configured");
            return;
        }

        const availableRelayers = this.relayerUrls.filter(
            (url) => !this.excludedRelayers.has(url)
        );
        const { relayerUrl } =
            this.retryPolicy.selectRelayer(availableRelayers);
        if (!relayerUrl) {
            return;
        }

        const attemptToken = this.retryLifecycle.beginAttempt();
        this.logger.info("Connecting to holepunch relayer", {
            relayerUrl,
            attempt: attemptToken.attempt,
            generation: attemptToken.generation
        });

        let resources: HolepunchRelayResources;
        try {
            resources = this.connectionFactory.create(relayerUrl);
        } catch (error) {
            this.logger.error("Failed to connect to holepunch relayer", {
                relayerUrl,
                error
            });
            this.failAttempt(attemptToken, relayerUrl);
            return;
        }

        const active: ActiveRelayResources = {
            resources,
            relayerUrl,
            attemptToken
        };
        this.active = active;
        active.resources.socket.setHandlers({
            open: () => this.handleOpen(active),
            close: () => {
                this.logger.warn("Holepunch relayer disconnected", {
                    relayerUrl
                });
                this.failAttempt(attemptToken, relayerUrl, active);
            },
            error: (error) => {
                this.logger.warn("Holepunch relayer error", {
                    relayerUrl,
                    error:
                        error instanceof Error ? error.message : String(error)
                });
                this.failAttempt(attemptToken, relayerUrl, active);
            }
        });
    }

    private handleOpen(active: ActiveRelayResources): void {
        const { attemptToken, relayerUrl } = active;
        if (
            this.disposed ||
            !attemptToken.isCurrent() ||
            attemptToken.failed ||
            this.active !== active
        ) {
            active.resources.socket.clearHandlers();
            active.resources.socket.close();
            return;
        }

        this.retryLifecycle.cancelRetry(attemptToken);
        this.excludedRelayers.clear();
        this.backoffAttempt = 0;
        this.logger.info("Holepunch relayer connected", {
            relayerUrl
        });
        this.updateCallback(active.resources.swarm);
    }

    private failAttempt(
        attemptToken: RetryAttemptToken,
        relayerUrl: RelayerUrl,
        active?: ActiveRelayResources
    ): void {
        attemptToken.failOnce(() => {
            active?.resources.socket.clearHandlers();
            this.excludedRelayers.add(relayerUrl);
            this.logger.debug("Excluded holepunch relayer after failure", {
                excluded: relayerUrl,
                excludedCount: this.excludedRelayers.size,
                total: this.relayerUrls.length
            });

            if (this.isRelayerPoolExhausted()) {
                this.scheduleRetryAfterExhaustion(attemptToken, active);
                return;
            }

            // Randomized delay so many clients failing over off the same
            // relayer at once don't all hit the next relayer simultaneously.
            const { delayMs } = this.retryPolicy.selectFailoverDelay();
            this.scheduleRetry(attemptToken, active, delayMs);
        });
    }

    // True once every configured relayer has failed since the last success
    // (or since the last reset). Never true when relayerUrls is empty.
    private isRelayerPoolExhausted(): boolean {
        return (
            this.relayerUrls.length > 0 &&
            this.relayerUrls.every((url) => this.excludedRelayers.has(url))
        );
    }

    private scheduleRetryAfterExhaustion(
        attemptToken: RetryAttemptToken,
        active?: ActiveRelayResources
    ): void {
        // Full jitter (AWS-style): pick uniformly in [0, cappedBackoff] rather
        // than retrying at the deterministic cappedBackoff mark, so clients
        // that exhaust the pool at the same moment don't retry in lockstep.
        const { delayMs, cappedBackoffMs, nextBackoffAttempt } =
            this.retryPolicy.selectExhaustionDelay(this.backoffAttempt);
        this.backoffAttempt = nextBackoffAttempt;
        this.logger.warn(
            "All holepunch relayers failed, retrying pool after backoff",
            { delayMs, cappedBackoffMs, relayerUrls: this.relayerUrls }
        );
        this.excludedRelayers.clear();
        this.scheduleRetry(attemptToken, active, delayMs);
    }

    private scheduleRetry(
        attemptToken: RetryAttemptToken,
        active: ActiveRelayResources | undefined,
        delayMs: number
    ): void {
        this.retryLifecycle.scheduleRetry(
            attemptToken,
            () => {
                void this.retryAfterTeardown(attemptToken, active);
            },
            delayMs
        );
    }

    private async retryAfterTeardown(
        attemptToken: RetryAttemptToken,
        active?: ActiveRelayResources
    ): Promise<void> {
        if (active) {
            await this.queueTeardown(active);
        }
        if (!attemptToken.isCurrent() || this.disposed) {
            return;
        }
        this.connectToRelayer();
    }

    private queueTeardown(active: ActiveRelayResources): Promise<void> {
        if (active.teardownPromise) {
            return active.teardownPromise;
        }

        active.teardownPromise = this.teardownChain.then(() =>
            this.teardownResources(active)
        );
        this.teardownChain = active.teardownPromise.catch(() => undefined);
        return active.teardownPromise;
    }

    private async teardownResources(
        active: ActiveRelayResources
    ): Promise<void> {
        active.resources.socket.clearHandlers();
        const startedAt = Date.now();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const destroyPromise = Promise.resolve()
            .then(() => active.resources.destroy())
            .then(
                () => "destroyed" as const,
                (error) => {
                    this.logger.warn(
                        "Holepunch relay resource teardown failed",
                        {
                            relayerUrl: active.relayerUrl,
                            generation: active.attemptToken.generation,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        }
                    );
                    return "destroyed" as const;
                }
            );
        const timeoutPromise = new Promise<"timeout">((resolve) => {
            timeout = setTimeout(
                () => resolve("timeout"),
                this.retryPolicy.teardownTimeoutMs
            );
        });
        const result = await Promise.race([destroyPromise, timeoutPromise]);
        if (timeout) {
            clearTimeout(timeout);
        }

        const durationMs = Date.now() - startedAt;
        if (result === "timeout") {
            try {
                active.resources.socket.close();
            } catch {
                // ignore
            }
            this.logger.warn("Holepunch relay resource teardown timed out", {
                relayerUrl: active.relayerUrl,
                generation: active.attemptToken.generation,
                durationMs
            });
        } else {
            this.logger.debug("Holepunch relay resources destroyed", {
                relayerUrl: active.relayerUrl,
                generation: active.attemptToken.generation,
                durationMs
            });
        }

        if (this.active === active) {
            this.active = undefined;
        }
    }
}

export type { HolepunchRetryPolicyOptions };
