import { retry } from "@/utils/retry";
import { deferred } from "@test/utils/deferred";
import { expect } from "chai";

describe("retry", function () {
    it("an abort during the retry delay rejects at once with the last error, after one attempt", async function () {
        const failure = new Error("attempt failed");
        const controller = new AbortController();
        const inDelay = deferred();
        let attempts = 0;

        const result = retry(
            async () => {
                attempts++;
                throw failure;
            },
            {
                maxRetries: 3,
                // Far above the assertion: only the abort ends the delay in time.
                delayMs: 5_000,
                signal: controller.signal,
                // Runs just before the delay starts.
                onRetry: () => inDelay.resolve()
            }
        );
        await inDelay.promise;
        const abortedAtMs = Date.now();

        controller.abort();

        let rejection: unknown;
        try {
            await result;
        } catch (error) {
            rejection = error;
        }
        expect(rejection).to.equal(failure);
        expect(Date.now() - abortedAtMs).to.be.below(1_000);
        expect(attempts).to.equal(1);
    });

    it("an error shouldRetry refuses rejects at once, after one attempt", async function () {
        const permanent = new Error("permanent failure");
        let attempts = 0;

        let rejection: unknown;
        try {
            await retry(
                async () => {
                    attempts++;
                    throw permanent;
                },
                {
                    maxRetries: 3,
                    shouldRetry: (error) => error !== permanent
                }
            );
        } catch (error) {
            rejection = error;
        }

        expect(rejection).to.equal(permanent);
        expect(attempts).to.equal(1);
    });

    it("an error shouldRetry accepts is retried until an attempt succeeds", async function () {
        let attempts = 0;

        const result = await retry(
            async () => {
                attempts++;
                if (attempts < 3) throw new Error("transient failure");
                return "done";
            },
            { maxRetries: 3, shouldRetry: () => true }
        );

        expect(result).to.equal("done");
        expect(attempts).to.equal(3);
    });
});
