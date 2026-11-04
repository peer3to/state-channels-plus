import {
    AnnouncedBlocks,
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
        expect(backstop.boundMs).to.equal(2_000);

        cap = 800;
        expect(backstop.boundMs).to.equal(800);

        cap = 5_000;
        expect(backstop.boundMs).to.equal(2_000);
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

        expect(capLeavingNodeRoundTrips(CAP_MS, roundTrips)).to.equal(2_520);
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

        clock.advance(WINDOW_MS + 1);

        expect(capLeavingNodeRoundTrips(CAP_MS, roundTrips)).to.equal(CAP_MS);
    });
});

describe("AnnouncedBlocks", function () {
    it("forgets announcements older than the window when another block is announced", function () {
        const clock = manualClock();
        const announced = new AnnouncedBlocks(clock.now);
        for (let number = 1n; number <= 5n; number++)
            announced.announce(number);
        expect(announced.size).to.equal(5);

        clock.advance(WINDOW_MS + 1);
        announced.announce(6n);

        expect(announced.size).to.equal(1);
    });

    it("keeps announcements inside the window", function () {
        const clock = manualClock();
        const announced = new AnnouncedBlocks(clock.now);
        announced.announce(1n);

        clock.advance(WINDOW_MS - 1);
        announced.announce(2n);

        expect(announced.size).to.equal(2);
    });

    it("forgets every announcement on clear", function () {
        const announced = new AnnouncedBlocks(manualClock().now);
        announced.announce(1n);
        announced.announce(2n);

        announced.clear();

        expect(announced.size).to.equal(0);
    });

    it("hands over how long each announced block up to the arrived one took, and keeps later ones", function () {
        const clock = manualClock();
        const announced = new AnnouncedBlocks(clock.now);
        announced.announce(1n);
        clock.advance(40);
        announced.announce(2n);
        announced.announce(3n);
        clock.advance(10);

        const durations = announced.arrivedUpTo(2n);

        expect(durations.sort()).to.deep.equal([10, 50]);
        expect(announced.size).to.equal(1);
    });

    // Mutation: forgetFrom keeps the orphaned height -> the block announced
    // again there is timed from the orphan's announcement.
    it("forgets the announcements from an orphaned height up, and times the block announced again there from its own announcement", function () {
        const clock = manualClock();
        const announced = new AnnouncedBlocks(clock.now);
        announced.announce(10n);
        announced.announce(11n);
        announced.announce(13n);
        clock.advance(5_000);

        announced.forgetFrom(11n);
        announced.announce(11n);
        clock.advance(100);

        expect(announced.arrivedUpTo(13n).sort()).to.deep.equal([100, 5_100]);
        expect(announced.size).to.equal(0);
    });

    it("does not hand over an announcement older than the window", function () {
        const clock = manualClock();
        const announced = new AnnouncedBlocks(clock.now);
        announced.announce(1n);
        clock.advance(WINDOW_MS + 1);

        expect(announced.arrivedUpTo(1n)).to.deep.equal([]);
    });
});
