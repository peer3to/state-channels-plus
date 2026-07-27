import type { RelayerUrl } from "./HolepunchTypes";

export interface HolepunchRetryPolicyOptions {
    failoverJitterMaxMs: number;
    exhaustionBackoffBaseMs: number;
    exhaustionBackoffCapMs: number;
    teardownTimeoutMs: number;
    random: () => number;
}

export const DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS: Readonly<HolepunchRetryPolicyOptions> =
    Object.freeze({
        failoverJitterMaxMs: 250,
        exhaustionBackoffBaseMs: 1000,
        exhaustionBackoffCapMs: 30000,
        teardownTimeoutMs: 2000,
        random: Math.random
    });

export class HolepunchRetryPolicy {
    public readonly teardownTimeoutMs: number;
    private readonly options: Readonly<HolepunchRetryPolicyOptions>;
    private readonly maximumBackoffAttempt: number;

    public constructor(
        options: Readonly<HolepunchRetryPolicyOptions> = DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS
    ) {
        if (
            options.failoverJitterMaxMs < 0 ||
            options.exhaustionBackoffBaseMs <= 0 ||
            options.exhaustionBackoffCapMs < options.exhaustionBackoffBaseMs ||
            options.teardownTimeoutMs < 0
        ) {
            throw new Error("Invalid Holepunch retry policy options");
        }
        this.options = options;
        this.teardownTimeoutMs = options.teardownTimeoutMs;
        this.maximumBackoffAttempt = Math.max(
            0,
            Math.ceil(
                Math.log2(
                    options.exhaustionBackoffCapMs /
                        options.exhaustionBackoffBaseMs
                )
            )
        );
    }

    public selectRelayer(availableRelayers: readonly RelayerUrl[]): {
        relayerUrl?: RelayerUrl;
    } {
        if (availableRelayers.length === 0) {
            return {};
        }
        const index = Math.min(
            Math.floor(this.sample() * availableRelayers.length),
            availableRelayers.length - 1
        );
        return { relayerUrl: availableRelayers[index] };
    }

    public selectFailoverDelay(): { delayMs: number } {
        return {
            delayMs: this.sample() * this.options.failoverJitterMaxMs
        };
    }

    public selectExhaustionDelay(backoffAttempt: number): {
        delayMs: number;
        cappedBackoffMs: number;
        nextBackoffAttempt: number;
    } {
        const boundedAttempt = Math.min(
            Math.max(0, backoffAttempt),
            this.maximumBackoffAttempt
        );
        const cappedBackoffMs = Math.min(
            this.options.exhaustionBackoffBaseMs * 2 ** boundedAttempt,
            this.options.exhaustionBackoffCapMs
        );
        return {
            delayMs: this.sample() * cappedBackoffMs,
            cappedBackoffMs,
            nextBackoffAttempt:
                cappedBackoffMs === this.options.exhaustionBackoffCapMs
                    ? boundedAttempt
                    : boundedAttempt + 1
        };
    }

    private sample(): number {
        return Math.min(1, Math.max(0, this.options.random()));
    }
}
