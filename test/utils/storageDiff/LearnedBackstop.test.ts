import { LearnedBackstop } from "@/utils/storageDiff/LearnedBackstop";
import { expect } from "chai";

const CAP_MS = 3_000;
/** The learned bound is four times the slowest arrival in the last 30 s. */
const WINDOW_MS = 30_000;

/** A clock the test moves by hand, so the window needs no real waiting. */
function manualClock() {
    let now = 1_000_000;
    return {
        now: () => now,
        advance: (ms: number) => {
            now += ms;
        }
    };
}

describe("LearnedBackstop", function () {
    it("is the cap before any arrival was observed", function () {
        const backstop = new LearnedBackstop(CAP_MS, manualClock().now);

        expect(backstop.boundMs).to.equal(CAP_MS);
    });

    // Mutation: the multiple changed from 4 -> the bound is no longer 160.
    it("is a multiple of the slowest recent arrival once arrivals were observed", function () {
        const backstop = new LearnedBackstop(CAP_MS, manualClock().now);

        backstop.record(10);
        backstop.record(40);
        backstop.record(20);

        expect(backstop.boundMs).to.equal(160);
    });

    it("never exceeds the cap, however slow an arrival was", function () {
        const backstop = new LearnedBackstop(CAP_MS, manualClock().now);

        backstop.record(CAP_MS);

        expect(backstop.boundMs).to.equal(CAP_MS);
    });

    // Mutation: the window widened -> the 500 ms arrival is still remembered.
    it("forgets arrivals older than the window, and is the cap again once all are forgotten", function () {
        const clock = manualClock();
        const backstop = new LearnedBackstop(CAP_MS, clock.now);
        backstop.record(500);
        clock.advance(WINDOW_MS / 2);
        backstop.record(10);
        expect(backstop.boundMs).to.equal(2_000);

        clock.advance(WINDOW_MS / 2 + 1);
        expect(backstop.boundMs).to.equal(40);

        clock.advance(WINDOW_MS);
        expect(backstop.boundMs).to.equal(CAP_MS);
    });
});
