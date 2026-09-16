// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures,
    sdkExecutorOwner
} from "./SdkExecutorFixture";
import { getSimpleNumberStorageFactory } from "../SimpleNumberStorage.fixture";
import type { EvmCustomPrecompileManifest } from "@/evm";
import type AContractExecutor from "@/evm/contractExecutor/AContractExecutor";
import { Address } from "@ethereumjs/util";
import { expect } from "chai";
import type { Interface } from "ethers";
import { ethers } from "hardhat";
import path from "node:path";

export async function withSdkStorage(
    dedicatedThread: boolean,
    operation: (
        executor: AContractExecutor,
        address: string,
        contractInterface: Interface
    ) => Promise<void>
): Promise<void> {
    const executor = await createSdkOwnedExecutor({ dedicatedThread });
    try {
        const factory = await getSimpleNumberStorageFactory(ethers);
        const deployment = await executor.deploy(
            (await factory.getDeployTransaction()).data!
        );
        expect(deployment.createdAddress).to.be.a("string");
        await operation(
            executor,
            deployment.createdAddress!.toString(),
            factory.interface
        );
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

export async function assertCanonicalSimulationOrder(
    dedicatedThread: boolean
): Promise<void> {
    await withSdkStorage(
        dedicatedThread,
        async (executor, address, contractInterface) => {
            const write = await executor.executeCall(
                contractInterface.encodeFunctionData("setValue", [41n]),
                address
            );
            expect(write.returnValue).to.equal("0x");
            await executor.simulateCall(
                contractInterface.encodeFunctionData("setValue", [99n]),
                address
            );
            const read = await executor.executeCall(
                contractInterface.encodeFunctionData("getValue"),
                address
            );
            expect(
                contractInterface.decodeFunctionResult(
                    "getValue",
                    read.returnValue
                )[0]
            ).to.equal(41n);
            expect(
                sdkExecutorOwner(executor).router.pendingRequestCount
            ).to.equal(0);
        }
    );
}

export async function assertExecutorRevertRecovery(
    dedicatedThread: boolean
): Promise<void> {
    await withSdkStorage(
        dedicatedThread,
        async (executor, address, contractInterface) => {
            const message = "SDK executor revert";
            let failure: unknown;
            try {
                await executor.executeCall(
                    contractInterface.encodeFunctionData("revertWithMessage", [
                        message
                    ]),
                    address
                );
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            const error = failure as Error & { data?: string };
            expect(error.name).to.equal("Error");
            expect(error.message).to.equal("EVM execution failed: Error");
            expect(error.data).to.equal(
                `0x08c379a0${ethers.AbiCoder.defaultAbiCoder().encode(["string"], [message]).slice(2)}`
            );
            expect(
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["string"],
                    `0x${error.data!.slice(10)}`
                )[0]
            ).to.equal(message);
            const read = await executor.executeCall(
                contractInterface.encodeFunctionData("getValue"),
                address
            );
            expect(
                contractInterface.decodeFunctionResult(
                    "getValue",
                    read.returnValue
                )[0]
            ).to.equal(0n);
        }
    );
}

export async function assertExecutorCloneIsolation(
    dedicatedThread: boolean
): Promise<void> {
    await withSdkStorage(
        dedicatedThread,
        async (executor, address, contractInterface) => {
            const readData = contractInterface.encodeFunctionData("getValue");
            const first = await executor.executeCall(readData, address);
            first.returnValue = "0xdeadbeef";
            first.logs?.push({ address, topics: [], data: "0x" });
            const second = await executor.executeCall(readData, address);
            expect(
                contractInterface.decodeFunctionResult(
                    "getValue",
                    second.returnValue
                )[0]
            ).to.equal(0n);
            expect(second.logs ?? []).to.deep.equal([]);
        }
    );
}

export async function assertExecutorManifestValues(
    dedicatedThread: boolean
): Promise<void> {
    const defaultAddress = Address.fromString(
        "0x00000000000000000000000000000000000000cd"
    );
    const configuredAddress = Address.fromString(
        "0x00000000000000000000000000000000000000ce"
    );
    const module = path.resolve(
        __dirname,
        "../runtimeRpc/RuntimeValuePrecompile.ts"
    );
    const options = {
        value: (1n << 200n) + 17n,
        bytes: new Uint8Array([0, 127, 255])
    };
    const expectedValue = options.value;
    const executor = await createSdkOwnedExecutor({
        dedicatedThread,
        customPrecompiles: [
            { address: defaultAddress, module },
            { address: configuredAddress, module, options }
        ]
    });
    try {
        options.value = 1n;
        options.bytes.fill(1);
        const ordinary = await executor.executeCall(
            "0x",
            defaultAddress.toString()
        );
        const values = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256", "bool", "bytes"],
            ordinary.returnValue
        );
        expect(values[0]).to.equal(0n);
        expect(values[1]).to.equal(false);
        expect(values[2]).to.equal("0x");
        const configured = await executor.simulateCall(
            "0x",
            configuredAddress.toString()
        );
        const cloned = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256", "bool", "bytes"],
            configured.returnValue
        );
        expect(cloned[0]).to.equal(expectedValue);
        expect(cloned[1]).to.equal(false);
        expect(cloned[2]).to.equal("0x007fff");
    } finally {
        await disposeSdkExecutorFixtures();
    }
}

export async function expectSimulationsSerializeWithLocalWrites(
    dedicatedThread: boolean
) {
    const customAddress = Address.fromString(
        "0x00000000000000000000000000000000000000bc"
    );
    const customPrecompile: EvmCustomPrecompileManifest = {
        address: customAddress.toString(),
        module: path.resolve(__dirname, "../workerConcurrencyPrecompile.ts"),
        options: { delayMs: 50 }
    };
    const executor = await createSdkOwnedExecutor({
        dedicatedThread,
        customPrecompiles: [customPrecompile]
    });

    try {
        const simulation = executor.simulateCall(
            "0x1234",
            customAddress.toString()
        );
        const write = executor.executeCall("0x5678", customAddress.toString());
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
