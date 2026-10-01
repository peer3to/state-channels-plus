// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import {
    createLocalDhtNetwork,
    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
} from "../fixtures/distributed/testTransport";
import { expect } from "chai";
import { fork } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const {
    derivePoolKeys,
    authenticateServer
} = require("../../scripts/e2e-parallel/distributed/authentication.js");
const {
    runDistributed,
    validateWorkerStats
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    createPool
} = require("../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    ProtocolPeer,
    waitForMessage
} = require("../../scripts/e2e-parallel/distributed/protocol.js");
const {
    DEFAULTS: SERVER_DEFAULTS,
    parseServerArgs
} = require("../../scripts/e2e-parallel/distributed/serverArgParser.js");
const {
    toWireTask,
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
    processTreeUsage
} = require("../../scripts/e2e-parallel/shared/resourceGate.js");
const {
    buildSlotEnv
} = require("../../scripts/e2e-parallel/shared/scheduling.js");
const {
    TaskResourcePool
} = require("../../scripts/e2e-parallel/shared/taskResources.js");
const {
    WorkerScheduler
} = require("../../scripts/e2e-parallel/shared/workerScheduler.js");

describe("distributed worker scheduler", function () {
    it("accepts default FIFO and rejects invalid scheduling flags", function () {
        expect(parseCliArgs(["node", "runner"])).to.include({
            schedule: "fifo",
            costCachePath: ".cache/test-costs.json"
        });
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
                heavy: false,
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
            heavy: false
        });
        expect(fromWireTask(wire, root).cost).to.deep.equal(wire.cost);
        expect(
            fromWireTask(
                { ...wire, cost: { cores: 0, rssGb: 0, heavy: true } },
                root
            ).cost.heavy
        ).to.equal(true);
        for (const cost of [
            null,
            [],
            { cores: -1, rssGb: 0, heavy: false },
            { cores: NaN, rssGb: 0, heavy: false },
            { cores: Infinity, rssGb: 0, heavy: false },
            { cores: "1", rssGb: 0, heavy: false },
            { cores: 0, rssGb: -1, heavy: false },
            { cores: 0, rssGb: NaN, heavy: false },
            { cores: 0, rssGb: Infinity, heavy: false },
            { cores: 0, rssGb: "1", heavy: false },
            { cores: 0, rssGb: 0, heavy: 0 },
            { cores: 0, rssGb: 0 },
            { cores: 0, rssGb: 0, heavy: false, durationMs: 100 }
        ]) {
            expect(() => fromWireTask({ ...wire, cost }, root)).to.throw(
                "Invalid wire task cost"
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
                    nextCost: { cores: 0.1, rssGb: 0.5, heavy: false }
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
                    nextCost: { cores: 0.1, rssGb: 0.4 }
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
            for (const cost of [
                { cores: -1, rssGb: 0 },
                { cores: 0, rssGb: NaN },
                { cores: 0, rssGb: 0, heavy: "false" }
            ]) {
                let error: unknown;
                try {
                    await resources.allows(1, 4, {
                        schedule: "cost",
                        runningCost: { cores: 0, rssGb: 0 },
                        nextCost: cost
                    });
                } catch (caught) {
                    error = caught;
                }
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.equal(
                    "Invalid admission cost"
                );
            }
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
        const network = await createLocalDhtNetwork();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-metrics-"));
        const poolSecret = `worker-metrics-${process.pid}`;
        const keys = derivePoolKeys(poolSecret);
        const worker = await createPool({
            announceTopics: [keys.workerTopic],
            lookupTopics: [],
            dht: network.createNode(),
            refreshIntervalMs: 25
        });
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
        let rejectPeer!: (error: Error) => void;
        const peerFailure = new Promise<never>((_resolve, reject) => {
            rejectPeer = reject;
        });
        worker.onConnection(
            async (stream: unknown, info: { publicKey: Buffer }) => {
                const peer = new ProtocolPeer(stream);
                try {
                    await authenticateServer(
                        peer,
                        keys.authKey,
                        { local: worker.publicKey, remote: info.publicKey },
                        TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                    );
                    await peer.send("SERVER_READY", {
                        name: "metrics-peer",
                        capabilities: {
                            distributedProtocol: 14,
                            memoryGb: 10,
                            workers: 1,
                            slots: 0,
                            heartbeatTimeoutMs: 60000
                        }
                    });
                    await waitForMessage(peer, "LEASE_REQUEST");
                    await peer.send("LEASE_GRANTED", { capabilities: {} });
                    await waitForMessage(peer, "WORKSPACE_OFFER");
                    await peer.send(
                        "WORKSPACE_NEED",
                        {},
                        Buffer.from(
                            JSON.stringify({ changed: [], deleted: [] })
                        )
                    );
                    await waitForMessage(peer, "BUNDLE_END");
                    await peer.send("PREPARED");
                    await waitForMessage(peer, "RUN_CONFIG");
                    await peer.send("TASK_REQUEST", { requestId: 1 });
                    const message = await waitForMessage(
                        peer,
                        "TASK_ASSIGNMENT"
                    );
                    const completion = waitForMessage(peer, "RUN_COMPLETE");
                    await peer.send("ATTEMPT_RESULT", {
                        requestId: 2,
                        assignment: message.header.assignment,
                        logTransferred: false,
                        result: {
                            code: 0,
                            label: "measured",
                            durationMs: 100,
                            peakRssGb: 0.5,
                            avgCores: 0.25
                        }
                    });
                    await completion;
                    await peer.send("WORKER_STATS", { stats });
                    await peer.send("LEASE_CLEAN");
                } catch (error) {
                    rejectPeer(error as Error);
                }
            }
        );
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: 15,
            workspaceId: "a".repeat(64),
            sourceDigest: "b".repeat(64),
            rootProjectPath: ".",
            repositories: [],
            files: [],
            fileCount: 0,
            expandedBytes: 0
        };
        Object.defineProperty(manifest, "localWorkspaceRoot", { value: root });
        try {
            await Promise.race([
                runDistributed({
                    tasks: [
                        {
                            label: "measured",
                            logName: "measured",
                            args: [],
                            runner: "hardhat"
                        }
                    ],
                    projectRoot: root,
                    archivePath: path.join(root, "source.tgz"),
                    manifest,
                    logDir: root,
                    poolSecret,
                    discoveryTimeoutMs: 3000,
                    discoveryRefreshMs: 25,
                    baseEnv: {},
                    dht: network.createNode()
                }),
                peerFailure
            ]);
            const metrics = JSON.parse(
                fs.readFileSync(path.join(root, "run-metrics.json"), "utf8")
            );
            expect(metrics.workers).to.have.length(1);
            expect(metrics.workers[0].holdCounts).to.deep.equal({
                cap: 2,
                memory: 3,
                cpu: 4
            });
            expect(metrics.workers[0]).to.include({
                meanConcurrency: 1,
                peakConcurrency: 1,
                concurrencyWallMs: 100,
                legacyAdmission: true
            });
            expect(metrics.tasks[0]).to.include({
                peakRssGb: 0.5,
                avgCores: 0.25
            });
        } finally {
            await worker.close();
            await network.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
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
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps protocol fourteen on legacy admission with cost selection", async function () {
        const network = await createLocalDhtNetwork();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "legacy-cost-selection-")
        );
        const poolSecret = `legacy-cost-${process.pid}`;
        const keys = derivePoolKeys(poolSecret);
        const worker = await createPool({
            announceTopics: [keys.workerTopic],
            lookupTopics: [],
            dht: network.createNode(),
            refreshIntervalMs: 25
        });
        fs.writeFileSync(
            path.join(root, "overrides.json"),
            JSON.stringify({
                "hardhat||light": { durationMs: 100 },
                "hardhat||long": { durationMs: 1000 }
            })
        );
        const labels: string[] = [];
        const wireCosts: unknown[] = [];
        let rejectPeer!: (error: Error) => void;
        const peerFailure = new Promise<never>((_resolve, reject) => {
            rejectPeer = reject;
        });
        worker.onConnection(
            async (stream: unknown, info: { publicKey: Buffer }) => {
                const peer = new ProtocolPeer(stream);
                try {
                    await authenticateServer(
                        peer,
                        keys.authKey,
                        { local: worker.publicKey, remote: info.publicKey },
                        TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                    );
                    await peer.send("SERVER_READY", {
                        name: "legacy-peer",
                        capabilities: {
                            distributedProtocol: 14,
                            memoryGb: 10,
                            workers: 1,
                            slots: 0,
                            heartbeatTimeoutMs: 60000
                        }
                    });
                    await waitForMessage(peer, "LEASE_REQUEST");
                    await peer.send("LEASE_GRANTED", { capabilities: {} });
                    await waitForMessage(peer, "WORKSPACE_OFFER");
                    await peer.send(
                        "WORKSPACE_NEED",
                        {},
                        Buffer.from(
                            JSON.stringify({ changed: [], deleted: [] })
                        )
                    );
                    await waitForMessage(peer, "BUNDLE_END");
                    await peer.send("PREPARED");
                    await waitForMessage(peer, "RUN_CONFIG");
                    let completion: Promise<unknown> | undefined;
                    for (let index = 0; index < 2; index++) {
                        const next = waitForMessage(peer, "TASK_ASSIGNMENT");
                        await peer.send("TASK_REQUEST", {
                            requestId: index + 1
                        });
                        const message = await next;
                        labels.push(message.header.assignment.task.label);
                        wireCosts.push(message.header.assignment.task.cost);
                        if (index === 1)
                            completion = waitForMessage(peer, "RUN_COMPLETE");
                        await peer.send("ATTEMPT_RESULT", {
                            assignment: message.header.assignment,
                            logTransferred: false,
                            result: {
                                code: 0,
                                label: message.header.assignment.task.label,
                                durationMs: 100,
                                peakRssGb: 0.5,
                                avgCores: 0.25
                            }
                        });
                    }
                    await completion;
                    await peer.send("WORKER_STATS", {
                        stats: {
                            peakCpu: 0.5,
                            avgCpu: 0.25,
                            cpuSampleCount: 2,
                            peakOccupiedGb: 1,
                            avgPerTestGb: 0.5,
                            memorySampleCount: 2,
                            memBoundGb: 10
                        }
                    });
                    await peer.send("LEASE_CLEAN");
                } catch (error) {
                    rejectPeer(error as Error);
                }
            }
        );
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: 15,
            workspaceId: "a".repeat(64),
            sourceDigest: "b".repeat(64),
            rootProjectPath: ".",
            repositories: [],
            files: [],
            fileCount: 0,
            expandedBytes: 0
        };
        Object.defineProperty(manifest, "localWorkspaceRoot", { value: root });
        try {
            const cli = parseCliArgs(["node", "runner", "--schedule", "cost"]);
            await Promise.race([
                runDistributed({
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
                    schedule: cli.schedule,
                    costOverridesPath: "overrides.json",
                    projectRoot: root,
                    archivePath: path.join(root, "source.tgz"),
                    manifest,
                    logDir: root,
                    poolSecret,
                    discoveryTimeoutMs: 3000,
                    discoveryRefreshMs: 25,
                    baseEnv: {},
                    dht: network.createNode()
                }),
                peerFailure
            ]);
            expect(labels).to.deep.equal(["long", "light"]);
            expect(wireCosts).to.deep.equal([undefined, undefined]);
            const metrics = JSON.parse(
                fs.readFileSync(path.join(root, "run-metrics.json"), "utf8")
            );
            expect(metrics.workers).to.have.length(1);
            expect(metrics.workers[0]).to.include({
                legacyAdmission: true,
                meanConcurrency: null,
                peakConcurrency: null,
                concurrencyWallMs: null,
                measurementReason: "legacy-worker-stats-unavailable"
            });
            expect(metrics.workers[0].holdCounts).to.deep.equal({
                cap: null,
                memory: null,
                cpu: null
            });
        } finally {
            await worker.close();
            await network.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("writes distributed finalizing samples and skips aborted commits", async function () {
        const network = await createLocalDhtNetwork();
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "distributed-cost-cache-")
        );
        const poolSecret = `cost-cache-${process.pid}`;
        const keys = derivePoolKeys(poolSecret);
        const worker = await createPool({
            announceTopics: [keys.workerTopic],
            lookupTopics: [],
            dht: network.createNode(),
            refreshIntervalMs: 25
        });
        let interrupt = false;
        const controller = new AbortController();
        let rejectPeer!: (error: Error) => void;
        const peerFailure = new Promise<never>((_resolve, reject) => {
            rejectPeer = reject;
        });
        worker.onConnection(
            async (stream: unknown, info: { publicKey: Buffer }) => {
                const peer = new ProtocolPeer(stream);
                try {
                    await authenticateServer(
                        peer,
                        keys.authKey,
                        { local: worker.publicKey, remote: info.publicKey },
                        TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                    );
                    await peer.send("SERVER_READY", {
                        name: "cache-peer",
                        capabilities: {
                            distributedProtocol: 15,
                            memoryGb: 10,
                            workers: 1,
                            slots: 0,
                            heartbeatTimeoutMs: 60000
                        }
                    });
                    await waitForMessage(peer, "LEASE_REQUEST");
                    await peer.send("LEASE_GRANTED", { capabilities: {} });
                    await waitForMessage(peer, "WORKSPACE_OFFER");
                    await peer.send(
                        "WORKSPACE_NEED",
                        {},
                        Buffer.from(
                            JSON.stringify({ changed: [], deleted: [] })
                        )
                    );
                    await waitForMessage(peer, "BUNDLE_END");
                    await peer.send("PREPARED");
                    await waitForMessage(peer, "RUN_CONFIG");
                    await peer.send("TASK_REQUEST", { requestId: 1 });
                    const message = await waitForMessage(
                        peer,
                        "TASK_ASSIGNMENT"
                    );
                    const completion = waitForMessage(peer, "RUN_COMPLETE");
                    await peer.send("ATTEMPT_RESULT", {
                        requestId: 2,
                        assignment: message.header.assignment,
                        logTransferred: false,
                        result: {
                            code: 0,
                            label: "measured",
                            durationMs: interrupt ? 200 : 100,
                            peakRssGb: 0.5,
                            avgCores: 0.25
                        }
                    });
                    await completion;
                    if (interrupt) controller.abort();
                    await peer.send("WORKER_STATS", {
                        stats: {
                            peakCpu: 0.5,
                            avgCpu: 0.25,
                            cpuSampleCount: 2,
                            peakOccupiedGb: 1,
                            avgPerTestGb: 0.5,
                            memorySampleCount: 2,
                            memBoundGb: 10
                        }
                    });
                    await peer.send("LEASE_CLEAN");
                } catch (error) {
                    rejectPeer(error as Error);
                }
            }
        );
        const manifest = {
            version: 3,
            packageManager: "pnpm",
            distributedProtocol: 15,
            workspaceId: "a".repeat(64),
            sourceDigest: "b".repeat(64),
            rootProjectPath: ".",
            repositories: [],
            files: [],
            fileCount: 0,
            expandedBytes: 0
        };
        Object.defineProperty(manifest, "localWorkspaceRoot", { value: root });
        try {
            await Promise.race([
                runDistributed({
                    tasks: [
                        {
                            label: "measured",
                            logName: "measured",
                            args: [],
                            runner: "hardhat"
                        }
                    ],
                    projectRoot: root,
                    archivePath: path.join(root, "source.tgz"),
                    manifest,
                    logDir: root,
                    poolSecret,
                    discoveryTimeoutMs: 3000,
                    discoveryRefreshMs: 25,
                    baseEnv: {},
                    dht: network.createNode()
                }),
                peerFailure
            ]);
            const cachePath = path.join(root, ".cache/test-costs.json");
            const original = fs.readFileSync(cachePath);
            const entry = JSON.parse(original.toString()).tasks[
                "hardhat||measured"
            ];
            expect(entry).to.include({
                samples: 1,
                durationMs: 100,
                avgCores: 0.25,
                peakRssGb: 0.5
            });
            interrupt = true;
            await Promise.race([
                runDistributed({
                    tasks: [
                        {
                            label: "measured",
                            logName: "measured",
                            args: [],
                            runner: "hardhat"
                        }
                    ],
                    projectRoot: root,
                    archivePath: path.join(root, "source.tgz"),
                    manifest,
                    logDir: root,
                    poolSecret,
                    discoveryTimeoutMs: 3000,
                    discoveryRefreshMs: 25,
                    baseEnv: {},
                    signal: controller.signal,
                    dht: network.createNode()
                }),
                peerFailure
            ]);
            expect(controller.signal.aborted).to.equal(true);
            expect(fs.readFileSync(cachePath)).to.deep.equal(original);
        } finally {
            await worker.close();
            await network.close();
            fs.rmSync(root, { recursive: true, force: true });
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
            fs.writeFileSync(path.join(root, "101", "status"), "malformed");
            expect(
                await processTreeUsage([100], {
                    platform: "linux",
                    procRoot: root,
                    warn: () => {}
                })
            ).to.equal(null);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("parses fractional and day-prefixed ps CPU times", async function () {
        const usage = await processTreeUsage([10], {
            platform: "darwin",
            execFile: async () =>
                "10 1 1024 1-02:03:04.5 Mon Jan 1 00:00:00 2024\n11 10 2048 00:00.5 Mon Jan 1 00:00:01 2024\n"
        });
        expect(usage.get(10)).to.deep.equal({
            rssGb: 3 / 1024,
            cpuSeconds: 93785
        });
        expect(
            await processTreeUsage([10], {
                platform: "darwin",
                execFile: async () => "",
                warn: () => {}
            })
        ).to.equal(null);
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

        const failed = pool.acquire({ runner: "hardhat" });
        expect(failed.slot.id).to.equal(1);
        expect(failed.accountPartition).to.equal(0);
        expect(failed.env).to.include({
            BASE_ONLY: "yes",
            PROVIDER_URL: "node-1",
            LOCAL_DISCOVERY_REGISTRY_URL: "d-1",
            E2E_SLOT_INDEX: "0"
        });
        failed.release();

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
