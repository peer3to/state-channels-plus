import { expect } from "chai";

import {
    createRecordingEventBarrier,
    createTestEventBarrier as createBarrier
} from "@test/fixtures/eventFixtures";

describe("EventBarrier (component)", function () {
    it("resolves on signal when the condition turns true", async function () {
        const barrier = createBarrier();
        let ready = false;
        const wait = barrier.waitFor(() => ready, { timeoutMs: 5000 });
        ready = true;
        await barrier.signal();
        await wait;
    });

    it("resolves promptly when the signal lands while the initial check is still in flight", async function () {
        const barrier = createBarrier();
        let ready = false;
        const startedAt = Date.now();
        // Registration happens BEFORE the first condition check, so a signal
        // arriving immediately after waitFor() — with no tick in between —
        // finds the waiter and resolves it. No deadline fallback involved.
        const wait = barrier.waitFor(() => ready, { timeoutMs: 5000 });
        ready = true;
        await barrier.signal();
        await wait;
        expect(Date.now() - startedAt).to.be.lessThan(1000);
    });

    it("rejects at the deadline when the condition hangs from the first check", async function () {
        const barrier = createBarrier();
        const startedAt = Date.now();
        let message = "";
        try {
            await barrier.waitFor(() => new Promise<boolean>(() => undefined), {
                timeoutMs: 100,
                timeoutMessage: "hung condition"
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        // The timer starts before the first evaluation, and the deadline
        // check is bounded — a hung condition cannot keep the wait pending.
        expect(message).to.contain("hung condition");
        expect(Date.now() - startedAt).to.be.lessThan(3000);
    });

    it("settles once with no late timeout log when the initial check resolves while the deadline check is pending", async function () {
        const { barrier, errorLogs } = createRecordingEventBarrier();
        // The INITIAL check resolves true at t=250 (after the t=100
        // deadline fired); the deadline's own bounded check stays pending
        // until its budget lapses. The shared settle guard must produce one
        // resolution and, critically, NO timeout/missing-signal side effects
        // afterwards — these assertions fail if the post-await settled
        // checks are removed.
        let conditionCalls = 0;
        await barrier.waitFor(
            () => {
                conditionCalls += 1;
                const delayMs = conditionCalls === 1 ? 250 : 60_000;
                return new Promise<boolean>((resolve) =>
                    setTimeout(() => resolve(true), delayMs)
                );
            },
            { timeoutMs: 100, timeoutMessage: "must not reject" }
        );
        // Wait out the deadline check's budget so its guarded continuation
        // has run before asserting silence.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(
            errorLogs.filter((message) => message.includes("timeout after"))
        ).to.deep.equal([]);
        expect(
            errorLogs.filter((message) => message.includes("no signal woke"))
        ).to.deep.equal([]);
    });

    it("rejects with the original timeout when the timeout message diagnostic hangs", async function () {
        const barrier = createBarrier();
        const startedAt = Date.now();
        let message = "";
        try {
            await barrier.waitFor(() => false, {
                timeoutMs: 100,
                timeoutMessageFn: () => new Promise<string>(() => undefined)
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain("EventBarrier timeout after 100ms");
        expect(Date.now() - startedAt).to.be.lessThan(3000);
    });

    it("rejects with the original timeout when the timeout meta diagnostic throws", async function () {
        const barrier = createBarrier();
        let message = "";
        try {
            await barrier.waitFor(() => false, {
                timeoutMs: 100,
                timeoutMessage: "meta threw",
                timeoutMetaFn: () => {
                    throw new Error("diagnostic failure");
                }
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain("meta threw");
    });

    it("rejects at the deadline when the condition returns false once and then hangs", async function () {
        const barrier = createBarrier();
        let calls = 0;
        let message = "";
        const startedAt = Date.now();
        try {
            await barrier.waitFor(
                () => {
                    calls += 1;
                    if (calls === 1) return false;
                    return new Promise<boolean>(() => undefined);
                },
                { timeoutMs: 100, timeoutMessage: "hung at deadline" }
            );
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain("hung at deadline");
        expect(Date.now() - startedAt).to.be.lessThan(3000);
    });

    it("resolves at the deadline when the condition turned true but no signal ever woke it", async function () {
        const barrier = createBarrier();
        let ready = false;
        // State changed without a signal (would indicate a state-change path
        // missing its notify). The final deadline check resolves instead of
        // failing the wait, and logs the anomaly.
        const wait = barrier.waitFor(() => ready, { timeoutMs: 150 });
        setTimeout(() => {
            ready = true;
            // deliberately NO signal()
        }, 50);
        await wait;
    });

    it("times out with the given message when the condition never turns true", async function () {
        const barrier = createBarrier();
        let message = "";
        try {
            await barrier.waitFor(() => false, {
                timeoutMs: 100,
                timeoutMessage: "never ready"
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain("never ready");
        // The barrier stays usable after a rejected wait.
        let ready = false;
        const wait = barrier.waitFor(() => ready, { timeoutMs: 1000 });
        await new Promise((resolve) => setImmediate(resolve));
        ready = true;
        await barrier.signal();
        await wait;
    });

    it("rejects the waiter when the condition throws (from signal or interval)", async function () {
        const barrier = createBarrier();
        const wait = barrier.waitFor(
            () => {
                throw new Error("boom");
            },
            { timeoutMs: 1000 }
        );
        await new Promise((resolve) => setImmediate(resolve));
        void barrier.signal();
        let message = "";
        try {
            await wait;
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain("boom");
    });
});
