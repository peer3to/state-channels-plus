import { expect } from "chai";

const {
    availableMemGb,
    nextAdaptiveCap,
    pickLeastLoadedSlot,
    evaluateAdmission
} = require("../../scripts/e2e-parallel/adaptiveScheduling.js") as {
    availableMemGb: () => number;
    nextAdaptiveCap: (params: {
        current: number;
        starved: boolean;
        elDelayMs: number;
        hasTiming: boolean;
        healthyStreak?: number;
        goodCap?: number;
        badCap?: number;
        maxCap: number;
    }) => {
        cap: number;
        healthyStreak: number;
        goodCap: number;
        badCap: number;
    };
    pickLeastLoadedSlot: (slotLoad: number[]) => number;
    evaluateAdmission: (params: Record<string, unknown>) => {
        admit: boolean;
        reason: string | null;
    };
};

const healthy = {
    starved: false,
    elDelayMs: 100,
    hasTiming: true,
    maxCap: 40
};

// A baseline where every gate is open, so each test can close exactly one.
const openGates = {
    running: 1,
    concurrencyCap: 4,
    cpuUtil: 0.2,
    targetLoad: 0.8,
    occupiedGb: 2,
    avgPerTestGb: 1,
    memBoundGb: 20,
    availGb: 10,
    memFloorGb: 3
};

describe("parallel scheduler — machine-aware sizing", function () {
    describe("nextAdaptiveCap", function () {
        // a level is promoted only after two healthy finishes
        const confirm = { ...healthy, healthyStreak: 1 };

        function converge(realLimit: number, steps = 60) {
            let s = { cap: 2, healthyStreak: 0, goodCap: 1, badCap: Infinity };
            const trace: number[] = [];
            for (let i = 0; i < steps; i++) {
                const starved = s.cap > realLimit;
                s = nextAdaptiveCap({
                    ...healthy,
                    ...s,
                    current: s.cap,
                    starved,
                    elDelayMs: starved ? 900 : 100
                });
                trace.push(s.cap);
            }
            return { cap: s.cap, trace };
        }

        it("doubles while nothing has starved yet", function () {
            expect(nextAdaptiveCap({ ...confirm, current: 2 }).cap).to.equal(4);
            expect(nextAdaptiveCap({ ...confirm, current: 8 }).cap).to.equal(
                16
            );
        });

        it("needs two healthy finishes before moving up", function () {
            const first = nextAdaptiveCap({
                ...healthy,
                current: 8,
                healthyStreak: 0
            });
            expect(first.cap).to.equal(8);
            expect(
                nextAdaptiveCap({
                    ...healthy,
                    current: 8,
                    healthyStreak: first.healthyStreak
                }).cap
            ).to.equal(16);
        });

        it("bisects between the good level and the starved one", function () {
            const out = nextAdaptiveCap({
                ...healthy,
                current: 8,
                starved: true,
                goodCap: 4
            });
            expect(out.cap).to.equal(6);
            expect(out.badCap).to.equal(8);
        });

        it("keeps bisecting down while the probe still starves", function () {
            expect(
                nextAdaptiveCap({
                    ...healthy,
                    current: 6,
                    starved: true,
                    goodCap: 4,
                    badCap: 8
                }).cap
            ).to.equal(5);
            expect(
                nextAdaptiveCap({
                    ...healthy,
                    current: 5,
                    starved: true,
                    goodCap: 4,
                    badCap: 6
                }).cap
            ).to.equal(4);
        });

        it("probes upward again when the midpoint is healthy", function () {
            expect(
                nextAdaptiveCap({
                    ...confirm,
                    current: 6,
                    goodCap: 4,
                    badCap: 8
                }).cap
            ).to.equal(7);
        });

        it("stops once the bounds are adjacent", function () {
            expect(
                nextAdaptiveCap({
                    ...confirm,
                    current: 3,
                    goodCap: 3,
                    badCap: 4
                }).cap
            ).to.equal(3);
        });

        it("never exceeds the ceiling or drops below 1", function () {
            expect(
                nextAdaptiveCap({ ...confirm, current: 30, maxCap: 40 }).cap
            ).to.equal(40);
            expect(
                nextAdaptiveCap({ ...healthy, current: 1, starved: true }).cap
            ).to.equal(1);
        });

        it("holds steady on a middling event loop or missing timing", function () {
            expect(
                nextAdaptiveCap({ ...confirm, current: 8, elDelayMs: 500 }).cap
            ).to.equal(8);
            expect(
                nextAdaptiveCap({ ...confirm, current: 8, hasTiming: false })
                    .cap
            ).to.equal(8);
        });

        // #400 review: a 12-core box that comfortably runs 13 must not be pinned
        // to 3 while its cpu sits at 20%
        it("finds a roomy machine's real limit", function () {
            expect(converge(13).cap).to.equal(13);
        });

        it("settles on a constrained machine and stops moving", function () {
            const { cap, trace } = converge(3);
            expect(cap).to.equal(3);
            expect(new Set(trace.slice(-20)).size).to.equal(1);
        });

        it("converges after only a few starved probes", function () {
            const { trace } = converge(8);
            expect(trace.filter((c) => c > 8).length).to.be.lessThan(6);
        });
    });

    describe("availableMemGb", function () {
        it("returns a positive finite number", function () {
            const gb = availableMemGb();
            expect(gb).to.be.a("number");
            expect(gb).to.be.greaterThan(0);
            expect(Number.isFinite(gb)).to.equal(true);
        });
    });

    describe("pickLeastLoadedSlot", function () {
        it("prefers an idle slot over a busy one", function () {
            expect(pickLeastLoadedSlot([1, 0, 1])).to.equal(1);
            expect(pickLeastLoadedSlot([2, 2, 0])).to.equal(2);
        });

        it("falls back to the least-loaded slot when all are busy", function () {
            expect(pickLeastLoadedSlot([3, 1, 2])).to.equal(1);
        });

        it("degenerates cleanly to the single shared slot", function () {
            expect(pickLeastLoadedSlot([0])).to.equal(0);
            expect(pickLeastLoadedSlot([7])).to.equal(0);
        });

        // completions don't follow admissions, so assignment tracks live occupancy
        it("never double-books while a slot is free, under out-of-order completion", function () {
            const slotCount = 4;
            const cap = 4;
            const load = new Array(slotCount).fill(0);
            const durations = [12, 48, 15, 58, 11, 23, 45, 14, 27, 19];
            const running: Array<{ end: number; slot: number }> = [];
            let now = 0;
            let seq = 0;
            let doubleBookedWhileFree = 0;

            while (seq < 40 || running.length) {
                while (running.length < cap && seq < 40) {
                    const slot = pickLeastLoadedSlot(load);
                    if (load[slot] > 0 && load.some((l) => l === 0)) {
                        doubleBookedWhileFree++;
                    }
                    load[slot]++;
                    running.push({
                        end: now + durations[seq % durations.length],
                        slot
                    });
                    seq++;
                }
                now = Math.min(...running.map((r) => r.end));
                for (let i = running.length - 1; i >= 0; i--) {
                    if (running[i].end <= now) {
                        load[running[i].slot]--;
                        running.splice(i, 1);
                    }
                }
            }

            expect(doubleBookedWhileFree).to.equal(0);
            expect(load.every((l) => l === 0)).to.equal(true);
        });
    });

    describe("evaluateAdmission gates", function () {
        it("admits when all gates are open", function () {
            expect(evaluateAdmission(openGates).admit).to.equal(true);
        });

        it("always keeps one test in flight (running === 0 bypasses gates)", function () {
            const decision = evaluateAdmission({
                ...openGates,
                running: 0,
                cpuUtil: 0.99,
                availGb: 0.1
            });
            expect(decision.admit).to.equal(true);
        });

        it("holds on the concurrency cap", function () {
            const decision = evaluateAdmission({ ...openGates, running: 4 });
            expect(decision.admit).to.equal(false);
            expect(decision.reason).to.include("cap");
        });

        it("holds on system-available memory (the swap-avoidance gate)", function () {
            const decision = evaluateAdmission({ ...openGates, availGb: 3.5 });
            expect(decision.admit).to.equal(false);
            expect(decision.reason).to.include("system memory");
        });

        it("holds on owned-RSS budget", function () {
            const decision = evaluateAdmission({
                ...openGates,
                occupiedGb: 19.5
            });
            expect(decision.admit).to.equal(false);
            expect(decision.reason).to.include("memory (owned");
        });

        it("holds on CPU utilization", function () {
            const decision = evaluateAdmission({ ...openGates, cpuUtil: 0.9 });
            expect(decision.admit).to.equal(false);
            expect(decision.reason).to.include("cpu");
        });

        it("reports the highest-priority reason (cap before the rest)", function () {
            const decision = evaluateAdmission({
                ...openGates,
                running: 4,
                availGb: 1,
                cpuUtil: 0.99
            });
            expect(decision.reason).to.include("cap");
        });
    });
});
