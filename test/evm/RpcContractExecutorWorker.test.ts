import type { EvmCustomPrecompileManifest } from "@/evm";
import { childDisposedError } from "@/rpc/internal/RemoteRoot";
import { sleep } from "@/utils";
import { getErrorPeerAddress } from "@/utils/errorPeerAddress";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { Address } from "@ethereumjs/util";
import {
    WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS,
    WATCHDOG_WORKER_ORIGINAL_ERROR,
    WATCHDOG_WORKER_TRIPPED_DELAY_MS
} from "@test/evm/workers/watchdogContractExecutorWorkerCore";
import { encodedCustomErrorRevert } from "@test/factory";
import {
    decodeUpload,
    startLogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import { expectSimulationsSerializeWithLocalWrites } from "@test/fixtures/node/ContractExecutorRuntimeFixture";
import {
    createSdkOwnedExecutor,
    createSdkOwnedScriptedExecutor,
    disposeSdkExecutorFixtures,
    sdkExecutorOwner,
    takeSdkExecutorErrors,
    sdkExecutorPeerAddress
} from "@test/fixtures/node/SdkExecutorFixture";
import { assertWorkerFailureOrder } from "@test/fixtures/node/WorkerExecutorStaging";
import {
    watchdogWorkerRuntime,
    crashingPrecompile,
    useReceiver,
    createLogOnlyInitCode
} from "@test/fixtures/node/WorkerExecutorStaging";
import { RuntimeRpcControl } from "@test/fixtures/runtimeRpc/RuntimeRpcControl";
import { WORKER_ASYNC_CRASH_MESSAGE } from "@test/fixtures/workerAnswerPrecompile";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";
import path from "node:path";
import { BroadcastChannel } from "node:worker_threads";

// one port hop plus one POST -> above the receiver fixture's 2s default
const FLUSH_WAIT_MS = 15_000;

describe("RpcContractExecutor (worker placement)", function () {
    afterEach(disposeSdkExecutorFixtures);

    it("request failure preserves nested revert data and peer metadata across the worker", async function () {
        const peer = ethers.Wallet.createRandom().address;
        let received: unknown;
        const executor = await createSdkOwnedExecutor({
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

        const executor = await createSdkOwnedExecutor({
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
        const creating = createSdkOwnedExecutor({
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

        // Sample at 25 ms, before the precompile's explicit 100 ms initialization delay.
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
        const executor = await createSdkOwnedExecutor({
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
        const executor = await createSdkOwnedExecutor({
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

    it("late worker failure after disposal leaves the pending request rejected only by disposal", async function () {
        const logger = new NodeLogger(
            {},
            {},
            "debug",
            new LogStore(1_000_000, true),
            { attachErrorListener: false }
        );
        const reports: Error[] = [];
        const executor = await createSdkOwnedExecutor(
            { dedicatedThread: true, logger },
            {
                onDetachedError: (error) => reports.push(error)
            }
        );
        const owner = sdkExecutorOwner(executor);
        const connection = [...owner.connections.values()].find(
            (entry) => entry.remoteRelation === "child"
        )!;
        const control = RuntimeRpcControl.attachTo(connection);
        const delivered = control.holdNextResponse("executeCall");
        let rejectionCount = 0;
        const pending = executor
            .executeCall("0x", ethers.Wallet.createRandom().address)
            .catch((error: Error) => {
                rejectionCount += 1;
                return error.message;
            });
        await delivered;
        await executor.dispose();
        expect(await pending).to.equal(childDisposedError().message);
        connection.fail(new Error("Late worker error after shutdown"));
        expect(rejectionCount).to.equal(1);
        expect(reports).to.have.length(0);
        control.dispose();
        logger.dispose();
    });

    it("should dispose idempotently", async function () {
        const executor = await createSdkOwnedExecutor({
            dedicatedThread: true
        });

        const root = [...sdkExecutorOwner(executor).children][0];
        const first = executor.dispose();
        expect(executor.dispose() === first).to.equal(true);
        await first;
        expect(root.isClosed).to.equal(true);
        expect(executor.dispose() === first).to.equal(true);
    });

    it("should reject calls immediately after disposal", async function () {
        const executor = await createSdkOwnedExecutor({
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
                childDisposedError().message
            );
        }
    });

    it("reports a detached worker crash and keeps serving", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000be"
        );
        const receiver = await startLogReceiver();
        const { logger, dispose } = useReceiver(receiver);
        const reports: Error[] = [];
        const executor = await createSdkOwnedExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingPrecompile(customAddress.toString())
                ]
            },
            { onDetachedError: (error) => reports.push(error) }
        );

        try {
            await executor.simulateCall("0x1234", customAddress.toString());
            await waitFor(() => reports.length >= 1, FLUSH_WAIT_MS, 50);
            expect(reports[0].message).to.include(WORKER_ASYNC_CRASH_MESSAGE);

            // report-and-continue: the thread kept its canonical state, so the
            // next call is answered by the same worker
            await executor.simulateCall("0x1234", customAddress.toString());
        } finally {
            await Promise.resolve(executor.dispose()).catch(() => undefined);
            dispose();
            await receiver.close();
        }
    });

    it("keeps the caller's logger working after the worker crashed", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bf"
        );
        const receiver = await startLogReceiver();
        const { logger, dispose } = useReceiver(receiver);
        const executor = await createSdkOwnedExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingPrecompile(customAddress.toString())
                ]
            },
            { onDetachedError: () => undefined }
        );

        try {
            await executor.simulateCall("0x1234", customAddress.toString());
            await receiver.waitForRequests(1, FLUSH_WAIT_MS);
            await Promise.resolve(executor.dispose()).catch(() => undefined);

            logger.info("after the vm crash");
            const result = await logger.upload("after crash");

            // the disposed link is gone: nothing waits on it, and this realm ships
            expect(result.ok).to.equal(true);
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
        const { logger, dispose } = useReceiver(receiver);
        const executor = await createSdkOwnedExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingPrecompile(customAddress.toString())
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
            // recordDetachedError logs synchronously before forwarding the error.
            // The uploader awaits jitter before reading the store, so synchronous
            // duplicates are in the first snapshot. The watchdog case
            // separately checks that no later autonomous report is emitted.
            expect(
                receiver.requests
                    .filter((upload) => upload.threadName === "vm")
                    .flatMap(decodeUpload)
                    .filter(
                        (entry) =>
                            entry.message ===
                            "Contract executor worker caught a detached error"
                    )
            ).to.have.length(1);
            // filed under the identity the host pushed on attach; init carries none
            expect(vmUpload!.peerAddress).to.equal(
                sdkExecutorPeerAddress(executor)
            );
        } finally {
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
        const { logger, dispose } = useReceiver(receiver);
        const executor = await createSdkOwnedExecutor(
            {
                dedicatedThread: true,
                logger,
                customPrecompiles: [
                    crashingPrecompile(customAddress.toString())
                ]
            },
            { onDetachedError: () => undefined }
        );

        try {
            logger.info("host realm entry");
            await executor.simulateCall("0x1234", customAddress.toString());
            await waitFor(
                () =>
                    ["sdk", "vm"].every((thread) =>
                        receiver.requests.some(
                            (request) => request.threadName === thread
                        )
                    ),
                FLUSH_WAIT_MS,
                50
            );

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
            await Promise.resolve(executor.dispose()).catch(() => undefined);
            dispose();
            await receiver.close();
        }
    });

    it("should serialize simulations with local writes (inline)", async function () {
        await expectSimulationsSerializeWithLocalWrites(false);
    });

    it("should serialize simulations with local writes (worker)", async function () {
        await expectSimulationsSerializeWithLocalWrites(true);
    });

    describe("detached worker errors", function () {
        it("reports a watchdog trip once with its delay data and keeps serving", async function () {
            const { armChannel, workerUrl, workerData } =
                watchdogWorkerRuntime("watchdog");
            const reports: Error[] = [];
            const executor = await createSdkOwnedScriptedExecutor(
                { dedicatedThread: true },
                {
                    workerUrl,
                    workerData,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const sender = new BroadcastChannel(armChannel);
            try {
                // Observe the unarmed monitor for 300 ms before sending the trigger;
                // this is a bounded absence check, not a startup readiness wait.
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
            const { armChannel, workerUrl, workerData } =
                watchdogWorkerRuntime("throw");
            const reports: Error[] = [];
            const executor = await createSdkOwnedScriptedExecutor(
                { dedicatedThread: true },
                {
                    workerUrl,
                    workerData,
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
            const { armChannel, workerUrl, workerData } =
                watchdogWorkerRuntime("exit");
            const reports: Error[] = [];
            const executor = await createSdkOwnedScriptedExecutor(
                { dedicatedThread: true },
                {
                    workerUrl,
                    workerData,
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
                    "Root worker exited with 0"
                );
                // The exit is fatal, never a detached report.
                expect(reports.length).to.equal(0);
                await waitFor(() =>
                    takeSdkExecutorErrors(executor).some(
                        (error) => error.message === "Root worker exited with 0"
                    )
                );
                try {
                    await executor.executeCall(
                        "0x",
                        "0x0000000000000000000000000000000000000001"
                    );
                    expect.fail("calls after a worker exit must reject");
                } catch (error) {
                    expect((error as Error).message).to.equal(
                        "Root worker exited with 0"
                    );
                }
            } finally {
                sender.close();
                await executor.dispose();
            }
        });

        it("rejects creation when the worker fails before its funnel exists", async function () {
            const { workerUrl, workerData } =
                watchdogWorkerRuntime("prefunnel");
            const reports: Error[] = [];
            let failure: unknown;
            try {
                await createSdkOwnedScriptedExecutor(
                    { dedicatedThread: true },
                    {
                        workerUrl,
                        workerData,
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
            // Full SDK startup can also publish the same pre-ready failure.
            // Keep that existing startup behavior visible without treating it as a second cause.
            await MathTestSession.expectFirstDetachedError({
                includes: "Stubbed pre-funnel worker failure",
                required: false
            });
        });

        it("fails a request that is in flight when the worker exits, with the exit as the cause", async function () {
            const { armChannel, workerUrl, workerData } =
                watchdogWorkerRuntime("exit-pending");
            const reports: Error[] = [];
            const executor = await createSdkOwnedScriptedExecutor(
                { dedicatedThread: true },
                {
                    workerUrl,
                    workerData,
                    onDetachedError: (error) => {
                        reports.push(error);
                    }
                }
            );
            const connection = [
                ...sdkExecutorOwner(executor).connections.values()
            ].find((entry) => entry.remoteRelation === "child")!;
            const control = RuntimeRpcControl.attachTo(connection);
            const held = control.holdNextResponse("executeCall");
            const sender = new BroadcastChannel(armChannel);
            try {
                // Hold the actual reply after SDK setup; the exit must settle
                // the caller while its reply is still undelivered.
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
                await held;
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
                    "Root worker exited with 0"
                );
                try {
                    await executor.executeCall(
                        "0x",
                        "0x0000000000000000000000000000000000000001"
                    );
                    expect.fail("calls after a worker exit must reject");
                } catch (error) {
                    expect((error as Error).message).to.equal(
                        "Root worker exited with 0"
                    );
                }
                expect(reports.length).to.equal(0);
                await waitFor(() =>
                    takeSdkExecutorErrors(executor).some(
                        (error) => error.message === "Root worker exited with 0"
                    )
                );
            } finally {
                control.dispose();
                sender.close();
                await executor.dispose();
            }
        });

        it("reports an error thrown right after the host starts, before any request", async function () {
            const { workerUrl, workerData } =
                watchdogWorkerRuntime("post-start");
            const reports: Error[] = [];
            const executor = await createSdkOwnedScriptedExecutor(
                { dedicatedThread: true },
                {
                    workerUrl,
                    workerData,
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

        it("does not export a standalone executor factory", async function () {
            const entry = await import("@/index");
            expect(
                Reflect.has(entry, "createContractExecutorFactory")
            ).to.equal(false);
        });

        it("node runtime keeps the first error when the exit follows it", async function () {
            await assertWorkerFailureOrder();
        });
    });
});
