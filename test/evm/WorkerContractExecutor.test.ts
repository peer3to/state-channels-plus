import { expect } from "chai";
import { ethers } from "ethers";
import { Address } from "@ethereumjs/util";
import path from "node:path";
import {
    createContractExecutorFactory,
    type EvmCustomPrecompileManifest
} from "@/evm";

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

    for (const dedicatedThread of [false, true]) {
        it(`should serialize simulations with local writes (${dedicatedThread ? "worker" : "inline"})`, async function () {
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
        });
    }
});
