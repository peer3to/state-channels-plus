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
});
