import { expect } from "chai";

const {
    WorkerScheduler
} = require("../../scripts/e2e-parallel/shared/workerScheduler.js");
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("../../scripts/e2e-parallel/shared/accountPartitionPool.js");
const {
    ResourceGate
} = require("../../scripts/e2e-parallel/shared/resourceGate.js");
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
                "--slots",
                "3",
                "-w",
                "6",
                "-i=250"
            ])
        ).to.include({ slots: 3, workers: 6, schedulerTickMs: 250 });
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

    it("uses the shared always-one and process-cap admission rules", function () {
        const resources = new ResourceGate({
            testPids: () => [],
            infraPids: () => [],
            targetLoad: 1,
            memBoundGb: Number.MAX_SAFE_INTEGER
        });

        expect(resources.allows(0, 1)).to.equal(true);
        expect(resources.allows(1, 1)).to.equal(false);
        expect(resources.stats().peakCpu).to.be.a("number");
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
