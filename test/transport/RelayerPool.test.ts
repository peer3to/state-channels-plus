import { expect } from "chai";
import { createLogger } from "@/utils";
import { RelayerPool } from "@/transport/relay/RelayerPool";

// Records every scheduled call instead of running it - RelayerPool.next()/
// isExhausted must never depend on a timer actually firing, and callers that
// care about the delay (backoff/failover jitter) assert on the recorded ms.
// This is an injected factory, not a mock: test/AGENTS.md's "no mocks" rule
// targets stubbed collaborators, not a deterministic scheduler/RNG seam the
// spec explicitly calls for.
function createRecordingSchedule() {
    const calls: { fn: () => void; ms: number }[] = [];
    return {
        schedule: (fn: () => void, ms: number) => {
            calls.push({ fn, ms });
        },
        calls
    };
}

// Deterministic RNG stand-in: returns each queued value once, then repeats
// the last value for any further calls.
function createSequenceRandom(values: number[]) {
    let index = 0;
    return () => {
        const value = values[Math.min(index, values.length - 1)];
        index++;
        return value;
    };
}

function createTestLogger() {
    return createLogger({}, {}, { level: "error" });
}

describe("RelayerPool", () => {
    it("never returns an excluded url from a random selection", () => {
        const urls = [
            "wss://relay-a.example",
            "wss://relay-b.example",
            "wss://relay-c.example"
        ];
        const { schedule } = createRecordingSchedule();
        // Sweep the full [0, 1) range next() draws from, so this covers
        // every index into the filtered "available" array, not just one.
        const random = createSequenceRandom([0, 0.33, 0.5, 0.66, 0.99]);
        const pool = new RelayerPool({
            urls,
            logger: createTestLogger(),
            schedule,
            random
        });

        pool.onFailure(urls[1], () => undefined);

        for (let i = 0; i < 5; i++) {
            expect(pool.next()).to.not.equal(urls[1]);
        }
    });

    it("is non-destructive: an excluded url returns after onSuccess resets it", () => {
        const urls = ["wss://relay-a.example", "wss://relay-b.example"];
        const { schedule, calls } = createRecordingSchedule();
        const random = createSequenceRandom([0]);
        const pool = new RelayerPool({
            urls,
            logger: createTestLogger(),
            schedule,
            random
        });

        // onFailure schedules a (still-pending) retry - onSuccess arrives
        // before it fires, e.g. a fresh connection opens off a retry that
        // was scheduled for a different, earlier attempt.
        pool.onFailure(urls[0], () => undefined);
        expect(pool.next()).to.equal(urls[1]);
        expect(calls).to.have.length(1);

        pool.onSuccess();
        // random() always draws index 0 - with the exclusion cleared, the
        // first url in the list is reachable again.
        expect(pool.next()).to.equal(urls[0]);

        // The pool must not be wedged by the retry that was still pending
        // when onSuccess landed - a subsequent failure schedules normally.
        pool.onFailure(urls[0], () => undefined);
        expect(calls).to.have.length(2);
    });

    it("resets the exclusion set and schedules with full jitter on exhaustion", () => {
        const urls = ["wss://only-relay.example"];
        const { schedule, calls } = createRecordingSchedule();
        // First call: failover-jitter draw is skipped (exhaustion branches
        // before it). Second call: the full-jitter draw for the backoff.
        const random = createSequenceRandom([0.5]);
        const pool = new RelayerPool({
            urls,
            logger: createTestLogger(),
            schedule,
            random
        });

        let retried = false;
        pool.onFailure(urls[0], () => {
            retried = true;
        });

        // cappedBackoffMs = min(1000 * 2^0, 30000) = 1000; delay = 0.5 * 1000.
        expect(calls).to.have.length(1);
        expect(calls[0].ms).to.equal(500);

        // Exhaustion resets the exclusion set immediately (not just after
        // the scheduled retry fires).
        expect(pool.next()).to.equal(urls[0]);

        // The scheduled call is a wrapper (it also clears the pending-retry
        // flag before invoking the caller's retry) - firing it must still
        // reach the caller's retry.
        calls[0].fn();
        expect(retried).to.equal(true);
    });

    it("increments backoffAttempt per exhaustion and resets it on onSuccess", () => {
        const urls = ["wss://only-relay.example"];
        const { schedule, calls } = createRecordingSchedule();
        const random = createSequenceRandom([1]);
        const pool = new RelayerPool({
            urls,
            logger: createTestLogger(),
            schedule,
            random
        });

        pool.onFailure(urls[0], () => undefined);
        // Attempt 0: cappedBackoffMs = min(1000 * 2^0, 30000) = 1000.
        expect(calls[0].ms).to.equal(1000);
        // Fire the scheduled retry (as the real retry eventually would) so
        // the next failure is a fresh one, not a same-url double-fire.
        calls[0].fn();

        pool.onFailure(urls[0], () => undefined);
        // Attempt 1: cappedBackoffMs = min(1000 * 2^1, 30000) = 2000.
        expect(calls[1].ms).to.equal(2000);
        calls[1].fn();

        pool.onSuccess();
        pool.onFailure(urls[0], () => undefined);
        // Reset by onSuccess - back to attempt 0's 1000ms cap.
        expect(calls[2].ms).to.equal(1000);
    });

    it("does not double-schedule a retry or double-increment backoff when a socket fires two failures for the same exhausting url before the retry runs", () => {
        const urls = ["wss://only-relay.example"];
        const { schedule, calls } = createRecordingSchedule();
        const random = createSequenceRandom([0.5]);
        const pool = new RelayerPool({
            urls,
            logger: createTestLogger(),
            schedule,
            random
        });

        // Simulates a WebSocket firing both "error" and "close" for one
        // failure - both handlers call onFailure for the same url before any
        // scheduled timer has fired.
        pool.onFailure(urls[0], () => undefined);
        pool.onFailure(urls[0], () => undefined);

        expect(calls).to.have.length(1);
        // Attempt 0: cappedBackoffMs = min(1000 * 2^0, 30000) = 1000.
        expect(calls[0].ms).to.equal(500);

        // Firing the retry and failing again must land on attempt 1's
        // 2000ms cap (500 = 0.5 * 1000), not attempt 2's 4000ms cap - proving
        // backoffAttempt was only incremented once by the two near-
        // simultaneous failures above.
        calls[0].fn();
        pool.onFailure(urls[0], () => undefined);
        expect(calls).to.have.length(2);
        expect(calls[1].ms).to.equal(1000);
    });

    it("never reports exhausted and never schedules for an empty url list", () => {
        const { schedule, calls } = createRecordingSchedule();
        const pool = new RelayerPool({
            urls: [],
            logger: createTestLogger(),
            schedule,
            random: createSequenceRandom([0])
        });

        expect(pool.isExhausted).to.equal(false);
        expect(pool.next()).to.equal(undefined);
        expect(calls).to.have.length(0);
    });

    it("does not double-schedule a timer for a url that is already excluded", () => {
        const urls = ["wss://relay-a.example", "wss://relay-b.example"];
        const { schedule, calls } = createRecordingSchedule();
        const random = createSequenceRandom([0.1]);
        const pool = new RelayerPool({
            urls,
            logger: createTestLogger(),
            schedule,
            random
        });

        pool.onFailure(urls[0], () => undefined);
        expect(calls).to.have.length(1);

        // Same url fails again (e.g. a socket firing both "error" and
        // "close") while its retry is still pending - must not schedule a
        // second timer.
        pool.onFailure(urls[0], () => undefined);
        expect(calls).to.have.length(1);
    });
});
