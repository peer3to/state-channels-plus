// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { runAgainstProtocolWorkers } from "../fixtures/distributed/protocolWorker";
import { waitFor } from "../utils/waitFor";
import { expect } from "chai";
import { fork } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const {
    validateWorkerStats
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    DEFAULTS: SERVER_DEFAULTS,
    parseServerArgs
} = require("../../scripts/e2e-parallel/distributed/serverArgParser.js");
const {
    toWireTask,
    fromWireCostBudget,
    fromWireTask
} = require("../../scripts/e2e-parallel/distributed/taskWire.js");
const {
    runScheduler
} = require("../../scripts/e2e-parallel/local/scheduler.js");
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("../../scripts/e2e-parallel/shared/accountPartitionPool.js");
const {
    parseCliArgs,
    getHelpText
} = require("../../scripts/e2e-parallel/shared/argParser.js");
const {
    cpuDelta,
    readCpuSnapshot
} = require("../../scripts/e2e-parallel/shared/cpuAccounting.js");
const {
    buildRunMetrics,
    getErrorLogPath,
    cleanupNonErrorLogs,
    writeRunMetrics
} = require("../../scripts/e2e-parallel/shared/logging.js");
const {
    resetResourceGateWarnings,
    ResourceGate,
    rssByPid,
    rssByProcessTree,
    TaskProcessSampler,
    processScanStats
} = require("../../scripts/e2e-parallel/shared/resourceGate.js");
const {
    nextSampleDelayMs,
    runTask
} = require("../../scripts/e2e-parallel/shared/runTask.js");
const {
    allowsWorkerAssignment,
    buildSlotEnv,
    holdReason
} = require("../../scripts/e2e-parallel/shared/scheduling.js");
const {
    TaskResourcePool
} = require("../../scripts/e2e-parallel/shared/taskResources.js");
const {
    WorkerScheduler
} = require("../../scripts/e2e-parallel/shared/workerScheduler.js");

// One hardhat task whose cost-cache key is "hardhat||measured".
const MEASURED_TASK = {
    label: "measured",
    logName: "measured",
    args: [],
    runner: "hardhat"
};

// A clock a second further on at every CPU reading, so each one is taken.
function steadyClock() {
    let at = 0;
    return () => (at += 1000);
}

describe("distributed worker scheduler", function () {
    it("holds chain assignments for accounts while admitting other tiers and retries after release", async function () {
        const taskResources = new TaskResourcePool({
            baseEnv: {},
            slots: [],
            accountPartitions: new AccountPartitionPool(1)
        });
        const lease = taskResources.acquire({ runner: "hardhat" });
        let samples = 0;
        const holds: string[] = [];
        const options = {
            taskResources,
            scheduler: { options: { schedule: "fifo" }, bufferedCount: 1 },
            resources: {
                async allows() {
                    samples++;
                    return true;
                }
            },
            config: { concurrencyCap: 40, taskCount: 3 },
            logging: {
                hold({ reason }: { reason: string }) {
                    holds.push(reason);
                }
            }
        };
        const chain = { seq: 1, task: { runner: "hardhat" } };
        try {
            expect(
                await allowsWorkerAssignment(options, 1, chain, [])
            ).to.equal(false);
            expect(samples).to.equal(0);
            expect(holds).to.deep.equal([
                "waiting for a funded account partition"
            ]);
            expect(
                await allowsWorkerAssignment(
                    options,
                    1,
                    { task: { runner: "forge" } },
                    []
                )
            ).to.equal(true);
            expect(
                await allowsWorkerAssignment(
                    options,
                    1,
                    { task: { runner: "browser" } },
                    []
                )
            ).to.equal(true);
            expect(samples).to.equal(2);
            lease.release();
            expect(
                await allowsWorkerAssignment(options, 0, chain, [])
            ).to.equal(true);
            expect(samples).to.equal(3);
        } finally {
            lease.release();
        }
    });

    it("accepts default cost scheduling and rejects invalid scheduling flags", function () {
        expect(parseCliArgs(["node", "runner"])).to.include({
            schedule: "cost",
            costCachePath: ".cache/test-costs.json",
            costCacheReadOnly: false
        });
        expect(
            parseCliArgs(["node", "runner", "--cost-cache-read-only"])
                .costCacheReadOnly
        ).to.equal(true);
        expect(
            parseCliArgs([
                "node",
                "runner",
                "--schedule",
                "cost",
                "--cost-cache",
                "custom.json"
            ])
        ).to.include({ schedule: "cost", costCachePath: "custom.json" });
        expect(
            parseCliArgs([
                "node",
                "runner",
                "--schedule=fifo",
                "--cost-cache=custom=cost.json"
            ])
        ).to.include({ schedule: "fifo", costCachePath: "custom=cost.json" });
        expect(
            parseCliArgs(["node", "runner", "--schedule=cost"]).schedule
        ).to.equal("cost");
        for (const flags of [
            ["--schedule"],
            ["--schedule="],
            ["--schedule", "unknown"],
            ["--schedule=unknown"],
            ["--schedule", "--cost-cache=costs.json"],
            ["--schedule", " cost"]
        ]) {
            expect(() => parseCliArgs(["node", "runner", ...flags])).to.throw(
                "--schedule requires fifo or cost"
            );
        }
        for (const flags of [
            ["--cost-cache"],
            ["--cost-cache="],
            ["--cost-cache", ""],
            ["--cost-cache", " "],
            ["--cost-cache", "--schedule=cost"],
            ["--cost-cache=-bad"],
            ["--cost-cache=bad\u0000path"]
        ]) {
            expect(() => parseCliArgs(["node", "runner", ...flags])).to.throw(
                "--cost-cache requires a nonempty path"
            );
        }
        expect(getHelpText()).to.include("--schedule fifo|cost");
        expect(getHelpText()).to.include("--cost-cache <path>");
    });

    it("validates wire cost numbers and the protocol predicate", function () {
        const root = process.cwd();
        const task = {
            label: "wire",
            logName: "wire",
            runner: "hardhat",
            args: ["test"],
            cost: {
                durationMs: 123,
                cores: 0.3,
                rssGb: 0.5,
                known: false,
                samples: 10
            }
        };
        expect(toWireTask(task, root)).not.to.have.property("cost");
        expect(
            toWireTask(task, root, {
                schedule: "cost",
                distributedProtocol: 13
            })
        ).not.to.have.property("cost");
        expect(
            toWireTask(task, root, {
                schedule: "cost",
                distributedProtocol: 14
            })
        ).not.to.have.property("cost");
        expect(
            toWireTask(task, root, {
                schedule: "fifo",
                distributedProtocol: 15
            })
        ).not.to.have.property("cost");
        const wire = toWireTask(task, root, {
            schedule: "cost",
            distributedProtocol: 15
        });
        expect(wire.cost).to.deep.equal({
            cores: 0.3,
            rssGb: 0.5,
            known: false
        });
        expect(fromWireTask(wire, root).cost).to.deep.equal(wire.cost);
        expect(
            fromWireTask(
                { ...wire, cost: { cores: 0, rssGb: 0, known: true } },
                root
            ).cost.known
        ).to.equal(true);
        for (const cost of [
            null,
            [],
            { cores: -1, rssGb: 0, known: false },
            { cores: NaN, rssGb: 0, known: false },
            { cores: Infinity, rssGb: 0, known: false },
            { cores: "1", rssGb: 0, known: false },
            { cores: 0, rssGb: -1, known: false },
            { cores: 0, rssGb: NaN, known: false },
            { cores: 0, rssGb: Infinity, known: false },
            { cores: 0, rssGb: "1", known: false },
            { cores: 0, rssGb: 0, known: 0 },
            { cores: 0, rssGb: 0 },
            { cores: 0, rssGb: 0, known: false, durationMs: 100 }
        ]) {
            expect(() => fromWireTask({ ...wire, cost }, root)).to.throw(
                "Invalid wire task cost"
            );
        }
        expect(fromWireCostBudget(undefined)).to.equal(undefined);
        expect(fromWireCostBudget({ cores: -0.5, rssGb: 2 })).to.deep.equal({
            cores: -0.5,
            rssGb: 2
        });
        for (const budget of [
            null,
            [],
            { cores: 1 },
            { cores: NaN, rssGb: 1 },
            { cores: 1, rssGb: "1" },
            { cores: 1, rssGb: 1, known: false }
        ]) {
            expect(() => fromWireCostBudget(budget)).to.throw(
                "Invalid wire cost budget"
            );
        }
        expect(() =>
            fromWireTask(
                { ...wire, args: [{ projectPath: "../outside.js" }] },
                root
            )
        ).to.throw("Task path leaves extracted project");
    });

    it("keeps FIFO buffered ordering and admission unchanged", async function () {
        const first = { id: "first" };
        const second = { id: "second" };
        const third = { id: "third" };
        const queue = [first, second, third];
        const starts: string[] = [];
        const probes: Array<{
            count: number;
            assignment: unknown;
            active: unknown[];
        }> = [];
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        let requests = 0;
        const scheduler = new WorkerScheduler({
            concurrencyCap: 1,
            retryMs: 1000,
            prefetch: true,
            canRun: async (
                count: number,
                assignment: unknown,
                active: Set<unknown>
            ) => {
                probes.push({ count, assignment, active: [...active] });
                return count === 0;
            },
            requestTask: async () => {
                requests++;
                return queue.shift() ?? null;
            },
            runTask: async (assignment: { id: string }) => {
                starts.push(assignment.id);
                await pending;
            }
        });
        try {
            await scheduler.requestWhenAvailable();
            await new Promise((resolve) => setImmediate(resolve));
            expect(starts).to.deep.equal(["first"]);
            expect(requests).to.equal(2);
            expect(scheduler.bufferedAssignment).to.equal(second);
            await scheduler.requestWhenAvailable();
            expect(probes[1]).to.deep.equal({
                count: 1,
                assignment: null,
                active: [first]
            });
            expect(requests).to.equal(2);
            expect(scheduler.bufferedAssignment).to.equal(second);
            release();
            await new Promise((resolve) => setImmediate(resolve));
            await scheduler.requestWhenAvailable();
            await new Promise((resolve) => setImmediate(resolve));
            expect(starts).to.deep.equal(["first", "second"]);
            expect(requests).to.equal(3);
            expect(scheduler.bufferedAssignment).to.equal(third);
        } finally {
            scheduler.stop();
            release();
        }
    });

    it("buffers a cost task the machine no longer admits and starts it on a later tick", async function () {
        const task = { id: "task" };
        const judged: unknown[] = [];
        const starts: string[] = [];
        let admit = false;
        let requests = 0;
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 2,
            retryMs: 1000,
            canRun: async (_count: number, assignment: unknown) => {
                judged.push(assignment);
                return assignment === null || admit;
            },
            requestTask: async () => (++requests === 1 ? task : null),
            runTask: async (assignment: { id: string }) => {
                starts.push(assignment.id);
            }
        });
        try {
            await scheduler.requestWhenAvailable();
            expect(judged).to.deep.equal([null, task]);
            expect(starts).to.deep.equal([]);
            expect(scheduler.bufferedAssignment).to.equal(task);
            admit = true;
            await scheduler.requestWhenAvailable();
            expect(requests).to.equal(1);
            expect(judged).to.deep.equal([null, task, task, task]);
            expect(starts).to.deep.equal(["task"]);
            expect(scheduler.bufferedAssignment).to.equal(null);
        } finally {
            scheduler.stop();
        }
    });

    it("probes admission before every cost fetch and fetches nothing while it holds", async function () {
        const first = { id: "first" };
        const probes: Array<{ count: number; assignment: unknown }> = [];
        let requests = 0;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 2,
            retryMs: 1000,
            canRun: async (count: number, assignment: unknown) => {
                probes.push({ count, assignment });
                return count === 0;
            },
            requestTask: async () => (++requests === 1 ? first : null),
            runTask: async () => pending
        });
        try {
            await scheduler.requestWhenAvailable();
            await waitFor(() => probes.length === 3, 10000, 10);
            expect(requests).to.equal(1);
            expect(probes).to.deep.equal([
                { count: 0, assignment: null },
                { count: 0, assignment: first },
                { count: 1, assignment: null }
            ]);
        } finally {
            scheduler.stop();
            release();
        }
    });

    it("paces both known and unknown cost starts by the scheduler interval", async function () {
        const run = async (known: boolean) => {
            const queue = ["first", "second"].map((id) => ({
                id,
                task: { cost: { cores: 0.1, rssGb: 0.1, known } }
            }));
            let release!: () => void;
            const pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            const scheduler = new WorkerScheduler({
                schedule: "cost",
                concurrencyCap: 4,
                // Far longer than the test waits: only an immediate request
                // can start the second task.
                retryMs: 60000,
                canRun: async () => true,
                requestTask: async () => queue.shift() ?? null,
                runTask: async () => pending
            });
            try {
                await scheduler.requestWhenAvailable();
                await new Promise((resolve) => setTimeout(resolve, 20));
                return scheduler.running;
            } finally {
                scheduler.stop();
                release();
            }
        };
        expect(await run(true)).to.equal(1);
        expect(await run(false)).to.equal(1);
    });

    it("does not prefetch under cost", async function () {
        const queue = [{ id: "first" }, { id: "second" }];
        let requests = 0;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 2,
            retryMs: 1000,
            prefetch: true,
            canRun: async () => true,
            requestTask: async () => {
                requests++;
                return queue.shift() ?? null;
            },
            runTask: async () => pending
        });
        try {
            await scheduler.requestWhenAvailable();
            await new Promise((resolve) => setImmediate(resolve));
            expect(requests).to.equal(1);
            expect(scheduler.bufferedAssignment).to.equal(null);
            await waitFor(() => requests === 2, 10000, 10);
            expect(scheduler.running).to.equal(2);
        } finally {
            scheduler.stop();
            release();
        }
    });

    it("holds cost admission on the predicted-core budget, the CPU valve and the cap", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-cpu-"));
        try {
            const statPath = path.join(root, "cpu-stat");
            fs.writeFileSync(statPath, "cpu 0 0 0 1000 0 0 0 0 0 0\n");
            const resources = new ResourceGate({
                testPids: () => [],
                infraPids: () => [],
                targetLoad: 1,
                memBoundGb: 10,
                sampleOptions: {
                    platform: "linux",
                    now: steadyClock(),
                    cpuCount: () => 4,
                    procRoot: root,
                    readFile: (file: string) => {
                        if (file === "/proc/stat")
                            return fs.readFileSync(statPath, "utf8");
                        const error = new Error(
                            "ENOENT"
                        ) as NodeJS.ErrnoException;
                        error.code = "ENOENT";
                        throw error;
                    }
                }
            });
            const fits = {
                schedule: "cost",
                runningCost: { cores: 0.1, rssGb: 0.1 },
                nextCost: { cores: 0.1, rssGb: 0.1 }
            };
            fs.writeFileSync(statPath, "cpu 0 0 0 2000 0 0 0 0 0 0\n");
            expect(
                await resources.allows(1, 4, {
                    schedule: "cost",
                    runningCost: { cores: 3, rssGb: 0 },
                    nextCost: { cores: 1.01, rssGb: 0 }
                })
            ).to.equal(false);
            expect(resources.lastHoldReason).to.equal("cpu");
            // 95 of 100 jiffies busy: at the valve
            fs.writeFileSync(statPath, "cpu 95 0 0 2005 0 0 0 0 0 0\n");
            expect(await resources.allows(1, 4, fits)).to.equal(false);
            expect(resources.lastHoldReason).to.equal("cpu");
            // 94 of 100 jiffies busy: under it
            fs.writeFileSync(statPath, "cpu 189 0 0 2011 0 0 0 0 0 0\n");
            expect(await resources.allows(1, 4, fits)).to.equal(true);
            expect(await resources.allows(4, 4, fits)).to.equal(false);
            expect(resources.lastHoldReason).to.equal("cap");
            expect(resources.stats().holdCounts).to.deep.equal({
                cap: 1,
                memory: 0,
                cpu: 2
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps the host's target load as the cost CPU ceiling and reports the budget", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-ceiling-"));
        try {
            const statPath = path.join(root, "cpu-stat");
            fs.writeFileSync(statPath, "cpu 0 0 0 1000 0 0 0 0 0 0\n");
            const resources = new ResourceGate({
                testPids: () => [],
                infraPids: () => [],
                targetLoad: 0.5,
                memBoundGb: 10,
                sampleOptions: {
                    platform: "linux",
                    now: steadyClock(),
                    cpuCount: () => 4,
                    procRoot: root,
                    readFile: (file: string) => {
                        if (file === "/proc/stat")
                            return fs.readFileSync(statPath, "utf8");
                        const error = new Error(
                            "ENOENT"
                        ) as NodeJS.ErrnoException;
                        error.code = "ENOENT";
                        throw error;
                    }
                }
            });
            // 60 of 100 jiffies busy: under 0.95, over the host's 0.5
            fs.writeFileSync(statPath, "cpu 60 0 0 1040 0 0 0 0 0 0\n");
            expect(
                await resources.allows(1, 4, {
                    schedule: "cost",
                    runningCost: { cores: 0.1, rssGb: 0.1 },
                    nextCost: { cores: 0.1, rssGb: 0.1 }
                })
            ).to.equal(false);
            expect(resources.lastHoldReason).to.equal("cpu");
            expect(resources.costCpuValve).to.equal(0.5);
            expect(
                resources.costBudget({ cores: 1.5, rssGb: 2 })
            ).to.deep.equal({ cores: 2.5, rssGb: 6 });
            expect(
                holdReason({
                    schedule: "cost",
                    running: 1,
                    concurrencyCap: 4,
                    resourceGate: resources,
                    memBoundGb: 10,
                    targetLoad: 0.5
                })
            ).to.include("cpu 60%/50%");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("uses the configured CPU budget without changing detected capacity", function () {
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 0.8,
            memBoundGb: 10,
            cpuLimit: 6,
            sampleOptions: { platform: "darwin", cpuCount: () => 8 }
        });
        expect(resources.stats().cpuCores).to.equal(8);
        expect(resources.costBudget({ cores: 5.5, rssGb: 0 }).cores).to.equal(
            0.5
        );
        expect(resources.costBudget({ cores: 6, rssGb: 0 }).cores).to.equal(0);
        expect(resources.costBudget({ cores: 7, rssGb: 0 }).cores).to.equal(-1);
    });

    it("allows a configured CPU budget above the available cores", function () {
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 0.8,
            memBoundGb: 10,
            cpuLimit: 6,
            sampleOptions: { platform: "darwin", cpuCount: () => 4 }
        });
        expect(resources.costBudget({ cores: 1.5, rssGb: 0 }).cores).to.equal(
            4.5
        );
        expect(resources.stats().cpuCores).to.equal(4);
    });

    it("meters overlapping process-table scans once and counts a failed one", async function () {
        const slowScan = (fails: boolean) =>
            new TaskProcessSampler(100, {
                warn: () => {},
                execFile: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    if (fails) throw new Error("ps unavailable");
                    return {
                        stdout: "  100     1  2048 0:01.00 Thu Oct  1 10:00:00 2026\n"
                    };
                }
            });
        const before = processScanStats();
        const scans = Promise.all([
            slowScan(false).sample(),
            slowScan(true).sample()
        ]);
        // Time already spent scanning counts while the scans still run.
        await new Promise((resolve) => setTimeout(resolve, 150));
        const during = processScanStats();
        expect(during.processScanMs - before.processScanMs).to.be.at.least(100);
        await scans;
        const after = processScanStats();
        expect(after.processScanCount - before.processScanCount).to.equal(2);
        // Two 300 ms scans side by side are 300 ms of scanning, not 600;
        // the ceiling leaves room for event-loop lag under load.
        expect(after.processScanMs - before.processScanMs)
            .to.be.at.least(270)
            .and.below(540);
    });

    it("holds a busy worker until its first CPU reading and keeps a reading for sooner checks", async function () {
        let clock = 0;
        let stat = "cpu 0 0 0 1000 0 0 0 0 0 0\n";
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 1,
            memBoundGb: 10,
            sampleOptions: {
                platform: "linux",
                now: () => clock,
                cpuCount: () => 4,
                readFile: (file: string) => {
                    if (file === "/proc/stat") return stat;
                    const error = new Error("ENOENT") as NodeJS.ErrnoException;
                    error.code = "ENOENT";
                    throw error;
                }
            }
        });
        const fits = {
            schedule: "cost",
            runningCost: { cores: 0.1, rssGb: 0.1 },
            nextCost: { cores: 0.1, rssGb: 0.1 }
        };
        // No reading yet: only an idle worker admits.
        clock = 100;
        expect(await resources.allows(1, 4, fits)).to.equal(false);
        expect(resources.lastHoldReason).to.equal("cpu");
        expect(await resources.allows(0, 4, fits)).to.equal(true);
        // Half busy over the first full interval.
        stat = "cpu 500 0 0 1500 0 0 0 0 0 0\n";
        clock = 400;
        await resources.sample();
        expect(resources.cpuUtil).to.equal(0.5);
        // Fully busy, but checked too soon: the last reading stands.
        stat = "cpu 1500 0 0 1500 0 0 0 0 0 0\n";
        clock = 450;
        await resources.sample();
        expect(resources.cpuUtil).to.equal(0.5);
        expect(resources.stats().cpuSampleCount).to.equal(1);
        clock = 700;
        await resources.sample();
        expect(resources.cpuUtil).to.equal(1);
        expect(resources.stats().cpuSampleCount).to.equal(2);
    });

    it("keeps a finish's queued request from starting a task while an unknown-cost start settles", async function () {
        const retryMs = 1000;
        const startedAt = new Map<string, number>();
        const forever = new Promise<void>(() => {});
        const cost = (known: boolean) => ({
            cost: { cores: 0.1, rssGb: 0.1, known }
        });
        const queue = [
            { id: "known", task: cost(true) },
            { id: "unknown", task: cost(false) },
            { id: "next", task: cost(true) }
        ];
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 4,
            retryMs,
            canRun: async () => true,
            requestTask: async () => {
                const next = queue.shift() ?? null;
                // "unknown" arrives on the same timer tick that "known"
                // finishes on, after that finish queued its request.
                if (next?.id === "unknown")
                    await new Promise((resolve) => setTimeout(resolve, 50));
                return next;
            },
            runTask: async (assignment: { id: string }) => {
                startedAt.set(assignment.id, Date.now());
                if (assignment.id !== "known") return forever;
                await new Promise((resolve) =>
                    setTimeout(resolve, retryMs + 50)
                );
            }
        });
        try {
            await scheduler.requestWhenAvailable();
            await waitFor(() => startedAt.has("next"), 10000, 10);
            expect(
                startedAt.get("next")! - startedAt.get("unknown")!
            ).to.be.at.least(retryMs - 15);
        } finally {
            scheduler.stop();
        }
    });

    it("paces a known-cost start after an unknown-cost start", async function () {
        const retryMs = 1000;
        const startedAt = new Map<string, number>();
        const cost = (known: boolean) => ({
            cost: { cores: 0.1, rssGb: 0.1, known }
        });
        const queue = [
            { id: "unknown", task: cost(false) },
            { id: "known", task: cost(true) },
            { id: "next", task: cost(true) }
        ];
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 4,
            retryMs,
            canRun: async () => true,
            requestTask: async () => queue.shift() ?? null,
            runTask: async (assignment: { id: string }) => {
                startedAt.set(assignment.id, Date.now());
                return new Promise<void>(() => {});
            }
        });
        try {
            await scheduler.requestWhenAvailable();
            await waitFor(() => startedAt.has("next"), 10000, 10);
            // Both starts wait out a full interval.
            expect(
                startedAt.get("known")! - startedAt.get("unknown")!
            ).to.be.at.least(retryMs - 15);
            expect(
                startedAt.get("next")! - startedAt.get("known")!
            ).to.be.at.least(retryMs - 15);
        } finally {
            scheduler.stop();
        }
    });

    it("lets another task's finish wait out an unknown-cost start's tick", async function () {
        const retryMs = 300;
        const startedAt = new Map<string, number>();
        const forever = new Promise<void>(() => {});
        const cost = (known: boolean) => ({
            cost: { cores: 0.1, rssGb: 0.1, known }
        });
        const queue = [
            { id: "known", task: cost(true) },
            { id: "unknown", task: cost(false) },
            { id: "next", task: cost(false) }
        ];
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 4,
            retryMs,
            canRun: async () => true,
            requestTask: async () => queue.shift() ?? null,
            runTask: async (assignment: { id: string }) => {
                startedAt.set(assignment.id, Date.now());
                if (assignment.id !== "known") return forever;
                // Finishes while "unknown" is still settling.
                await new Promise((resolve) =>
                    setTimeout(resolve, retryMs + 50)
                );
            }
        });
        try {
            await scheduler.requestWhenAvailable();
            await waitFor(() => startedAt.has("next"), 10000, 10);
            expect(
                startedAt.get("next")! - startedAt.get("unknown")!
            ).to.be.at.least(retryMs - 15);
        } finally {
            scheduler.stop();
        }
    });

    it("gives a cost task started by a finish a full tick before the next start", async function () {
        const retryMs = 300;
        const startedAt = new Map<string, number>();
        let firstDone = false;
        const queue = ["first", "second", "third"].map((id) => ({
            id,
            task: { cost: { cores: 0.1, rssGb: 0.1, known: false } }
        }));
        const forever = new Promise<void>(() => {});
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 4,
            retryMs,
            // Nothing beside "first" until it finishes.
            canRun: async (running: number) => running === 0 || firstDone,
            requestTask: async () => queue.shift() ?? null,
            runTask: async (assignment: { id: string }) => {
                startedAt.set(assignment.id, Date.now());
                if (assignment.id !== "first") return forever;
                // Finishes late in the first tick, as the timer runs.
                await new Promise((resolve) => setTimeout(resolve, 250));
                firstDone = true;
            }
        });
        try {
            await scheduler.requestWhenAvailable();
            await waitFor(() => startedAt.has("third"), 10000, 10);
            expect([...startedAt.keys()]).to.deep.equal([
                "first",
                "second",
                "third"
            ]);
            // Timers never fire early; an old tick left running would start
            // "third" about 50 ms after "second".
            expect(
                startedAt.get("third")! - startedAt.get("second")!
            ).to.be.at.least(retryMs - 15);
        } finally {
            scheduler.stop();
        }
    });

    it("keeps the start interval when a task finishes immediately", async function () {
        const run = async (schedule: string) => {
            const queue = ["first", "second"].map((id) => ({
                id,
                // Even a completed task must leave the start interval intact.
                task: { cost: { cores: 0.1, rssGb: 0.1, known: false } }
            }));
            const starts: string[] = [];
            const scheduler = new WorkerScheduler({
                schedule,
                concurrencyCap: 1,
                retryMs: 60000,
                canRun: async (running: number) => running === 0,
                requestTask: async () => queue.shift() ?? null,
                runTask: async (assignment: { id: string }) => {
                    starts.push(assignment.id);
                }
            });
            try {
                await scheduler.requestWhenAvailable();
                await new Promise((resolve) => setTimeout(resolve, 20));
                return starts;
            } finally {
                scheduler.stop();
            }
        };
        expect(await run("cost")).to.deep.equal(["first"]);
        expect(await run("fifo")).to.deep.equal(["first"]);
    });

    it("starts nothing from an immediate request that lands after stop", async function () {
        let requests = 0;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const scheduler = new WorkerScheduler({
            schedule: "cost",
            concurrencyCap: 4,
            retryMs: 60000,
            canRun: async () => true,
            requestTask: async () => {
                requests++;
                return {
                    id: `task-${requests}`,
                    task: { cost: { cores: 0.1, rssGb: 0.1, known: true } }
                };
            },
            runTask: async () => pending
        });
        await scheduler.requestWhenAvailable();
        scheduler.stop();
        await new Promise((resolve) => setImmediate(resolve));
        expect(requests).to.equal(1);
        expect(scheduler.running).to.equal(1);
        release();
    });

    it("meters process-table scans for the run metrics", async function () {
        const before = processScanStats();
        const sampler = new TaskProcessSampler(100, {
            execFile: async () => ({
                stdout: "  100     1  2048 0:01.00 Thu Oct  1 10:00:00 2026\n"
            })
        });
        await sampler.sample();
        await sampler.sample();
        const after = processScanStats();
        expect(after.processScanCount - before.processScanCount).to.equal(2);
        expect(after.processScanMs).to.be.at.least(before.processScanMs);
    });

    it("holds a busy worker while CPU readings yield no utilization, and says so", async function () {
        let clock = 0;
        let stat = "cpu 0 0 0 1000 0 0 0 0 0 0\n";
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 0.8,
            memBoundGb: 10,
            sampleOptions: {
                platform: "linux",
                now: () => clock,
                cpuCount: () => 4,
                readFile: (file: string) => {
                    if (file === "/proc/stat") return stat;
                    const error = new Error("ENOENT") as NodeJS.ErrnoException;
                    error.code = "ENOENT";
                    throw error;
                }
            }
        });
        // Counters that have not moved give no utilization at all.
        clock = 400;
        expect(await resources.allows(1, 4)).to.equal(false);
        expect(
            holdReason({
                schedule: "fifo",
                running: 1,
                concurrencyCap: 4,
                resourceGate: resources,
                memBoundGb: 10,
                targetLoad: 0.8
            })
        ).to.equal("cpu (awaiting first CPU reading)");
        stat = "cpu 100 0 0 1900 0 0 0 0 0 0\n";
        clock = 800;
        expect(await resources.allows(1, 4)).to.equal(true);
    });

    it("logs the fifo hold reason the gate counted", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "fifo-hold-"));
        try {
            const statPath = path.join(root, "cpu-stat");
            fs.writeFileSync(statPath, "cpu 0 0 0 1000 0 0 0 0 0 0\n");
            const resources = new ResourceGate({
                testPids: () => [],
                infraPids: () => [],
                targetLoad: 0.5,
                memBoundGb: 0.1,
                sampleOptions: {
                    platform: "linux",
                    now: steadyClock(),
                    cpuCount: () => 4,
                    procRoot: root,
                    readFile: (file: string) => {
                        if (file === "/proc/stat")
                            return fs.readFileSync(statPath, "utf8");
                        const error = new Error(
                            "ENOENT"
                        ) as NodeJS.ErrnoException;
                        error.code = "ENOENT";
                        throw error;
                    }
                }
            });
            // CPU and memory are both over their limits.
            fs.writeFileSync(statPath, "cpu 95 0 0 1005 0 0 0 0 0 0\n");
            expect(await resources.allows(1, 4)).to.equal(false);
            expect(resources.lastHoldReason).to.equal("cpu");
            expect(
                holdReason({
                    schedule: "fifo",
                    running: 1,
                    concurrencyCap: 4,
                    resourceGate: resources,
                    memBoundGb: 0.1,
                    targetLoad: 0.5
                })
            ).to.match(/^cpu /);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("does not probe admission for a full local cost worker with nothing queued", async function () {
        const logDir = path.join(
            process.cwd(),
            "logs",
            `scheduler-cost-idle-${process.pid}`
        );
        const output: string[] = [];
        const originalConsoleLog = console.log;
        let probes = 0;
        const resourceGate = {
            cpuUtil: 0,
            occupiedGb: 0,
            lastHoldReason: null,
            allows: async (running: number) => {
                probes++;
                return running === 0;
            },
            stats: () => ({
                peakCpu: 0,
                avgCpu: 0,
                cpuSampleCount: 1,
                peakOccupiedGb: 0,
                avgPerTestGb: 0,
                memorySampleCount: 1,
                memBoundGb: 10
            })
        };
        console.log = (...values: unknown[]) => output.push(values.join(" "));
        try {
            const result = await runScheduler({
                tasks: [
                    {
                        label: "long",
                        logName: "long",
                        runner: "forge",
                        args: []
                    }
                ],
                slots: [],
                slotCount: 0,
                concurrencyCap: 1,
                targetLoad: 1,
                memBoundGb: 10,
                baseEnv: {},
                logDir,
                infraPids: () => [],
                tickMs: 1,
                resourceGate,
                schedule: "cost",
                projectRoot: logDir,
                costCachePath: path.join(logDir, "test-costs.json"),
                runTaskImpl: async (
                    _cmd: string,
                    _args: string[],
                    _env: unknown,
                    label: string
                ) => {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    return {
                        code: 0,
                        label,
                        stdout: "",
                        stderr: "",
                        durationMs: 50
                    };
                }
            });
            expect(result.completed).to.equal(1);
        } finally {
            console.log = originalConsoleLog;
            fs.rmSync(logDir, { recursive: true, force: true });
        }
        expect(probes).to.equal(2);
        expect(output.some((line) => line.includes("holding"))).to.equal(false);
    });

    it("refuses a busy local cost worker a test outside its budget and counts the hold", async function () {
        const logDir = path.join(
            process.cwd(),
            "logs",
            `scheduler-cost-budget-${process.pid}`
        );
        const output: string[] = [];
        const originalConsoleLog = console.log;
        const starts: string[] = [];
        const resourceGate = {
            cpuUtil: 0,
            occupiedGb: 0,
            lastHoldReason: null,
            allows: async () => true,
            // Nothing beside the running test fits.
            costBudget: () => ({ cores: 0, rssGb: 0 }),
            stats: () => ({
                peakCpu: 0,
                avgCpu: 0,
                cpuSampleCount: 1,
                peakOccupiedGb: 0,
                avgPerTestGb: 0,
                memorySampleCount: 1,
                memBoundGb: 10,
                holdCounts: { cap: 0, memory: 0, cpu: 0 }
            })
        };
        console.log = (...values: unknown[]) => output.push(values.join(" "));
        try {
            const result = await runScheduler({
                tasks: ["first", "second"].map((label) => ({
                    label,
                    logName: label,
                    runner: "forge",
                    args: []
                })),
                slots: [],
                slotCount: 0,
                concurrencyCap: 2,
                targetLoad: 1,
                memBoundGb: 10,
                baseEnv: {},
                logDir,
                infraPids: () => [],
                tickMs: 1,
                resourceGate,
                schedule: "cost",
                projectRoot: logDir,
                costCachePath: path.join(logDir, "test-costs.json"),
                runTaskImpl: async (
                    _cmd: string,
                    _args: string[],
                    _env: unknown,
                    label: string
                ) => {
                    starts.push(label);
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    return {
                        code: 0,
                        label,
                        stdout: "",
                        stderr: "",
                        durationMs: 50
                    };
                }
            });
            expect(result.completed).to.equal(2);
            const metrics = JSON.parse(
                fs.readFileSync(path.join(logDir, "run-metrics.json"), "utf8")
            );
            expect(metrics.workers[0].peakConcurrency).to.equal(1);
            expect(metrics.workers[0].holdCounts.cpu).to.be.at.least(1);
            // The refused test was assigned only once the first finished.
            const [first, second] = metrics.tasks.map(
                (task: { assignedAtMs: number }) => task.assignedAtMs
            );
            expect(first).to.be.at.least(0);
            expect(second - first).to.be.at.least(40);
        } finally {
            console.log = originalConsoleLog;
            fs.rmSync(logDir, { recursive: true, force: true });
        }
        expect(starts).to.have.length(2);
        expect(
            output.some((line) =>
                line.includes("holding — cpu (cost budget; predicted cost")
            )
        ).to.equal(true);
    });

    it("reports each task's first assignment from the run's start, or null", function () {
        const metrics = buildRunMetrics({
            tasks: [
                { label: "assigned", firstAssignedAt: 1500 },
                { label: "never" }
            ],
            workers: [],
            makespanMs: 2000,
            sumDurationMs: 0,
            startedAt: 1000
        });
        expect(
            metrics.tasks.map(
                (task: { assignedAtMs: number | null }) => task.assignedAtMs
            )
        ).to.deep.equal([500, null]);
    });

    it("reserves infrastructure and container overhead before admitting more work at seven cores", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "memory-admission-")
        );
        let containerGb = 3;
        let inactiveFileGb = 0;
        let activeFileGb = 0;
        let boundedContainer = true;
        let idleTicks = 1000;
        try {
            for (const [pid, rssGb] of [
                [100, 2],
                [200, 1]
            ]) {
                fs.mkdirSync(path.join(root, String(pid)));
                const fields = Array(22).fill("0");
                fields[0] = "S";
                fields[1] = "1";
                fields[19] = String(pid);
                fs.writeFileSync(
                    path.join(root, `${pid}/stat`),
                    `${pid} (owned) ${fields.join(" ")}\n`
                );
                fs.writeFileSync(
                    path.join(root, `${pid}/status`),
                    `VmRSS:\t${rssGb * 1024 ** 2} kB\n`
                );
            }
            const resources = new ResourceGate({
                testPids: () => [100],
                infraPids: () => [200],
                targetLoad: 0.95,
                cpuLimit: 7,
                memBoundGb: 12.5,
                sampleOptions: {
                    platform: "linux",
                    procRoot: root,
                    now: steadyClock(),
                    readFile: (file: string) => {
                        if (file === "/proc/self/cgroup") return "0::/worker\n";
                        if (!boundedContainer && file.includes("/memory."))
                            throw new Error("ENOENT");
                        if (file.endsWith("/memory.stat"))
                            return `inactive_file ${inactiveFileGb * 1024 ** 3}\nactive_file ${activeFileGb * 1024 ** 3}\n`;
                        if (file.endsWith("/memory.current"))
                            return String(containerGb * 1024 ** 3);
                        if (file.endsWith("/memory.max"))
                            return String(10 * 1024 ** 3);
                        if (file === "/proc/stat")
                            return `cpu 0 0 0 ${(idleTicks += 100)} 0 0 0 0 0 0\n`;
                        throw new Error("ENOENT");
                    }
                }
            });
            await resources.sample();
            // 8 GiB usable: 3 currently used + (6 predicted - 2 resident).
            expect(resources.costBudget({ cores: 3, rssGb: 6 })).to.deep.equal({
                cores: 4,
                rssGb: 1
            });
            const admission = {
                schedule: "cost",
                runningCost: { cores: 3, rssGb: 6 },
                nextCost: { cores: 1, rssGb: 1 }
            };
            expect(await resources.allows(3, 40, admission)).to.equal(false);
            expect(resources.lastHoldReason).to.equal("memory");
            admission.nextCost.rssGb = 0.5;
            expect(await resources.allows(3, 40, admission)).to.equal(true);
            containerGb = 8;
            expect(await resources.allows(3, 40, admission)).to.equal(false);
            expect(resources.lastHoldReason).to.equal("memory");
            expect(await resources.allows(0, 40, admission)).to.equal(false);
            containerGb = 9.5;
            inactiveFileGb = 6.5;
            expect(await resources.allows(0, 40, admission)).to.equal(true);
            expect(resources.costBudget({ cores: 0, rssGb: 0 }).rssGb).to.equal(
                5
            );
            inactiveFileGb = 0;
            activeFileGb = 6.5;
            // An idle worker progresses through hot file-cache pressure.
            expect(await resources.allows(0, 40, admission)).to.equal(true);
            // Busy admission and its cost budget retain the conservative estimate.
            expect(await resources.allows(3, 40, admission)).to.equal(false);
            expect(resources.costBudget({ cores: 0, rssGb: 0 }).rssGb).to.equal(
                -1.5
            );
            activeFileGb = 1;
            expect(await resources.allows(0, 40, admission)).to.equal(false);
            expect(resources.lastMemoryHold).to.deep.equal({
                occupiedGb: 8.5,
                thresholdGb: 8
            });
            expect(
                holdReason({
                    schedule: "cost",
                    running: 0,
                    concurrencyCap: 40,
                    resourceGate: resources,
                    memBoundGb: 12.5,
                    targetLoad: 0.95
                })
            ).to.equal("memory (admission 8.5≥8.0GB)");
            expect(await resources.allows(0, 40)).to.equal(false);
            expect(
                holdReason({
                    schedule: "fifo",
                    running: 0,
                    concurrencyCap: 40,
                    resourceGate: resources,
                    memBoundGb: 12.5,
                    targetLoad: 0.95
                })
            ).to.equal("memory (admission 8.5≥8.0GB)");
            activeFileGb = 6.5;
            expect(await resources.allows(0, 40)).to.equal(true);
            expect(resources.lastMemoryHold).to.equal(null);
            activeFileGb = 0;
            expect(await resources.allows(0, 40, admission)).to.equal(false);
            boundedContainer = false;
            await resources.sample();
            // Without cgroup counters, shared infrastructure still adds to predictions.
            expect(resources.costBudget({ cores: 3, rssGb: 6 }).rssGb).to.equal(
                3
            );
            // Resident memory larger than predictions must not be subtracted twice.
            expect(resources.costBudget({ cores: 3, rssGb: 1 }).rssGb).to.equal(
                7
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("holds predicted memory even when CPU budget fits", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cost-admission-"));
        let pids: number[] = [];
        try {
            const statPath = path.join(root, "cpu-stat");
            fs.writeFileSync(statPath, "cpu 0 0 0 1000 0 0 0 0 0 0\n");
            const resources = new ResourceGate({
                testPids: () => pids,
                infraPids: () => [],
                targetLoad: 0.8,
                memBoundGb: 1,
                sampleOptions: {
                    platform: "linux",
                    now: steadyClock(),
                    cpuCount: () => 4,
                    procRoot: root,
                    readFile: (file: string) => {
                        if (file === "/proc/stat")
                            return fs.readFileSync(statPath, "utf8");
                        const error = new Error(
                            "ENOENT"
                        ) as NodeJS.ErrnoException;
                        error.code = "ENOENT";
                        throw error;
                    }
                }
            });
            fs.writeFileSync(statPath, "cpu 0 0 0 2000 0 0 0 0 0 0\n");
            expect(
                await resources.allows(1, 4, {
                    schedule: "cost",
                    runningCost: { cores: 0.1, rssGb: 0.5 },
                    nextCost: { cores: 0.1, rssGb: 0.5 }
                })
            ).to.equal(false);
            expect(resources.lastHoldReason).to.equal("memory");
            expect(resources.stats().holdCounts).to.deep.equal({
                cap: 0,
                memory: 1,
                cpu: 0
            });
            expect(
                await resources.allows(1, 4, {
                    schedule: "cost",
                    runningCost: { cores: 0.1, rssGb: 0.5 },
                    nextCost: { cores: 0.1, rssGb: 0.3 }
                })
            ).to.equal(true);
            expect(
                await resources.allows(1, 4, {
                    schedule: "cost",
                    runningCost: { cores: 3, rssGb: 0 },
                    nextCost: { cores: 1, rssGb: 0 }
                })
            ).to.equal(true);
            fs.mkdirSync(path.join(root, "100"));
            const fields = Array(22).fill("0");
            fields[0] = "S";
            fields[1] = "1";
            fields[19] = "100";
            fs.writeFileSync(
                path.join(root, "100/stat"),
                `100 (owned) ${fields.join(" ")}\n`
            );
            fs.writeFileSync(
                path.join(root, "100/status"),
                "VmRSS:\t3145728 kB\n"
            );
            pids = [100];
            expect(
                await resources.allows(1, 4, {
                    schedule: "cost",
                    runningCost: { cores: 0.1, rssGb: 0.1 },
                    nextCost: { cores: 0.1, rssGb: 0.1 }
                })
            ).to.equal(false);
            expect(resources.occupiedGb).to.equal(3);
            expect(resources.lastHoldReason).to.equal("memory");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("retains run metrics through successful log cleanup", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-cleanup-"));
        try {
            writeRunMetrics(root, { version: 1, tasks: [], makespanMs: 10 });
            fs.writeFileSync(path.join(root, "success.ansi"), "passed");
            const original = fs.readFileSync(
                path.join(root, "run-metrics.json")
            );
            cleanupNonErrorLogs(root, true, false, true);
            expect(
                fs.readFileSync(path.join(root, "run-metrics.json"))
            ).to.deep.equal(original);
            expect(fs.existsSync(path.join(root, "success.ansi"))).to.equal(
                false
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("persists all supplied worker hold counters", async function () {
        const stats = {
            peakCpu: 0.5,
            avgCpu: 0.25,
            cpuSampleCount: 2,
            peakOccupiedGb: 1,
            avgPerTestGb: 0.5,
            memorySampleCount: 2,
            memBoundGb: 10,
            meanConcurrency: 1,
            peakConcurrency: 1,
            concurrencyWallMs: 100,
            processScanCount: 5,
            processScanMs: 12.5,
            holdCounts: { cap: 2, memory: 3, cpu: 4 }
        };
        expect(() =>
            validateWorkerStats({
                ...stats,
                holdCounts: { cap: -1, memory: 3, cpu: 4 }
            })
        ).to.throw("admission statistics");
        expect(() =>
            validateWorkerStats({ ...stats, meanConcurrency: NaN })
        ).to.throw("admission statistics");
        expect(() =>
            validateWorkerStats({ ...stats, processScanCount: 1.5 })
        ).to.throw("admission statistics");
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "metrics-peer",
                    distributedProtocol: 14,
                    attemptResult: {
                        durationMs: 100,
                        peakRssGb: 0.5,
                        avgCores: 0.25
                    },
                    workerStats: stats
                }
            ],
            { tasks: [MEASURED_TASK] }
        );
        expect(run.failure).to.equal(null);
        expect(run.metrics.workers).to.have.length(1);
        expect(run.metrics.workers[0].holdCounts).to.deep.equal({
            cap: 2,
            memory: 3,
            cpu: 4
        });
        expect(run.metrics.workers[0]).to.include({
            meanConcurrency: 1,
            peakConcurrency: 1,
            concurrencyWallMs: 100,
            processScanCount: 5,
            processScanMs: 12.5,
            legacyAdmission: true
        });
        expect(run.metrics.tasks[0]).to.include({
            peakRssGb: 0.5,
            avgCores: 0.25
        });
    });

    it("writes local finalizing samples to the cache", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "local-cost-cache-")
        );
        const fixture = path.join(root, "sample.cjs");
        fs.writeFileSync(
            fixture,
            "describe('cache fixture', () => { it('runs', async () => { await new Promise(resolve => setTimeout(resolve, 200)); }); });\n"
        );
        const task = {
            label: "sample",
            fullTitle: "cache fixture runs",
            logName: "sample",
            runner: "hardhat",
            args: ["test", "--no-compile", fixture]
        };
        try {
            const result = await runScheduler({
                tasks: [task],
                slots: [],
                slotCount: 0,
                concurrencyCap: 1,
                targetLoad: 1,
                memBoundGb: 100,
                baseEnv: {},
                logDir: root,
                infraPids: () => [],
                tickMs: 10,
                projectRoot: root,
                schedule: "cost"
            });
            expect(result.completed).to.equal(1);
            expect(result.failed).to.have.length(0);
            const records = Object.values(
                JSON.parse(
                    fs.readFileSync(
                        path.join(root, ".cache/test-costs.json"),
                        "utf8"
                    )
                ).tasks
            ) as Array<{
                samples: number;
                durationMs: number;
                avgCores: number;
                peakRssGb: number;
            }>;
            expect(records).to.have.length(1);
            expect(records[0].samples).to.equal(1);
            expect(records[0].durationMs).to.be.greaterThan(0);
            expect(records[0].avgCores).to.be.at.least(0);
            expect(records[0].peakRssGb).to.be.greaterThan(0);
            // The new test is committed at the project root as measured.
            const committed = Object.values(
                JSON.parse(
                    fs.readFileSync(path.join(root, "test-costs.json"), "utf8")
                ).tasks
            ) as Array<Record<string, unknown>>;
            expect(committed).to.have.length(1);
            expect(committed[0]).to.have.keys(
                "durationMs",
                "avgCores",
                "peakRssGb",
                "measurementReason"
            );
            expect(committed[0].durationMs).to.equal(
                Math.round(records[0].durationMs)
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps protocol fourteen on legacy admission with cost selection", async function () {
        const cli = parseCliArgs(["node", "runner", "--schedule", "cost"]);
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "legacy-peer",
                    distributedProtocol: 14,
                    attemptResult: {
                        durationMs: 100,
                        peakRssGb: 0.5,
                        avgCores: 0.25
                    },
                    workerStats: {
                        peakCpu: 0.5,
                        avgCpu: 0.25,
                        cpuSampleCount: 2,
                        peakOccupiedGb: 1,
                        avgPerTestGb: 0.5,
                        memorySampleCount: 2,
                        memBoundGb: 10
                    }
                }
            ],
            {
                tasks: [
                    {
                        label: "light",
                        logName: "light",
                        runner: "hardhat",
                        args: []
                    },
                    {
                        label: "long",
                        logName: "long",
                        runner: "hardhat",
                        args: []
                    }
                ],
                files: {
                    "overrides.json": JSON.stringify({
                        "hardhat||light": { durationMs: 100 },
                        "hardhat||long": { durationMs: 1000 }
                    })
                },
                run: {
                    schedule: cli.schedule,
                    costOverridesPath: "overrides.json"
                }
            }
        );
        expect(run.failure).to.equal(null);
        expect(run.workers[0].labels).to.deep.equal(["long", "light"]);
        expect(run.workers[0].costs).to.deep.equal([undefined, undefined]);
        expect(run.metrics.workers).to.have.length(1);
        expect(run.metrics.workers[0]).to.include({
            legacyAdmission: true,
            meanConcurrency: null,
            peakConcurrency: null,
            concurrencyWallMs: null,
            measurementReason: "legacy-worker-stats-unavailable"
        });
        expect(run.metrics.workers[0].holdCounts).to.deep.equal({
            cap: null,
            memory: null,
            cpu: null
        });
    });

    it("schedules by the committed costs but writes nothing in read-only runs", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "read-only-runs-"));
        const costsPath = path.join(root, "test-costs.json");
        const costCachePath = path.join(root, ".cache/test-costs.json");
        const entry = (durationMs: number) => ({
            durationMs,
            avgCores: 0.1,
            peakRssGb: 0.1,
            measurementReason: null
        });
        // Committed durations put "long" first; unread, discovery order would.
        const seeded = JSON.stringify({
            version: 1,
            tasks: {
                "forge||light": entry(100),
                "forge||long": entry(1000),
                "hardhat||light": entry(100),
                "hardhat||long": entry(1000)
            }
        });
        fs.writeFileSync(costsPath, seeded);
        const tasks = (runner: string) =>
            ["light", "long"].map((label) => ({
                label,
                logName: label,
                runner,
                args: []
            }));
        const starts: string[] = [];
        const resourceGate = {
            cpuUtil: 0,
            occupiedGb: 0,
            allows: async (running: number) => running === 0,
            stats: () => ({
                peakCpu: 0,
                avgCpu: 0,
                cpuSampleCount: 1,
                peakOccupiedGb: 0,
                avgPerTestGb: 0,
                memorySampleCount: 1,
                memBoundGb: 10
            })
        };
        try {
            const local = await runScheduler({
                tasks: tasks("forge"),
                slots: [],
                slotCount: 0,
                concurrencyCap: 1,
                targetLoad: 1,
                memBoundGb: 10,
                baseEnv: {},
                logDir: root,
                infraPids: () => [],
                tickMs: 1,
                resourceGate,
                schedule: "cost",
                projectRoot: root,
                costCachePath,
                costCacheReadOnly: true,
                runTaskImpl: async (
                    _cmd: string,
                    _args: string[],
                    _env: unknown,
                    label: string
                ) => {
                    starts.push(label);
                    return {
                        code: 0,
                        label,
                        stdout: "",
                        stderr: "",
                        durationMs: 5
                    };
                }
            });
            expect(local.completed).to.equal(2);
            expect(starts).to.deep.equal(["long", "light"]);
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(seeded);
            expect(fs.existsSync(costCachePath)).to.equal(false);
            const distributed = await runAgainstProtocolWorkers(
                [
                    {
                        name: "read-only-peer",
                        distributedProtocol: 15,
                        attemptResult: {
                            durationMs: 100,
                            peakRssGb: 0.5,
                            avgCores: 0.25
                        }
                    }
                ],
                {
                    tasks: tasks("hardhat"),
                    run: {
                        schedule: "cost",
                        projectRoot: root,
                        costCachePath,
                        costCacheReadOnly: true
                    }
                }
            );
            expect(distributed.failure).to.equal(null);
            expect(distributed.workers[0].labels).to.deep.equal([
                "long",
                "light"
            ]);
            expect(fs.readFileSync(costsPath, "utf8")).to.equal(seeded);
            expect(fs.existsSync(costCachePath)).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("writes distributed finalizing samples and skips aborted commits", async function () {
        const cacheDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-cost-cache-")
        );
        const costCachePath = path.join(cacheDir, ".cache/test-costs.json");
        const peer = (durationMs: number, afterRunComplete?: () => void) => ({
            name: "cache-peer",
            distributedProtocol: 15,
            attemptResult: { durationMs, peakRssGb: 0.5, avgCores: 0.25 },
            workerStats: {
                peakCpu: 0.5,
                avgCpu: 0.25,
                cpuSampleCount: 2,
                peakOccupiedGb: 1,
                avgPerTestGb: 0.5,
                memorySampleCount: 2,
                memBoundGb: 10
            },
            afterRunComplete
        });
        try {
            const first = await runAgainstProtocolWorkers([peer(100)], {
                tasks: [MEASURED_TASK],
                run: { projectRoot: cacheDir, costCachePath }
            });
            expect(first.failure).to.equal(null);
            const original = fs.readFileSync(costCachePath);
            expect(
                JSON.parse(original.toString()).tasks["hardhat||measured"]
            ).to.include({
                samples: 1,
                durationMs: 100,
                avgCores: 0.25,
                peakRssGb: 0.5
            });
            // A new test is committed as measured, without run bookkeeping.
            const costsPath = path.join(cacheDir, "test-costs.json");
            const committed = fs.readFileSync(costsPath);
            expect(
                JSON.parse(committed.toString()).tasks["hardhat||measured"]
            ).to.deep.equal({
                durationMs: 100,
                avgCores: 0.25,
                peakRssGb: 0.5,
                measurementReason: null
            });
            const controller = new AbortController();
            await runAgainstProtocolWorkers(
                [peer(200, () => controller.abort())],
                {
                    tasks: [MEASURED_TASK],
                    run: {
                        projectRoot: cacheDir,
                        costCachePath,
                        signal: controller.signal
                    }
                }
            );
            expect(controller.signal.aborted).to.equal(true);
            expect(fs.readFileSync(costCachePath)).to.deep.equal(original);
            expect(fs.readFileSync(costsPath)).to.deep.equal(committed);
        } finally {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        }
    });

    it("retains exited child CPU and separates reused process identities", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "process-usage-"));
        try {
            fs.mkdirSync(path.join(root, "100"));
            fs.mkdirSync(path.join(root, "101"));
            const parent = Array(22).fill("0");
            parent[0] = "S";
            parent[1] = "1";
            parent[11] = "100";
            parent[13] = "9999";
            parent[19] = "1";
            const child = [...parent];
            child[1] = "100";
            child[11] = "200";
            child[19] = "2";
            fs.writeFileSync(
                path.join(root, "100", "stat"),
                `100 (parent (with spaces)) ${parent.join(" ")}\n`
            );
            fs.writeFileSync(
                path.join(root, "100", "status"),
                "VmRSS:\t1024 kB\n"
            );
            fs.writeFileSync(
                path.join(root, "101", "stat"),
                `101 (child) ${child.join(" ")}\n`
            );
            fs.writeFileSync(
                path.join(root, "101", "status"),
                "VmRSS:\t2048 kB\n"
            );
            const sampler = new TaskProcessSampler(100, {
                platform: "linux",
                procRoot: root
            });
            await Promise.all([sampler.sample(), sampler.sample()]);
            fs.rmSync(path.join(root, "101"), { recursive: true });
            await sampler.sample();
            expect(sampler.result(3000)).to.include({
                avgCores: 1,
                peakRssGb: 3 / 1024,
                measurementReason: null
            });
            fs.mkdirSync(path.join(root, "101"));
            child[11] = "50";
            child[19] = "3";
            fs.writeFileSync(
                path.join(root, "101", "stat"),
                `101 (reused) ${child.join(" ")}\n`
            );
            fs.writeFileSync(
                path.join(root, "101", "status"),
                "VmRSS:\t1024 kB\n"
            );
            await sampler.sample();
            expect(sampler.result(1000).avgCores).to.equal(3.5);
            const unavailable = new TaskProcessSampler(100, {
                platform: "linux",
                procRoot: path.join(root, "missing"),
                warn: () => {}
            });
            await unavailable.sample();
            expect(unavailable.result(1000)).to.deep.equal({
                peakRssGb: null,
                avgCores: null,
                measurementReason: "process-sampling-unavailable"
            });
            // A kernel thread or exiting process has no VmRSS: it holds no
            // user memory and must not void the whole scan.
            fs.writeFileSync(
                path.join(root, "101", "status"),
                "Name:\tkthread\n"
            );
            const rss = await rssByProcessTree([100], {
                platform: "linux",
                procRoot: root
            });
            expect(rss?.get(100)).to.equal(1 / 1024);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("skips a sample tick while a slow process scan is still running", async function () {
        let scans = 0;
        const sampler = new TaskProcessSampler(100, {
            execFile: async () => {
                scans++;
                await new Promise((resolve) => setTimeout(resolve, 50));
                return {
                    stdout: "  100     1  2048 0:01.00 Thu Oct  1 10:00:00 2026\n"
                };
            }
        });
        const first = sampler.sample();
        expect(sampler.sample()).to.equal(first);
        expect(sampler.sample()).to.equal(first);
        await first;
        await sampler.sample();
        expect(scans).to.equal(2);
        expect(sampler.result(1000)).to.include({
            avgCores: 1,
            peakRssGb: 2 / 1024
        });
    });

    it("samples a task early and backs off to the steady interval", function () {
        const delays = [100];
        for (let index = 0; index < 5; index++)
            delays.push(nextSampleDelayMs(delays[delays.length - 1]));
        expect(delays).to.deep.equal([100, 200, 400, 800, 1000, 1000]);
    });

    it("gives a test child and its worker threads the project's compile cache", async function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "compile-cache-"));
        // the test process may itself be a runner child -> drop the inherited path
        const inherited = process.env.NODE_COMPILE_CACHE;
        delete process.env.NODE_COMPILE_CACHE;
        try {
            const logPath = path.join(root, "child.ansi");
            const result = await runTask(
                process.execPath,
                [
                    "-e",
                    'const { Worker } = require("worker_threads");' +
                        "console.log(process.env.NODE_COMPILE_CACHE);" +
                        "new Worker('console.log(process.env.NODE_COMPILE_CACHE)', { eval: true });"
                ],
                {},
                "compile-cache",
                logPath
            );
            expect(result.code).to.equal(0);
            const cacheDirs = fs
                .readFileSync(logPath, "utf8")
                .trim()
                .split("\n");
            const projectCache = path.resolve("cache", "node-compile-cache");
            expect(cacheDirs).to.deep.equal([projectCache, projectCache]);
        } finally {
            if (inherited !== undefined)
                process.env.NODE_COMPILE_CACHE = inherited;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("parses fractional and day-prefixed ps CPU times", async function () {
        const sampler = new TaskProcessSampler(10, {
            platform: "darwin",
            execFile: async () =>
                "10 1 1024 1-02:03:04.5 Mon Jan 1 00:00:00 2024\n11 10 2048 00:00.5 Mon Jan 1 00:00:01 2024\n"
        });
        await sampler.sample();
        expect(sampler.result(1000)).to.deep.equal({
            peakRssGb: 3 / 1024,
            avgCores: 93785,
            measurementReason: null
        });
        const empty = new TaskProcessSampler(10, {
            platform: "darwin",
            execFile: async () => "",
            warn: () => {}
        });
        await empty.sample();
        expect(empty.result(1000).measurementReason).to.equal(
            "process-sampling-unavailable"
        );
    });

    it("integrates concurrency without changing the active assignment set at stop", async function () {
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const assignment = { id: "one" };
        const scheduler = new WorkerScheduler({
            retryMs: 1000,
            concurrencyCap: 1,
            canRun: async (running: number) => running === 0,
            requestTask: async () => assignment,
            runTask: async () => pending
        });
        await scheduler.requestWhenAvailable();
        await new Promise((resolve) => setTimeout(resolve, 20));
        scheduler.stop();
        expect(scheduler.runningAssignments.has(assignment)).to.equal(true);
        const stats = scheduler.stats();
        expect(stats.peakConcurrency).to.equal(1);
        expect(stats.concurrencyWallMs).to.be.greaterThan(0);
        expect(stats.meanConcurrency).to.be.greaterThan(0);
        release();
        await new Promise((resolve) => setImmediate(resolve));
        expect(scheduler.runningAssignments.size).to.equal(0);
        expect(scheduler.running).to.equal(0);
        expect(scheduler.stats()).to.deep.equal(stats);
    });

    it("uses parallel-runner defaults and accepts server-local short overrides", function () {
        expect(SERVER_DEFAULTS.slots).to.equal(1);
        expect(SERVER_DEFAULTS.workers).to.equal(40);
        expect(SERVER_DEFAULTS.schedulerTickMs).to.equal(1000);
        expect(
            parseServerArgs([
                "node",
                "server.js",
                "--name",
                "server-1",
                "--slots",
                "3",
                "-w",
                "6",
                "-i=250"
            ])
        ).to.include({ slots: 3, workers: 6, schedulerTickMs: 250 });
    });

    it("loads the worker name from the environment and lets the flag override it", function () {
        expect(
            parseServerArgs(["node", "server.js"], {
                SCP_TEST_WORKER_NAME: "server-1"
            }).name
        ).to.equal("server-1");
        expect(
            parseServerArgs(["node", "server.js", "--name", "server-2"], {
                SCP_TEST_WORKER_NAME: "server-1"
            }).name
        ).to.equal("server-2");
        expect(() => parseServerArgs(["node", "server.js"], {})).to.throw(
            "Worker name is required"
        );
    });

    it("selects Docker by default and supports explicit unsafe host execution", function () {
        expect(
            parseServerArgs(["node", "server.js"], {
                SCP_TEST_WORKER_NAME: "server-1"
            }).executionBackend
        ).to.equal("docker");
        expect(
            parseServerArgs(
                ["node", "server.js", "--execution-backend", "unsafe-host"],
                { SCP_TEST_WORKER_NAME: "server-1" }
            ).executionBackend
        ).to.equal("unsafe-host");
        expect(() =>
            parseServerArgs(
                ["node", "server.js", "--execution-backend", "unknown"],
                { SCP_TEST_WORKER_NAME: "server-1" }
            )
        ).to.throw("either docker or unsafe-host");
    });

    it("marks explicit authorization-policy startup overrides", function () {
        expect(
            parseServerArgs(
                ["node", "server.js", "--deny-unlisted-orchestrators"],
                { SCP_TEST_WORKER_NAME: "server-1" }
            )
        ).to.include({
            allowUnlistedOrchestrators: false,
            authorizationPolicyProvided: true
        });
        expect(
            parseServerArgs(
                ["node", "server.js", "--allow-unlisted-orchestrators"],
                { SCP_TEST_WORKER_NAME: "server-1" }
            )
        ).to.include({
            allowUnlistedOrchestrators: true,
            authorizationPolicyProvided: true
        });
    });

    it("requires a unique work root when host sharing is enabled", function () {
        expect(() =>
            parseServerArgs(["node", "server.js", "--allow-shared-host"], {
                SCP_TEST_WORKER_NAME: "server-1"
            })
        ).to.throw("requires an explicit --work-root");
        expect(
            parseServerArgs(
                [
                    "node",
                    "server.js",
                    "--allow-shared-host",
                    "--work-root",
                    "/tmp/server-1"
                ],
                { SCP_TEST_WORKER_NAME: "server-1" }
            )
        ).to.include({
            allowSharedHost: true,
            workRoot: "/tmp/server-1",
            workRootProvided: true
        });
    });

    it("reuses only funded account partitions", function () {
        const pool = new AccountPartitionPool(2);
        const first = pool.acquire();
        const second = pool.acquire();

        expect([first, second]).to.deep.equal([0, 1]);
        expect(() => pool.acquire()).to.throw(
            "No funded account partition is available"
        );
        pool.release(first);
        expect(pool.acquire()).to.equal(first);
        expect(accountPartitionFor({ id: 1 }, second)).to.equal(second);
        expect(accountPartitionFor(null, second)).to.equal(0);
    });

    it("reads container CPU use, pressure and throttling from its own cgroup and the host busy share beside it", function () {
        const files = (
            usage: number,
            pressure: number,
            throttled: number,
            hostIdle: number
        ) => ({
            "/proc/self/cgroup": "0::/\n",
            "/sys/fs/cgroup/cpu.stat": `usage_usec ${usage}\nuser_usec 1\nsystem_usec 1\nnr_periods 10\nnr_throttled ${throttled / 50000}\nthrottled_usec ${throttled}\n`,
            "/sys/fs/cgroup/cpu.pressure": `some avg10=0.00 avg60=0.00 avg300=0.00 total=${pressure}\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=${pressure / 2}\n`,
            "/sys/fs/cgroup/cpuset.cpus.effective": "0-6,7\n",
            "/proc/stat": `cpu 1000 0 500 ${hostIdle} 0 0 0 100 0 0\ncpu0 1 0 0 0 0 0 0 0 0 0\n`
        });
        const snapshotAt = (at: number, contents: Record<string, string>) =>
            readCpuSnapshot({
                platform: "linux",
                now: () => at,
                cpuCount: () => 99,
                readFile: (file: string) => {
                    if (!(file in contents)) throw new Error(`ENOENT ${file}`);
                    return contents[file];
                }
            });
        const first = snapshotAt(1000, files(1_000_000, 100_000, 0, 8000));
        const second = snapshotAt(
            2000,
            files(
                1_000_000 + 4_000_000,
                100_000 + 250_000,
                150_000,
                8000 + 1400
            )
        );
        expect(first.source).to.equal("cgroup");
        expect(first.cores).to.equal(8);
        const delta = cpuDelta(first, second);
        // 4 CPU-seconds over 1s of wall time on 8 cores
        expect(delta.cpuUtil).to.be.closeTo(0.5, 1e-9);
        expect(delta.cpuPressure).to.be.closeTo(0.25, 1e-9);
        expect(delta.cpuPressureFull).to.be.closeTo(0.125, 1e-9);
        expect(delta.throttledMs).to.equal(150);
        expect(delta.nrThrottled).to.equal(3);
        // host: 1400 idle of 1400 total jiffies elapsed -> nothing else ran
        expect(delta.hostCpuUtil).to.be.closeTo(0, 1e-9);
        expect(delta.hostSteal).to.equal(0);
    });

    it("falls back to the host CPU accounting with steal counted as busy, then to the platform times", function () {
        const hostOnly = (idle: number, steal: number) => ({
            "/proc/stat": `cpu 100 0 100 ${idle} 0 0 0 ${steal} 0 0\n`,
            "/proc/pressure/cpu":
                "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"
        });
        const snapshotAt = (at: number, contents: Record<string, string>) =>
            readCpuSnapshot({
                platform: "linux",
                now: () => at,
                cpuCount: () => 4,
                readFile: (file: string) => {
                    if (!(file in contents)) throw new Error(`ENOENT ${file}`);
                    return contents[file];
                }
            });
        const first = snapshotAt(0, hostOnly(1000, 0));
        // 100 idle and 100 stolen of 400 elapsed jiffies -> 75% busy, 25% steal
        const second = snapshotAt(1000, hostOnly(1100, 100));
        const withUser = (contents: Record<string, string>, user: number) => ({
            ...contents,
            "/proc/stat": contents["/proc/stat"].replace(
                "cpu 100",
                `cpu ${user}`
            )
        });
        const later = snapshotAt(1000, withUser(hostOnly(1100, 100), 300));
        expect(first.source).to.equal("host");
        expect(first.cores).to.equal(4);
        const delta = cpuDelta(first, later);
        expect(delta.cpuUtil).to.be.closeTo(0.75, 1e-9);
        expect(delta.hostSteal).to.be.closeTo(0.25, 1e-9);
        expect(delta.cpuPressure).to.equal(0);
        expect(delta.throttledMs).to.equal(undefined);
        expect(second.source).to.equal("host");
        const platform = readCpuSnapshot({
            platform: "darwin",
            readFile: () => {
                throw new Error("must not read files off Linux");
            }
        });
        expect(platform.source).to.equal("os");
        expect(platform.cores).to.be.greaterThan(0);
    });

    it("admits on the machine's busy share and reports the cgroup's own use and stall figures beside it", async function () {
        const contents: Record<string, string> = {
            "/proc/self/cgroup": "0::/\n",
            "/sys/fs/cgroup/cpu.stat":
                "usage_usec 0\nnr_periods 0\nnr_throttled 0\nthrottled_usec 0\n",
            "/sys/fs/cgroup/cpu.pressure":
                "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
            "/proc/stat": "cpu 0 0 0 1000 0 0 0 0 0 0\n"
        };
        let clock = 0;
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 1,
            memBoundGb: Number.MAX_SAFE_INTEGER,
            sampleOptions: {
                platform: "linux",
                now: () => clock,
                cpuCount: () => 2,
                readFile: (file: string) => {
                    if (!(file in contents)) throw new Error(`ENOENT ${file}`);
                    return contents[file];
                }
            }
        });
        clock = 1000;
        contents["/sys/fs/cgroup/cpu.stat"] =
            "usage_usec 1000000\nnr_periods 10\nnr_throttled 2\nthrottled_usec 80000\n";
        contents["/sys/fs/cgroup/cpu.pressure"] =
            "some avg10=0.00 avg60=0.00 avg300=0.00 total=300000\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=100000\n";
        contents["/proc/stat"] = "cpu 60 0 40 1050 0 0 0 0 0 0\n";
        expect(await resources.allows(1, 4)).to.equal(true);
        const stats = resources.stats();
        expect(stats.cpuSource).to.equal("cgroup");
        expect(stats.cpuCores).to.equal(2);
        // admission sees the machine: 100 busy of 150 elapsed jiffies
        expect(stats.peakCpu).to.be.closeTo(100 / 150, 1e-9);
        // this cgroup itself: 1 CPU-second on 2 cores in 1s
        expect(stats.peakContainerCpu).to.be.closeTo(0.5, 1e-9);
        expect(stats.peakCpuPressure).to.be.closeTo(0.3, 1e-9);
        expect(stats.peakCpuPressureFull).to.be.closeTo(0.1, 1e-9);
        expect(stats.throttledMs).to.equal(80);
        expect(stats.nrThrottled).to.equal(2);
        expect(stats.cpuPressureSampleCount).to.equal(1);
    });

    it("uses the shared always-one and process-cap admission rules", async function () {
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 1,
            memBoundGb: Number.MAX_SAFE_INTEGER
        });

        expect(await resources.allows(0, 1)).to.equal(true);
        expect(await resources.allows(1, 1)).to.equal(false);
        expect(resources.stats().peakCpu).to.be.a("number");
    });

    it("falls back conservatively and warns once when ps fails", async function () {
        resetResourceGateWarnings();
        const warnings: string[] = [];
        const resources = new ResourceGate({
            testPids: () => [process.pid],
            infraPids: () => [],
            targetLoad: 1,
            memBoundGb: 0,
            sampleOptions: {
                execFile: async () => {
                    throw new Error("ps unavailable");
                },
                warn: (message: string) => warnings.push(message)
            }
        });

        expect(await resources.allows(1, 2)).to.equal(false);
        expect(await resources.allows(1, 2)).to.equal(false);
        expect(resources.occupiedGb).to.be.greaterThan(0);
        expect(warnings).to.have.length(1);
    });

    it("accounts for a tracked task's memory-owning grandchild", async function () {
        const child = fork(
            path.join(__dirname, "fixtures", "resourceTreeChild.js"),
            [],
            { stdio: ["ignore", "ignore", "ignore", "ipc"] }
        );
        try {
            const sample = await new Promise<{
                parentRssKb: number;
                grandchildPid: number;
                grandchildRssKb: number;
            }>((resolve, reject) => {
                child.once("message", (message) =>
                    resolve(
                        message as {
                            parentRssKb: number;
                            grandchildPid: number;
                            grandchildRssKb: number;
                        }
                    )
                );
                child.once("error", reject);
            });
            expect(sample.grandchildRssKb).to.be.greaterThan(64 * 1024);
            const execFile = async (_command: string, args: string[]) => ({
                stdout: args.includes("-axo")
                    ? [
                          `${child.pid} ${process.pid} ${sample.parentRssKb}`,
                          `${sample.grandchildPid} ${child.pid} ${sample.grandchildRssKb}`
                      ].join("\n")
                    : `${child.pid} ${sample.parentRssKb}\n`
            });
            const direct = await rssByPid([child.pid], { execFile });
            const tree = await rssByProcessTree([child.pid], { execFile });
            expect(tree.get(child.pid)).to.be.greaterThan(
                direct.get(child.pid) + 0.03
            );
        } finally {
            child.send("stop");
            if (child.exitCode === null) {
                await new Promise((resolve) => child.once("exit", resolve));
            }
        }
    });

    it("builds the same complete slot environment for every scheduler", function () {
        expect(
            buildSlotEnv(
                {
                    nodeUrl: "node",
                    discoveryUrl: "discovery",
                    cacheDir: "cache"
                },
                3
            )
        ).to.deep.equal({
            PROVIDER_URL: "node",
            HARDHAT_NODE_URL: "node",
            LOCAL_DISCOVERY_REGISTRY_URL: "discovery",
            E2E_MANAGER_CACHE_DIR: "cache",
            E2E_INTERVAL_MINING: undefined,
            E2E_SLOT_INDEX: "3"
        });
        expect(buildSlotEnv(null, 0)).to.include({
            PROVIDER_URL: undefined,
            E2E_INTERVAL_MINING: undefined,
            E2E_SLOT_INDEX: "0"
        });
    });

    it("runs mixed local tasks without giving forge a slot or account partition", async function () {
        const logDir = path.join(
            process.cwd(),
            "logs",
            `scheduler-test-${process.pid}`
        );
        const calls: Array<{
            label: string;
            env: Record<string, string | undefined>;
        }> = [];
        const tasks = [
            {
                label: "forge:first",
                logName: "forge-first",
                runner: "forge",
                args: ["forge-test"]
            },
            {
                label: "hardhat:fails",
                logName: "hardhat-fails",
                runner: "hardhat",
                args: ["test"]
            },
            {
                label: "hardhat:after-failure",
                logName: "hardhat-after-failure",
                runner: "hardhat",
                args: ["test"]
            }
        ];
        const resourceGate = {
            cpuUtil: 0,
            occupiedGb: 0,
            allows: async () => true,
            stats: () => ({
                peakCpu: 0,
                avgCpu: 0,
                cpuSampleCount: 1,
                peakOccupiedGb: 0,
                avgPerTestGb: 0,
                memorySampleCount: 1,
                memBoundGb: 10
            })
        };
        try {
            const result = await runScheduler({
                tasks,
                slots: [
                    { id: 1, nodeUrl: "node-1", discoveryUrl: "d-1" },
                    { id: 2, nodeUrl: "node-2", discoveryUrl: "d-2" }
                ],
                slotCount: 2,
                concurrencyCap: 1,
                targetLoad: 1,
                memBoundGb: 10,
                baseEnv: { BASE_ONLY: "yes" },
                logDir,
                infraPids: () => [],
                tickMs: 1,
                accountPartitions: new AccountPartitionPool(1),
                resourceGate,
                projectRoot: logDir,
                costCachePath: path.join(logDir, "test-costs.json"),
                runTaskImpl: async (
                    _cmd: string,
                    _args: string[],
                    env: Record<string, string | undefined>,
                    label: string
                ) => {
                    calls.push({ label, env });
                    return {
                        code: label === "hardhat:fails" ? 1 : 0,
                        label,
                        stdout: "",
                        stderr: "",
                        durationMs: 1
                    };
                }
            });
            expect(result.completed).to.equal(3);
            expect(result.failed).to.have.length(1);
            expect(calls[0]).to.deep.equal({
                label: "forge:first",
                env: { BASE_ONLY: "yes" }
            });
            expect(calls[1].env).to.include({
                BASE_ONLY: "yes",
                PROVIDER_URL: "node-1",
                E2E_SLOT_INDEX: "0"
            });
            expect(calls[2].env).to.include({
                BASE_ONLY: "yes",
                PROVIDER_URL: "node-2",
                E2E_SLOT_INDEX: "0"
            });
        } finally {
            fs.rmSync(logDir, { recursive: true, force: true });
        }
    });

    it("retries and reports local signal exits as infrastructure failures", async function () {
        const logDir = path.join(
            process.cwd(),
            "logs",
            `scheduler-signal-${process.pid}`
        );
        const output: string[] = [];
        const originalConsoleLog = console.log;
        let attempts = 0;
        console.log = (...values: unknown[]) => output.push(values.join(" "));
        try {
            const result = await runScheduler({
                tasks: [
                    {
                        label: "local signal",
                        logName: "local-signal",
                        runner: "forge",
                        args: []
                    }
                ],
                slots: [],
                slotCount: 0,
                concurrencyCap: 1,
                targetLoad: 1,
                memBoundGb: 10,
                baseEnv: {},
                logDir,
                infraPids: () => [],
                tickMs: 1,
                projectRoot: logDir,
                costCachePath: path.join(logDir, "test-costs.json"),
                resourceGate: {
                    cpuUtil: 0,
                    occupiedGb: 0,
                    allows: async () => true,
                    stats: () => ({
                        peakCpu: 0,
                        avgCpu: 0,
                        cpuSampleCount: 1,
                        peakOccupiedGb: 0,
                        avgPerTestGb: 0,
                        memorySampleCount: 1,
                        memBoundGb: 10
                    })
                },
                runTaskImpl: async (
                    _cmd: string,
                    _args: string[],
                    _env: Record<string, string | undefined>,
                    label: string,
                    logPath: string
                ) => {
                    attempts += 1;
                    fs.mkdirSync(path.dirname(logPath), { recursive: true });
                    fs.writeFileSync(logPath, `attempt ${attempts}`);
                    return {
                        code: 1,
                        signal: "SIGKILL",
                        label,
                        stdout: "",
                        stderr: "",
                        durationMs: 1
                    };
                }
            });

            expect(attempts).to.equal(2);
            expect(result.failed).to.have.length(1);
            expect(output.join("\n")).to.include(
                "INFRASTRUCTURE FAILURE — rescheduling once"
            );
            expect(
                fs.readFileSync(getErrorLogPath(logDir, "local-signal"), "utf8")
            ).to.equal(
                "attempt 2\n\n##PARALLEL_RUNNER## Task process exited with signal SIGKILL\n"
            );
        } finally {
            console.log = originalConsoleLog;
            fs.rmSync(logDir, { recursive: true, force: true });
        }
    });

    it("releases distributed task resources after either failure or cancellation", function () {
        const pool = new TaskResourcePool({
            baseEnv: { BASE_ONLY: "yes" },
            slots: [
                { id: 1, nodeUrl: "node-1", discoveryUrl: "d-1" },
                { id: 2, nodeUrl: "node-2", discoveryUrl: "d-2" }
            ],
            accountPartitions: new AccountPartitionPool(1)
        });
        const forge = pool.acquire({ runner: "forge" });
        expect(forge).to.include({
            needsChain: false,
            accountPartition: null,
            slot: null
        });
        expect(forge.env).to.deep.equal({ BASE_ONLY: "yes" });
        forge.release();

        expect(pool.canAcquire({ runner: "hardhat" })).to.equal(true);
        const failed = pool.acquire({ runner: "hardhat" });
        expect(pool.canAcquire({ runner: "hardhat" })).to.equal(false);
        expect(pool.canAcquire(null)).to.equal(false);
        expect(pool.canAcquire({ runner: "forge" })).to.equal(true);
        expect(pool.canAcquire({ runner: "browser" })).to.equal(true);
        expect(failed.slot.id).to.equal(1);
        expect(failed.accountPartition).to.equal(0);
        expect(failed.env).to.include({
            BASE_ONLY: "yes",
            PROVIDER_URL: "node-1",
            LOCAL_DISCOVERY_REGISTRY_URL: "d-1",
            E2E_SLOT_INDEX: "0"
        });
        failed.release();
        expect(pool.canAcquire({ runner: "hardhat" })).to.equal(true);

        const cancelled = pool.acquire({ runner: "hardhat" });
        expect(cancelled.slot.id).to.equal(2);
        expect(cancelled.accountPartition).to.equal(0);
        cancelled.release();
    });

    it("keeps capacity alive after no work and accepts a nudge", async function () {
        let requests = 0;
        let ran = false;
        const scheduler = new WorkerScheduler({
            concurrencyCap: 1,
            retryMs: 10,
            canRun: async () => true,
            requestTask: async () =>
                ++requests === 1
                    ? null
                    : requests === 2
                      ? { id: "late" }
                      : null,
            runTask: async () => {
                ran = true;
            }
        });
        scheduler.start();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(scheduler.stopped).to.equal(false);
        scheduler.workAvailable();
        await new Promise((resolve) => setTimeout(resolve, 30));
        scheduler.stop();
        expect(requests).to.be.greaterThan(1);
        expect(ran).to.equal(true);
    });

    it("suppresses concurrent task requests and stops timer retries", async function () {
        let requests = 0;
        let release!: () => void;
        const response = new Promise<null>(
            (resolve) => (release = () => resolve(null))
        );
        const scheduler = new WorkerScheduler({
            concurrencyCap: 2,
            retryMs: 5,
            canRun: async () => true,
            requestTask: async () => {
                requests++;
                return response;
            },
            runTask: async () => {}
        });
        scheduler.start();
        scheduler.workAvailable();
        scheduler.workAvailable();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(requests).to.equal(1);
        release();
        scheduler.stop();
        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(requests).to.equal(1);
    });

    it("does not start an assignment returned after the scheduler stops", async function () {
        let release!: (assignment: { id: string }) => void;
        const assignment = new Promise<{ id: string }>(
            (resolve) => (release = resolve)
        );
        let ran = false;
        const scheduler = new WorkerScheduler({
            concurrencyCap: 1,
            retryMs: 5,
            canRun: async () => true,
            requestTask: async () => assignment,
            runTask: async () => {
                ran = true;
            }
        });

        scheduler.start();
        await new Promise((resolve) => setImmediate(resolve));
        scheduler.stop();
        release({ id: "assigned-before-infra-failure" });
        await new Promise((resolve) => setImmediate(resolve));

        expect(ran).to.equal(false);
        expect(scheduler.running).to.equal(0);
    });

    it("does not report an in-flight task rejection after the scheduler stops", async function () {
        let rejectTask!: (error: Error) => void;
        const task = new Promise<void>((_resolve, reject) => {
            rejectTask = reject;
        });
        const errors: Error[] = [];
        let requested = false;
        const scheduler = new WorkerScheduler({
            concurrencyCap: 1,
            retryMs: 5,
            canRun: async () => true,
            requestTask: async () => {
                if (requested) return null;
                requested = true;
                return { id: "running-at-stop" };
            },
            runTask: async () => task,
            onError: (error: Error) => errors.push(error)
        });

        scheduler.start();
        await new Promise((resolve) => setImmediate(resolve));
        expect(scheduler.running).to.equal(1);
        scheduler.stop();
        rejectTask(new Error("Distributed worker stopped"));
        await new Promise((resolve) => setImmediate(resolve));

        expect(errors).to.be.empty;
        expect(scheduler.running).to.equal(0);
    });

    it("buffers the next distributed assignment before capacity opens", async function () {
        const requested: string[] = [];
        const releases: Array<() => void> = [];
        let allowSecond = false;
        const scheduler = new WorkerScheduler({
            concurrencyCap: 2,
            retryMs: 5,
            prefetch: true,
            canRun: async (running: number) => running === 0 || allowSecond,
            requestTask: async () => {
                const id = String(requested.length + 1);
                requested.push(id);
                return requested.length <= 2 ? { id } : null;
            },
            runTask: async () =>
                new Promise<void>((resolve) => releases.push(resolve))
        });

        scheduler.start();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(requested).to.deep.equal(["1", "2"]);
        expect(scheduler.running).to.equal(1);
        expect(scheduler.bufferedCount).to.equal(1);
        expect(scheduler.bufferedAssignment.id).to.equal("2");

        allowSecond = true;
        scheduler.workAvailable();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(scheduler.running).to.equal(2);
        releases.forEach((release) => release());
        scheduler.stop();
    });

    it("paces successful admissions using the shared scheduler interval", async function () {
        const startedAt: number[] = [];
        const scheduler = new WorkerScheduler({
            concurrencyCap: 2,
            retryMs: 30,
            canRun: async () => true,
            requestTask: async () =>
                startedAt.length < 2 ? { id: startedAt.length + 1 } : null,
            runTask: async () => {
                startedAt.push(Date.now());
                await new Promise((resolve) => setTimeout(resolve, 60));
            }
        });

        scheduler.start();
        await new Promise((resolve) => setTimeout(resolve, 45));
        scheduler.stop();

        expect(startedAt).to.have.length(2);
        expect(startedAt[1] - startedAt[0]).to.be.greaterThanOrEqual(25);
    });
});
