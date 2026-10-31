import {
    BACKSTOP_MULTIPLE,
    BACKSTOP_WINDOW_MS,
    LearnedBackstop
} from "@/utils/storageDiff/LearnedBackstop";
import { expect } from "chai";

const CAP_MS = 3_000;

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

    it("is a multiple of the slowest recent arrival once arrivals were observed", function () {
        const backstop = new LearnedBackstop(CAP_MS, manualClock().now);

        backstop.record(10);
        backstop.record(40);
        backstop.record(20);

        expect(backstop.boundMs).to.equal(BACKSTOP_MULTIPLE * 40);
    });

    it("never exceeds the cap, however slow an arrival was", function () {
        const backstop = new LearnedBackstop(CAP_MS, manualClock().now);

        backstop.record(CAP_MS);

        expect(backstop.boundMs).to.equal(CAP_MS);
    });

    it("forgets arrivals older than the window, and is the cap again once all are forgotten", function () {
        const clock = manualClock();
        const backstop = new LearnedBackstop(CAP_MS, clock.now);
        backstop.record(500);
        clock.advance(BACKSTOP_WINDOW_MS / 2);
        backstop.record(10);
        expect(backstop.boundMs).to.equal(BACKSTOP_MULTIPLE * 500);

        clock.advance(BACKSTOP_WINDOW_MS / 2 + 1);
        expect(backstop.boundMs).to.equal(BACKSTOP_MULTIPLE * 10);

        clock.advance(BACKSTOP_WINDOW_MS);
        expect(backstop.boundMs).to.equal(CAP_MS);
    });
});
