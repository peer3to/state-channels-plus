import { expect } from "chai";

import {
    DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
    HolepunchRetryPolicy
} from "@/holepunch/HolepunchRetryPolicy";

describe("HolepunchRetryPolicy", function () {
    it("selects no relay from an empty pool and the only relay from a singleton", function () {
        const policy = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            random: () => 0.5
        });

        expect(policy.selectRelayer([])).to.deep.equal({});
        expect(policy.selectRelayer(["relay-a"])).to.deep.equal({
            relayerUrl: "relay-a"
        });
    });

    it("selects relay boundaries without indexing past the pool", function () {
        const relayers = ["relay-a", "relay-b", "relay-c"];
        const first = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            random: () => 0
        });
        const middle = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            random: () => 0.5
        });
        const last = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            random: () => 1
        });

        expect(first.selectRelayer(relayers).relayerUrl).to.equal("relay-a");
        expect(middle.selectRelayer(relayers).relayerUrl).to.equal("relay-b");
        expect(last.selectRelayer(relayers).relayerUrl).to.equal("relay-c");
    });

    it("returns failover delay boundaries from the injected random source", function () {
        for (const random of [0, 0.5, 1]) {
            const policy = new HolepunchRetryPolicy({
                ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
                random: () => random
            });
            expect(policy.selectFailoverDelay().delayMs).to.equal(
                DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.failoverJitterMaxMs *
                    random
            );
        }
    });

    it("doubles exhaustion backoff to the cap and stops growing the attempt", function () {
        const policy = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            random: () => 1
        });
        let attempt = 0;

        for (let index = 0; index < 8; index++) {
            const result = policy.selectExhaustionDelay(attempt);
            const expectedCap = Math.min(
                DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.exhaustionBackoffBaseMs *
                    2 ** attempt,
                DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.exhaustionBackoffCapMs
            );
            expect(result.cappedBackoffMs).to.equal(expectedCap);
            expect(result.delayMs).to.equal(expectedCap);
            attempt = result.nextBackoffAttempt;
        }

        const saturated = policy.selectExhaustionDelay(attempt);
        expect(saturated.cappedBackoffMs).to.equal(
            DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.exhaustionBackoffCapMs
        );
        expect(saturated.nextBackoffAttempt).to.equal(attempt);
        expect(policy.selectExhaustionDelay(0).cappedBackoffMs).to.equal(
            DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.exhaustionBackoffBaseMs
        );
    });

    it("uses an injected teardown bound", function () {
        const teardownTimeoutMs = 17;
        const policy = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            teardownTimeoutMs
        });

        expect(policy.teardownTimeoutMs).to.equal(teardownTimeoutMs);
        expect(new HolepunchRetryPolicy().teardownTimeoutMs).to.equal(
            DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.teardownTimeoutMs
        );
    });

    it("rejects invalid timing ranges", function () {
        expect(
            () =>
                new HolepunchRetryPolicy({
                    ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
                    teardownTimeoutMs: -1
                })
        ).to.throw("Invalid Holepunch retry policy options");
        expect(
            () =>
                new HolepunchRetryPolicy({
                    ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
                    exhaustionBackoffCapMs: 1
                })
        ).to.throw("Invalid Holepunch retry policy options");
    });
});
