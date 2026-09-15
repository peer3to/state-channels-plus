import { createWorkerShutdown } from "@/evm/node/workerShutdown";
import { createDrainingWorker } from "@test/fixtures/node/DrainingWorkerFixture";
import { assertWorkerLimit } from "@test/fixtures/node/WorkerResourceLimitsFixture";
import { expect } from "chai";
import { Worker } from "node:worker_threads";

describe("workerShutdown", function () {
    it("resolves once the worker drains its loop and exits", async function () {
        const worker = createDrainingWorker();
        const shutdown = createWorkerShutdown(worker);

        worker.postMessage("dispose");
        await shutdown();

        expect(worker.threadId).to.equal(-1);
    });

    it("resolves immediately for an already-exited worker", async function () {
        const worker = new Worker(
            `const { parentPort } = require("node:worker_threads"); parentPort.close();`,
            { eval: true }
        );
        await new Promise<void>((resolve) =>
            worker.once("exit", () => resolve())
        );

        await createWorkerShutdown(worker)();
        expect(worker.threadId).to.equal(-1);
    });

    it("waits for a slow drain instead of abandoning the worker", async function () {
        const worker = new Worker(
            `
                const { parentPort } = require("node:worker_threads");
                parentPort.once("message", () =>
                    setTimeout(() => parentPort.close(), 200)
                );
            `,
            { eval: true }
        );
        const shutdown = createWorkerShutdown(worker);

        worker.postMessage("dispose");
        await shutdown();

        expect(worker.threadId).to.equal(-1);
    });

    it("completes concurrent shutdowns independently", async function () {
        const workers = Array.from({ length: 10 }, () =>
            createDrainingWorker()
        );

        await Promise.all(
            workers.map((worker) => {
                const shutdown = createWorkerShutdown(worker);
                worker.postMessage("dispose");
                return shutdown();
            })
        );

        expect(workers.every((worker) => worker.threadId === -1)).to.equal(
            true
        );
    });
});

describe("Worker resource policy", () => {
    it("uses the shared default when no override exists", () => {
        assertWorkerLimit(undefined, 1024);
    });
    it("uses a finite positive override", () => {
        assertWorkerLimit("256", 256);
    });
    it("disables the cap for zero", () => {
        assertWorkerLimit("0", undefined);
    });
    it("disables the cap for a negative override", () => {
        assertWorkerLimit("-1", undefined);
    });
    it("falls back for a non-finite override", () => {
        assertWorkerLimit("Infinity", 1024);
    });
    it("falls back for an invalid override", () => {
        assertWorkerLimit("invalid", 1024);
    });
});
