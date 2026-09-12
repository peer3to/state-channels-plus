import {
    createContractExecutorFactory,
    type ContractExecutorFactoryOptions,
    type EvmCustomPrecompileManifest
} from "@/evm";
import type { AContractExecutor } from "@/evm";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import {
    createContractExecutorWorker,
    createContractExecutorWorkerFromPath
} from "@/evm/contractExecutor/node/ContractExecutorWorkerRuntime";
import type { ContractExecutorWorkerErrorHandler } from "@/evm/contractExecutor/types";
import WorkerContractExecutor from "@/evm/contractExecutor/WorkerContractExecutor";
import type { RuntimePort } from "@/transport/RuntimePort";
import type { Logger } from "@/utils";
import { sleep } from "@/utils";
import { getErrorPeerAddress } from "@/utils/errorPeerAddress";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import { Address } from "@ethereumjs/util";
import type { NoRouteWorkerReport } from "@test/evm/workers/node/noRouteExecutorEntry";
import type { WatchdogWorkerData } from "@test/evm/workers/node/watchdogContractExecutorWorkerEntry";
import {
    WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS,
    WATCHDOG_WORKER_ORIGINAL_ERROR,
    WATCHDOG_WORKER_TRIPPED_DELAY_MS
} from "@test/evm/workers/watchdogContractExecutorWorkerCore";
import { encodedCustomErrorRevert } from "@test/factory";
import {
    connectRealms,
    createTestRealm,
    hostRealmOn,
    type RealmConnection,
    type TestRealm
} from "@test/fixtures/logging/LogFlushBus.fixture";
import {
    decodeUpload,
    startLogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import {
    crashingWorkerPrecompile,
    WORKER_ASYNC_CRASH_MESSAGE,
    WORKER_INIT_CRASH_MESSAGE
} from "@test/fixtures/workerAnswerPrecompile";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { BroadcastChannel, Worker } from "node:worker_threads";

// one port hop plus one POST -> above the receiver fixture's 2s default
const FLUSH_WAIT_MS = 15_000;

const FAILED_INIT_CHILD = path.resolve(
    __dirname,
    "../fixtures/failedWorkerInitChild.ts"
);

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
        createWorkerRuntime: (onError: ContractExecutorWorkerErrorHandler) =>
            createContractExecutorWorkerFromPath(
                WATCHDOG_WORKER_ENTRY,
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

    it("keeps the caller's logger working after the worker crashed", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bf"
        );
        const receiver = await startLogReceiver();
        const { realm, dispose } = hostRealmOn(receiver);
        const logger = realm.logger;
        const executor = await createContractExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingWorkerPrecompile(customAddress.toString(), "onCall")
                ]
            },
            { onDetachedError: () => undefined }
        );

        try {
            await executor.simulateCall("0x1234", customAddress.toString());
            await receiver.waitForRequests(1, FLUSH_WAIT_MS);
            await Promise.resolve(executor.dispose()).catch(() => undefined);

            logger.info("after the vm crash");
            const result = await realm.bus.flushAll("after crash");

            // the dead link is gone: nothing waits on it, and this realm ships
            expect(result.timedOut).to.equal(0);
            const shipped = receiver.requests.some(
                (request) =>
                    request.threadName === "sdk" &&
                    decodeUpload(request).some(
                        (entry) => entry.message === "after the vm crash"
                    )
            );
            expect(shipped, "the caller's entry was not uploaded").to.equal(
                true
            );
        } finally {
            dispose();
            await receiver.close();
        }
    });

    it("uploads the worker's logs under the vm thread", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bf"
        );
        const receiver = await startLogReceiver();
        const { realm, dispose } = hostRealmOn(receiver);
        const logger = realm.logger;
        const executor = await createContractExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingWorkerPrecompile(customAddress.toString(), "onCall")
                ]
            },
            { onDetachedError: () => undefined }
        );

        try {
            // vm logs nothing normally -> an entry here means a real worker failure
            await executor.simulateCall("0x1234", customAddress.toString());
            await waitFor(
                () =>
                    receiver.requests.some(
                        (request) => request.threadName === "vm"
                    ),
                FLUSH_WAIT_MS,
                50
            );

            const vmUpload = receiver.requests.find(
                (request) => request.threadName === "vm"
            );
            expect(vmUpload, "no vm upload arrived").to.not.be.undefined;
            expect(vmUpload!.fromSeq).to.equal(0);
            // filed under the identity init carried down from the host
            expect(vmUpload!.peerAddress).to.equal(
                logger.getSharedContext().peerAddress
            );
        } finally {
            // the crash ends the worker -> dispose meets a failed executor
            await Promise.resolve(executor.dispose()).catch(() => undefined);
            dispose();
            await receiver.close();
        }
    });

    it("an unhandled rejection in the worker uploads every linked realm", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bf"
        );
        const receiver = await startLogReceiver();
        const { realm, dispose } = hostRealmOn(receiver);
        const logger = realm.logger;
        const executor = await createContractExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingWorkerPrecompile(customAddress.toString(), "onCall")
                ]
            },
            { onDetachedError: () => undefined }
        );

        try {
            logger.info("host realm entry");
            await executor.simulateCall("0x1234", customAddress.toString());
            await receiver.waitForRequests(2, FLUSH_WAIT_MS);

            const vmUpload = receiver.requests.find(
                (request) => request.threadName === "vm"
            );
            expect(vmUpload, "no vm upload arrived").to.not.be.undefined;
            expect(JSON.stringify(decodeUpload(vmUpload!))).to.include(
                WORKER_ASYNC_CRASH_MESSAGE
            );
            expect(
                receiver.requests.map((request) => request.threadName)
            ).to.include("sdk");
        } finally {
            // the crash ends the worker -> dispose meets a failed executor
            await Promise.resolve(executor.dispose()).catch(() => undefined);
            dispose();
            await receiver.close();
        }
    });

    it("a crash while the evm is still being built reaches the realms above", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000c0"
        );
        const receiver = await startLogReceiver();
        const { realm: host, dispose } = hostRealmOn(receiver);
        // a realm above the host uploads only if the worker's request travels
        // through the host's port, unlike the host, which logs the failure itself
        const main: TestRealm = createTestRealm({
            threadName: "main",
            uploadEndpoint: receiver.url
        });
        const upper: RealmConnection = connectRealms(main, host);
        main.logger.info("main entry");
        let executor: AContractExecutor | undefined;

        try {
            executor = await createContractExecutor(
                {
                    dedicatedThread: true,
                    logger: host.logger,
                    customPrecompiles: [
                        crashingWorkerPrecompile(
                            customAddress.toString(),
                            "onInit"
                        )
                    ]
                },
                { onDetachedError: () => undefined }
            ).catch(() => undefined);
            await receiver.waitForRequests(3, FLUSH_WAIT_MS);

            const vmUpload = receiver.requests.find(
                (request) => request.threadName === "vm"
            );
            expect(vmUpload, "no vm upload arrived").to.not.be.undefined;
            expect(JSON.stringify(decodeUpload(vmUpload!))).to.include(
                WORKER_INIT_CRASH_MESSAGE
            );
            // the host's identity was pushed before init, not after it
            expect(vmUpload!.peerAddress).to.equal(
                host.logger.getSharedContext().peerAddress
            );
            expect(
                receiver.requests.map((request) => request.threadName)
            ).to.include.members(["sdk", "main"]);
        } finally {
            await Promise.resolve(executor?.dispose()).catch(() => undefined);
            upper.close();
            main.logger.dispose();
            dispose();
            await receiver.close();
        }
    });

    it("ends the worker when init fails instead of leaking it", async function () {
        // a leaked worker keeps its parent process alive, so the oracle is a
        // child process that must be able to end after the failed create
        const child = fork(FAILED_INIT_CHILD, [], {
            execArgv: [
                "-r",
                "ts-node/register/transpile-only",
                "-r",
                "tsconfig-paths/register"
            ],
            stdio: ["ignore", "ignore", "ignore", "ipc"]
        });
        const outcome = new Promise<{ kind: string; message?: string }>(
            (resolve, reject) => {
                child.once("message", (message) =>
                    resolve(message as { kind: string; message?: string })
                );
                child.once("error", reject);
            }
        );
        const exited = new Promise<number | null>((resolve) =>
            child.once("exit", (code) => resolve(code))
        );

        try {
            const failure = await outcome;
            expect(failure.kind).to.equal("failed");
            expect(failure.message).to.include(
                "must export a precompile factory"
            );
            const code = await Promise.race([
                exited,
                new Promise<"still running">((resolve) =>
                    setTimeout(() => resolve("still running"), FLUSH_WAIT_MS)
                )
            ]);
            expect(code, "worker leaked: the child never ended").to.equal(0);
        } finally {
            if (child.exitCode === null) child.kill("SIGKILL");
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

    it("request failure preserves nested revert data and peer metadata across the worker", async function () {
        const peer = ethers.Wallet.createRandom().address;
        let received: unknown;
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            customPrecompiles: [
                {
                    address: peer,
                    module: path.resolve(
                        __dirname,
                        "../fixtures/workerRevertPrecompile.ts"
                    ),
                    options: {
                        data: encodedCustomErrorRevert(
                            "RaceConditionDisputeEvidencePeriodExpired"
                        ),
                        peer
                    }
                }
            ]
        });
        try {
            await executor.executeCall("0x", peer);
        } catch (error) {
            received = error;
        } finally {
            await executor.dispose();
        }
        expect(received).to.be.instanceOf(Error);
        expect((received as Error).name).to.equal(
            "PrecompileInitializationError"
        );
        expect(tryDecodeCustomError(received)?.name).to.equal(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
        expect(getErrorPeerAddress(received)).to.equal(peer);
        expect((received as Error & { code?: string }).code).to.equal(
            "CALL_EXCEPTION"
        );
    });

    it("late worker failure after disposal leaves the pending request rejected only by disposal", async function () {
        let lateError!: (error: Error) => void;
        let callDelivered!: () => void;
        const delivered = new Promise<void>((resolve) => {
            callDelivered = resolve;
        });
        const reports: Error[] = [];
        const executor = await WorkerContractExecutor.create([], undefined, {
            onDetachedError: (error) => {
                reports.push(error);
            },
            createWorkerRuntime: (onError) => {
                lateError = onError;
                let heldRequestId: string | undefined;
                const runtime = createContractExecutorWorker(onError);
                // the call's reply never reaches the router, so its caller
                // stays pending until disposal settles it
                const port: RuntimePort = {
                    post: (message) => {
                        const rpc = message as {
                            service?: string;
                            method?: string;
                            requestId?: string;
                        };
                        if (
                            rpc.service === "contractExecutor" &&
                            rpc.method === "executeCall"
                        ) {
                            heldRequestId = rpc.requestId;
                        }
                        runtime.port.post(message);
                    },
                    onMessage: (handler) => {
                        runtime.port.onMessage((message) => {
                            const reply = message as {
                                rpcResponse?: boolean;
                                requestId?: string;
                            };
                            if (
                                reply.rpcResponse === true &&
                                reply.requestId === heldRequestId
                            ) {
                                callDelivered();
                                return;
                            }
                            handler(message);
                        });
                    },
                    start: () => runtime.port.start(),
                    onClose: (handler) => runtime.port.onClose(handler),
                    close: () => runtime.port.close()
                };
                return { port, shutdown: runtime.shutdown };
            }
        });
        let rejectionCount = 0;
        const pending = executor
            .executeCall("0x", ethers.Wallet.createRandom().address)
            .catch((error: Error) => {
                rejectionCount += 1;
                return error.message;
            });
        await delivered;
        await executor.dispose();
        expect(await pending).to.contain("disposed");
        lateError(new Error("Late worker error after shutdown"));
        expect(rejectionCount).to.equal(1);
        expect(reports).to.have.length(0);
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
                // Observe no duplicate report while the worker remains usable.
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

        it("fails a request that is in flight when the worker port closes with no error event", async function () {
            const { armChannel, createWorkerRuntime } =
                watchdogWorkerRuntime("exit-pending");
            const reports: Error[] = [];
            const executor = await createContractExecutor(
                { dedicatedThread: true },
                {
                    // the runtime's own funnel says nothing here, so the port
                    // closing is the only notice of the worker going away
                    createWorkerRuntime: () =>
                        createWorkerRuntime(() => undefined),
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const sender = new BroadcastChannel(armChannel);
            try {
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
                    expect.fail("the in-flight call must reject on the close");
                } catch (error) {
                    failure = error;
                }
                expect((failure as Error).message).to.equal(
                    "Contract executor worker closed the connection"
                );
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
        });

        it("node runtime keeps the first error when the exit follows it", async function () {
            const { createWorkerRuntime } = watchdogWorkerRuntime("prefunnel");
            const errors: Error[] = [];
            const worker = createWorkerRuntime((error: Error) => {
                errors.push(error);
            });
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
