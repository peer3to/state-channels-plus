import {
    BACKSTOP_MULTIPLE,
    BACKSTOP_WINDOW_MS,
    capLeavingNodeRoundTrips,
    LearnedBackstop,
    RecentSlowest
} from "@/utils/storageDiff/LearnedBackstop";
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

    it("follows a cap that moves, and never exceeds it", function () {
        let cap = CAP_MS;
        const backstop = new LearnedBackstop(() => cap, manualClock().now);
        expect(backstop.boundMs, "no arrival yet: the cap").to.equal(CAP_MS);
        backstop.record(500);
        expect(backstop.boundMs).to.equal(BACKSTOP_MULTIPLE * 500);

        cap = 800;
        expect(backstop.boundMs).to.equal(800);

        cap = 5_000;
        expect(backstop.boundMs).to.equal(BACKSTOP_MULTIPLE * 500);
    });
});

describe("capLeavingNodeRoundTrips", function () {
    it("is the whole deadline until a node round trip was observed", function () {
        const roundTrips = new RecentSlowest(manualClock().now);

        expect(capLeavingNodeRoundTrips(CAP_MS, roundTrips)).to.equal(CAP_MS);
    });

    it("is the deadline less a multiple of the slowest recent node round trip", function () {
        const roundTrips = new RecentSlowest(manualClock().now);

        roundTrips.record(50);
        roundTrips.record(120);
        roundTrips.record(80);

        expect(capLeavingNodeRoundTrips(CAP_MS, roundTrips)).to.equal(
            CAP_MS - BACKSTOP_MULTIPLE * 120
        );
    });

    it("shrinks as node round trips grow, and is never below zero", function () {
        const roundTrips = new RecentSlowest(manualClock().now);
        roundTrips.record(100);
        const fast = capLeavingNodeRoundTrips(CAP_MS, roundTrips);

        roundTrips.record(400);
        const slower = capLeavingNodeRoundTrips(CAP_MS, roundTrips);
        roundTrips.record(CAP_MS);
        const slowest = capLeavingNodeRoundTrips(CAP_MS, roundTrips);

        expect(slower).to.be.lessThan(fast);
        expect(slowest).to.equal(0);
    });

    it("is the whole deadline again once the round trips are older than the window", function () {
        const clock = manualClock();
        const roundTrips = new RecentSlowest(clock.now);
        roundTrips.record(400);
        expect(capLeavingNodeRoundTrips(CAP_MS, roundTrips)).to.be.lessThan(
            CAP_MS
        );

        clock.advance(BACKSTOP_WINDOW_MS + 1);

        expect(capLeavingNodeRoundTrips(CAP_MS, roundTrips)).to.equal(CAP_MS);
    });
});
