import { expect } from "chai";

const {
    availableMemGb,
    resolveDefaultWorkers,
    pickLeastLoadedSlot,
    evaluateAdmission
} = require("../../scripts/e2e-parallel/adaptiveScheduling.js") as {
    availableMemGb: () => number;
    resolveDefaultWorkers: (cores: number, maxCap: number) => number;
    pickLeastLoadedSlot: (slotLoad: number[]) => number;
    evaluateAdmission: (params: Record<string, unknown>) => {
        admit: boolean;
        reason: string | null;
    };
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
    describe("resolveDefaultWorkers", function () {
        it("gives each concurrent test ~4 hardware threads", function () {
            expect(resolveDefaultWorkers(16, 40)).to.equal(4);
            expect(resolveDefaultWorkers(128, 40)).to.equal(32);
        });

        it("never drops below 2, even on tiny hosts or bad input", function () {
            expect(resolveDefaultWorkers(4, 40)).to.equal(2);
            expect(resolveDefaultWorkers(2, 40)).to.equal(2);
            expect(resolveDefaultWorkers(0, 40)).to.equal(2);
            expect(resolveDefaultWorkers(NaN, 40)).to.equal(2);
        });

        it("never exceeds the account-pool cap on big workstations", function () {
            expect(resolveDefaultWorkers(256, 40)).to.equal(40);
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
