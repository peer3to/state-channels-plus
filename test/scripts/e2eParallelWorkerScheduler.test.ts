// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { fork } from "child_process";
import fs from "fs";
import path from "path";

const {
    WorkerScheduler
} = require("../../scripts/e2e-parallel/shared/workerScheduler.js");
const {
    runScheduler
} = require("../../scripts/e2e-parallel/local/scheduler.js");
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("../../scripts/e2e-parallel/shared/accountPartitionPool.js");
const {
    resetResourceGateWarnings,
    ResourceGate,
    rssByPid,
    rssByProcessTree
} = require("../../scripts/e2e-parallel/shared/resourceGate.js");
const {
    buildSlotEnv
} = require("../../scripts/e2e-parallel/shared/scheduling.js");
const {
    TaskResourcePool
} = require("../../scripts/e2e-parallel/shared/taskResources.js");
const {
    DEFAULTS: SERVER_DEFAULTS,
    parseServerArgs
} = require("../../scripts/e2e-parallel/distributed/serverArgParser.js");

describe("distributed worker scheduler", function () {
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
