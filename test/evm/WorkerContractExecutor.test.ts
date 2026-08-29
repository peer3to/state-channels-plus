import { expect } from "chai";
import { ethers } from "ethers";
import { Address } from "@ethereumjs/util";
import path from "node:path";
import {
    createContractExecutorFactory,
    type EvmCustomPrecompileManifest
} from "@/evm";
import type { AContractExecutor } from "@/evm";
import { fork } from "node:child_process";
import {
    decodeUpload,
    startLogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import {
    connectRealms,
    createTestRealm,
    hostRealmOn,
    type RealmConnection,
    type TestRealm
} from "@test/fixtures/logging/LogFlushBus.fixture";
import {
    crashingWorkerPrecompile,
    WORKER_ASYNC_CRASH_MESSAGE,
    WORKER_INIT_CRASH_MESSAGE
} from "@test/fixtures/workerAnswerPrecompile";

// one port hop plus one POST -> above the receiver fixture's 2s default
const FLUSH_WAIT_MS = 15_000;

const FAILED_INIT_CHILD = path.resolve(
    __dirname,
    "../fixtures/failedWorkerInitChild.ts"
);

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

    it("ends the worker after a fatal so pending calls do not hang", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000be"
        );
        const receiver = await startLogReceiver();
        const { realm, dispose } = hostRealmOn(receiver);
        const logger = realm.logger;
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            logger,
            customPrecompiles: [
                crashingWorkerPrecompile(customAddress.toString(), "onCall")
            ]
        });

        try {
            await executor.simulateCall("0x1234", customAddress.toString());
            await receiver.waitForRequests(1, FLUSH_WAIT_MS);

            // the crash hooks the vm logger installs suppress node's fatal
            // default, so without an explicit end the thread survives and calls
            // keep succeeding instead of failing the peer
            const deadline = Date.now() + FLUSH_WAIT_MS;
            let rejected = false;
            while (!rejected && Date.now() < deadline) {
                try {
                    await executor.simulateCall(
                        "0x1234",
                        customAddress.toString()
                    );
                } catch {
                    rejected = true;
                }
            }

            expect(
                rejected,
                "worker still serving calls after a fatal"
            ).to.equal(true);
        } finally {
            await Promise.resolve(executor.dispose()).catch(() => undefined);
            dispose();
            await receiver.close();
        }
    });

    it("rejects a call still in flight when the worker crashes", async function () {
        const customAddress = Address.fromString(
            "0x00000000000000000000000000000000000000bd"
        );
        const receiver = await startLogReceiver();
        const { realm, dispose } = hostRealmOn(receiver);
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            logger: realm.logger,
            customPrecompiles: [
                // the crash lands while this call is still being answered
                crashingWorkerPrecompile(
                    customAddress.toString(),
                    "onCall",
                    30_000
                )
            ]
        });

        try {
            let caught: Error | undefined;
            try {
                await executor.simulateCall("0x1234", customAddress.toString());
            } catch (error) {
                caught = error as Error;
            }

            expect(
                caught,
                "the call outlived the thread that was answering it"
            ).to.be.instanceOf(Error);
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
        const { realm, dispose } = hostRealmOn(receiver);
        const logger = realm.logger;
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            logger,
            customPrecompiles: [
                crashingWorkerPrecompile(customAddress.toString(), "onCall")
            ]
        });

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
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            logger,
            customPrecompiles: [
                crashingWorkerPrecompile(customAddress.toString(), "onCall")
            ]
        });

        try {
            // vm logs nothing normally -> an entry here means a real worker failure
            await executor.simulateCall("0x1234", customAddress.toString());
            await receiver.waitForRequests(1, FLUSH_WAIT_MS);

            const vmUpload = receiver.requests.find(
                (request) => request.threadName === "vm"
            );
            expect(vmUpload, "no vm upload arrived").to.not.be.undefined;
            expect(vmUpload!.fromSeq).to.equal(0);
            // filed under the identity the host pushed on attach; init carries none
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
        const executor = await createContractExecutorFactory({
            dedicatedThread: true,
            logger,
            customPrecompiles: [
                crashingWorkerPrecompile(customAddress.toString(), "onCall")
            ]
        });

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
            executor = await createContractExecutorFactory({
                dedicatedThread: true,
                logger: host.logger,
                customPrecompiles: [
                    crashingWorkerPrecompile(customAddress.toString(), "onInit")
                ]
            }).catch(() => undefined);
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
});
