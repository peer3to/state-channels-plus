import { expect } from "chai";
import { ethers } from "ethers";
import { Address } from "@ethereumjs/util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { BroadcastChannel, Worker } from "node:worker_threads";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import {
    createContractExecutorFactory,
    type ContractExecutorFactoryOptions,
    type EvmCustomPrecompileManifest
} from "@/evm";
import { createContractExecutorWorkerFromPath } from "@/evm/contractExecutor/node/ContractExecutorWorkerRuntime";
import type { WatchdogWorkerData } from "@test/evm/workers/node/watchdogContractExecutorWorkerEntry";
import type { NoRouteWorkerReport } from "@test/evm/workers/node/noRouteExecutorEntry";
import type { Logger } from "@/utils";
import {
    WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS,
    WATCHDOG_WORKER_ORIGINAL_ERROR,
    WATCHDOG_WORKER_TRIPPED_DELAY_MS
} from "@test/evm/workers/watchdogContractExecutorWorkerCore";
import { sleep } from "@/utils";
import { waitFor } from "@test/utils/waitFor";

const WATCHDOG_WORKER_ENTRY = path.resolve(
    __dirname,
    "workers/node/watchdogContractExecutorWorkerEntry.ts"
);
const NO_ROUTE_EXECUTOR_ENTRY = path.resolve(
    __dirname,
    "workers/node/noRouteExecutorEntry.ts"
);

/** The scripted worker runtime for one executor, selected by `mode`. */
function watchdogWorkerRuntime(mode: WatchdogWorkerData["mode"]) {
    const armChannel = `watchdog-arm-${randomUUID()}`;
    const workerData: WatchdogWorkerData = { mode, armChannel };
    return {
        armChannel,
        createWorkerRuntime: (
            onMessage: Parameters<
                typeof createContractExecutorWorkerFromPath
            >[1],
            onError: Parameters<typeof createContractExecutorWorkerFromPath>[2]
        ) =>
            createContractExecutorWorkerFromPath(
                WATCHDOG_WORKER_ENTRY,
                onMessage,
                onError,
                workerData
            )
    };
}

describe("WorkerContractExecutor", function () {
    const createLogOnlyInitCode = (topic: string) => {
        const runtime = `0x602a6000527f${topic.slice(2)}60206000a160006000f3`;
        const runtimeBytes = ethers.getBytes(runtime);
        const runtimeSize = runtimeBytes.length.toString(16).padStart(2, "0");
        const header = `0x60${runtimeSize}600c60003960${runtimeSize}6000f3`;
        return `${header}${runtime.slice(2)}`;
    };

    it("should execute custom precompiles in worker mode", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bb"
        );
        const customPrecompile: EvmCustomPrecompileManifest = {
            address: customAddress.toString(),
            module: path.resolve(
                __dirname,
                "../fixtures/workerAnswerPrecompile.ts"
            ),
            options: {
                expectedData: "0x1234",
                value: "42"
            }
        };

        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            customPrecompiles: [customPrecompile]
        });

        try {
            const result = await executor.simulateCall(
                "0x1234",
                customAddress.toString()
            );

            const [value, isMainThread] =
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["uint256", "bool"],
                    result.returnValue
                );
            expect(value).to.equal(42n);
            expect(isMainThread).to.equal(
                false,
                "precompile should execute inside the worker thread"
            );
        } finally {
            await executor.dispose();
        }
    });

    it("should wait for precompile readiness before returning", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bd"
        );
        let resolved = false;
        const creating = createContractExecutorFactory({
            dedicatedThread: true,
            customPrecompiles: [
                {
                    address: customAddress.toString(),
                    module: path.resolve(
                        __dirname,
                        "../fixtures/workerAnswerPrecompile.ts"
                    ),
                    options: {
                        delayMs: 100,
                        expectedData: "0x1234",
                        value: "42"
                    }
                }
            ]
        }).then((executor) => {
            resolved = true;
            return executor;
        });

        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(resolved).to.equal(false);

        const executor = await creating;
        try {
            const result = await executor.simulateCall(
                "0x1234",
                customAddress.toString()
            );
            const [value] = ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256", "bool"],
                result.returnValue
            );
            expect(value).to.equal(42n);
        } finally {
            await executor.dispose();
        }
    });

    it("should correlate a worker error with a concurrent successful response", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000be"
        );
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            customPrecompiles: [
                {
                    address: customAddress.toString(),
                    module: path.resolve(
                        __dirname,
                        "../fixtures/workerAnswerPrecompile.ts"
                    ),
                    options: {
                        expectedData: "0x1234",
                        value: "42"
                    }
                }
            ]
        });

        try {
            const [failed, succeeded] = await Promise.allSettled([
                executor.simulateCall("0xabcd", customAddress.toString()),
                executor.simulateCall("0x1234", customAddress.toString())
            ]);

            expect(failed.status).to.equal("rejected");
            if (failed.status !== "rejected") {
                throw new Error("Expected the invalid worker request to fail");
            }
            expect(failed.reason).to.be.instanceOf(Error);
            expect((failed.reason as Error).message).to.equal(
                "Unexpected precompile calldata"
            );

            expect(succeeded.status).to.equal("fulfilled");
            if (succeeded.status !== "fulfilled") {
                throw new Error("Expected the valid worker request to succeed");
            }
            const [value] = ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256", "bool"],
                succeeded.value.returnValue
            );
            expect(value).to.equal(42n);
        } finally {
            await executor.dispose();
        }
    });

    it("should return RPC-style logs from the worker", async function () {
        const executor = await createContractExecutorFactory({
            dedicatedThread: true
        });
        const contractInterface = new ethers.Interface([
            "event ValueSet(uint256 value)"
        ]);
        const topic = ethers.id("ValueSet(uint256)");

        try {
            const deployment = await executor.deploy(
                createLogOnlyInitCode(topic)
            );
            const result = await executor.executeCall(
                "0x",
                deployment.createdAddress!
            );
            const [log] = result.logs ?? [];
            expect(log).to.not.be.undefined;
            if (!log) throw new Error("Expected one contract execution log");

            expect(Array.isArray(log)).to.equal(false);
            expect(log.address).to.equal(deployment.createdAddress);
            expect(log.topics).to.deep.equal([topic]);
            expect(log.data).to.equal(
                ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [42n])
            );

            const parsed = contractInterface.parseLog(log);
            expect(parsed?.name).to.equal("ValueSet");
            expect(parsed?.args[0]).to.equal(42n);
        } finally {
            await executor.dispose();
        }
    });

    it("should dispose idempotently", async function () {
        const executor = await createContractExecutorFactory({
            dedicatedThread: true
        });

        await executor.dispose();
        await executor.dispose();
    });

    it("should reject calls immediately after disposal", async function () {
        const executor = await createContractExecutorFactory({
            dedicatedThread: true
        });
        await executor.dispose();

        try {
            await executor.executeCall(
                "0x",
                "0x0000000000000000000000000000000000000001"
            );
            expect.fail("executeCall should reject after disposal");
        } catch (error) {
            expect((error as Error).message).to.equal(
                "Contract executor worker disposed"
            );
        }
    });

    async function expectSimulationsSerializeWithLocalWrites(
        dedicatedThread: boolean
    ) {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bc"
        );
        const customPrecompile: EvmCustomPrecompileManifest = {
            address: customAddress.toString(),
            module: path.resolve(
                __dirname,
                "../fixtures/workerConcurrencyPrecompile.ts"
            ),
            options: { delayMs: 50 }
        };
        const executor = await createContractExecutorFactory({
            dedicatedThread,
            customPrecompiles: [customPrecompile]
        });

        try {
            const simulation = executor.simulateCall(
                "0x1234",
                customAddress.toString()
            );
            const write = executor.executeCall(
                "0x5678",
                customAddress.toString()
            );
            const results = await Promise.all([simulation, write]);

            for (const result of results) {
                const [maximumActiveCalls] =
                    ethers.AbiCoder.defaultAbiCoder().decode(
                        ["uint256"],
                        result.returnValue
                    );
                expect(maximumActiveCalls).to.equal(1n);
            }
        } finally {
            await executor.dispose();
        }
    }

    it("should serialize simulations with local writes (inline)", async function () {
        await expectSimulationsSerializeWithLocalWrites(false);
    });

    it("should serialize simulations with local writes (worker)", async function () {
        await expectSimulationsSerializeWithLocalWrites(true);
    });

    describe("detached worker errors", function () {
        it("reports a watchdog trip once with its delay data and keeps serving", async function () {
            const { armChannel, createWorkerRuntime } =
                watchdogWorkerRuntime("watchdog");
            const reports: Error[] = [];
            const executor = await createContractExecutor(
                { dedicatedThread: true },
                {
                    createWorkerRuntime,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const sender = new BroadcastChannel(armChannel);
            try {
                await sleep(300);
                expect(reports.length).to.equal(0);

                sender.postMessage({ type: "arm" });
                await waitFor(() => reports.length >= 1, 10_000, 50);
                const [report] = reports;
                expect(report.message).to.equal(
                    `Event loop delay ${WATCHDOG_WORKER_TRIPPED_DELAY_MS}ms exceeded configured threshold ${WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS}ms`
                );
                expect(
                    (report as Error & { eventLoopDelay?: unknown })
                        .eventLoopDelay
                ).to.deep.include({
                    runtime: "node",
                    dMax: WATCHDOG_WORKER_TRIPPED_DELAY_MS,
                    delayErrorThresholdMs:
                        WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS
                });

                // The worker kept its EVM and still serves after the report.
                const deployment = await executor.deploy(
                    createLogOnlyInitCode(ethers.id("ValueSet(uint256)"))
                );
                expect(deployment.createdAddress).to.be.a("string");
                await sleep(200);
                expect(reports.length).to.equal(1);
            } finally {
                sender.close();
                await executor.dispose();
            }
        });

        it("reports an autonomous throw once and keeps serving", async function () {
            const { armChannel, createWorkerRuntime } =
                watchdogWorkerRuntime("throw");
            const reports: Error[] = [];
            const executor = await createContractExecutor(
                { dedicatedThread: true },
                {
                    createWorkerRuntime,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const sender = new BroadcastChannel(armChannel);
            try {
                sender.postMessage({ type: "arm" });
                await waitFor(() => reports.length >= 1, 10_000, 50);
                expect(reports[0].message).to.equal(
                    WATCHDOG_WORKER_ORIGINAL_ERROR
                );
                const deployment = await executor.deploy(
                    createLogOnlyInitCode(ethers.id("ValueSet(uint256)"))
                );
                expect(deployment.createdAddress).to.be.a("string");
                expect(reports.length).to.equal(1);
            } finally {
                sender.close();
                await executor.dispose();
            }
        });

        it("fails every pending and later call when the worker exits after readiness", async function () {
            const { armChannel, createWorkerRuntime } =
                watchdogWorkerRuntime("exit");
            const reports: Error[] = [];
            const executor = await createContractExecutor(
                { dedicatedThread: true },
                {
                    createWorkerRuntime,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const sender = new BroadcastChannel(armChannel);
            try {
                sender.postMessage({ type: "arm" });
                let failure: unknown;
                await waitFor(
                    async () => {
                        try {
                            await executor.executeCall(
                                "0x",
                                "0x0000000000000000000000000000000000000001"
                            );
                            return false;
                        } catch (error) {
                            failure = error;
                            return true;
                        }
                    },
                    10_000,
                    50
                );
                expect((failure as Error).message).to.equal(
                    "Contract executor worker exited with 0"
                );
                // The exit is fatal, never a detached report.
                expect(reports.length).to.equal(0);
                try {
                    await executor.executeCall(
                        "0x",
                        "0x0000000000000000000000000000000000000001"
                    );
                    expect.fail("calls after a worker exit must reject");
                } catch (error) {
                    expect((error as Error).message).to.equal(
                        "Contract executor worker exited with 0"
                    );
                }
            } finally {
                sender.close();
                await executor.dispose();
            }
        });

        it("rejects creation when the worker fails before its funnel exists", async function () {
            const { createWorkerRuntime } = watchdogWorkerRuntime("prefunnel");
            const reports: Error[] = [];
            let failure: unknown;
            try {
                await createContractExecutor(
                    { dedicatedThread: true },
                    {
                        createWorkerRuntime,
                        onDetachedError: (error) => {
                            reports.push(error);
                        }
                    }
                );
                expect.fail("creation must reject");
            } catch (error) {
                failure = error;
            }
            expect((failure as Error).message).to.equal(
                "Stubbed pre-funnel worker failure"
            );
            expect(reports.length).to.equal(0);
        });

        it("fails a request that is in flight when the worker exits, with the exit as the cause", async function () {
            const { armChannel, createWorkerRuntime } =
                watchdogWorkerRuntime("exit-pending");
            const reports: Error[] = [];
            const executor = await createContractExecutor(
                { dedicatedThread: true },
                {
                    createWorkerRuntime,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const sender = new BroadcastChannel(armChannel);
            try {
                // The scripted worker swallows this call, so it stays pending
                // until the exit settles it.
                const pending = executor.executeCall(
                    "0x",
                    "0x0000000000000000000000000000000000000001"
                );
                let settled = false;
                void pending.then(
                    () => {
                        settled = true;
                    },
                    () => {
                        settled = true;
                    }
                );
                await sleep(300);
                expect(settled).to.equal(false);
                sender.postMessage({ type: "arm" });
                let failure: unknown;
                try {
                    await pending;
                    expect.fail("the in-flight call must reject on exit");
                } catch (error) {
                    failure = error;
                }
                expect((failure as Error).message).to.equal(
                    "Contract executor worker exited with 0"
                );
                try {
                    await executor.executeCall(
                        "0x",
                        "0x0000000000000000000000000000000000000001"
                    );
                    expect.fail("calls after a worker exit must reject");
                } catch (error) {
                    expect((error as Error).message).to.equal(
                        "Contract executor worker exited with 0"
                    );
                }
                expect(reports.length).to.equal(0);
            } finally {
                sender.close();
                await executor.dispose();
            }
        });

        it("reports an error thrown right after the host starts, before any request", async function () {
            const { createWorkerRuntime } = watchdogWorkerRuntime("post-start");
            const reports: Error[] = [];
            const executor = await createContractExecutor(
                { dedicatedThread: true },
                {
                    createWorkerRuntime,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            try {
                // The funnel is registered before readiness, so the earliest
                // post-start throw is a report, not a fatal exit.
                await waitFor(() => reports.length >= 1, 10_000, 50);
                expect(reports[0].message).to.equal(
                    WATCHDOG_WORKER_ORIGINAL_ERROR
                );
                const deployment = await executor.deploy(
                    createLogOnlyInitCode(ethers.id("ValueSet(uint256)"))
                );
                expect(deployment.createdAddress).to.be.a("string");
                expect(reports.length).to.equal(1);
            } finally {
                await executor.dispose();
            }
        });

        it("re-throws a detached error on the owning thread when no application route is given", async function () {
            // The owning thread is a dedicated worker thread here, so the
            // runner's own error handlers are never replaced.
            const armChannel = `watchdog-arm-${randomUUID()}`;
            const owner = new Worker(NO_ROUTE_EXECUTOR_ENTRY, {
                execArgv: [
                    "-r",
                    "ts-node/register/transpile-only",
                    "-r",
                    "tsconfig-paths/register"
                ],
                workerData: {
                    armChannel,
                    logOnlyInitCode: createLogOnlyInitCode(
                        ethers.id("ValueSet(uint256)")
                    )
                }
            });
            try {
                const report = await new Promise<NoRouteWorkerReport>(
                    (resolve, reject) => {
                        owner.once("message", resolve);
                        owner.once("error", reject);
                        owner.once("exit", (code) =>
                            reject(
                                new Error(`owner thread exited with ${code}`)
                            )
                        );
                    }
                );
                expect(report.type).to.equal("surfaced");
                if (report.type === "surfaced") {
                    expect(report.message).to.equal(
                        WATCHDOG_WORKER_ORIGINAL_ERROR
                    );
                    expect(report.servedAfter).to.equal(true);
                }
            } finally {
                await owner.terminate();
            }
        });

        it("keeps the public factory to one argument and its pre-plan option shape", function () {
            expect(createContractExecutorFactory.length).to.equal(1);
            // The exported options type is frozen at its pre-plan shape; the
            // internal seams never reach the package root. A key added or
            // removed on either side fails this compile-time equality.
            type PrePlanShape = {
                logger?: Logger;
                dedicatedThread: boolean;
                customPrecompiles?: EvmCustomPrecompileManifest[];
            };
            type Equal<A, B> =
                (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
                    ? 1
                    : 2
                    ? true
                    : false;
            const unchanged: Equal<
                ContractExecutorFactoryOptions,
                PrePlanShape
            > = true;
            expect(unchanged).to.equal(true);
        });

        it("node runtime keeps the first error when the exit follows it", async function () {
            const { createWorkerRuntime } = watchdogWorkerRuntime("prefunnel");
            const errors: Error[] = [];
            const worker = createWorkerRuntime(
                () => undefined,
                (error) => {
                    errors.push(error);
                }
            );
            try {
                // The load-time throw raises `error`, then the thread exits with
                // code 1; the runtime reports both and the executor keeps the
                // first. Here both must arrive, in that order.
                await waitFor(() => errors.length >= 2, 10_000, 50);
                expect(errors[0].message).to.equal(
                    "Stubbed pre-funnel worker failure"
                );
                expect(errors[1].message).to.equal(
                    "Contract executor worker exited with 1"
                );
            } finally {
                await worker.shutdown?.();
            }
        });
    });
});
