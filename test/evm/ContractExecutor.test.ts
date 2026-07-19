import { ethers } from "hardhat";
import { expect } from "chai";
import { EVM } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { ContractExecutor, type AContractExecutor } from "@/evm";
import Clock from "@/Clock";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import {
    getSimpleNumberStorageDeploymentTransaction,
    getSimpleNumberStorageFactory
} from "../fixtures/SimpleNumberStorage.fixture";

describe("ContractExecutor", function () {
    let evm: EVM;
    let contractAddress: Address;
    let contractExecutor: AContractExecutor;
    let SimpleNumberStorage: any; // Store the contract factory

    const getUnderlyingDbSize = () => {
        return ((evm.stateManager as any)._trie.database().db as any)._database
            .size;
    };
    const getMixedCaseContractAddress = () =>
        `0x${contractAddress
            .toString()
            .slice(2)
            .split("")
            .map((char, index) =>
                index % 2 === 0 ? char.toUpperCase() : char.toLowerCase()
            )
            .join("")}`;
    const executeContractCall = (data: string | Uint8Array) =>
        contractExecutor.executeCall(data, getMixedCaseContractAddress());
    const simulateContractCall = (data: string | Uint8Array) =>
        contractExecutor.simulateCall(data, getMixedCaseContractAddress());
    const createLogOnlyInitCode = (topic: string) => {
        const runtime = `0x602a6000527f${topic.slice(2)}60206000a160006000f3`;
        const runtimeBytes = ethers.getBytes(runtime);
        const runtimeSize = runtimeBytes.length.toString(16).padStart(2, "0");
        const header = `0x60${runtimeSize}600c60003960${runtimeSize}6000f3`;
        return `${header}${runtime.slice(2)}`;
    };

    // Deploy the SimpleNumberStorage contract
    before(async function () {
        await Clock.init(ethers.provider);
        evm = await EVM.create();

        SimpleNumberStorage = await getSimpleNumberStorageFactory(ethers);

        const deployTx =
            await getSimpleNumberStorageDeploymentTransaction(ethers);

        // Deploy using EVM
        const deploymentResult = await evm.runCall({
            data: ethers.getBytes(deployTx.data || "0x")
        });

        expect(deploymentResult.createdAddress).to.not.be.undefined;
        contractAddress = deploymentResult.createdAddress!;

        contractExecutor = new ContractExecutor(evm);
    });

    it("should successfully execute a call to get a value", async function () {
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await executeContractCall(getValueData);

        expect(result.returnValue).to.not.be.undefined;
        const returnValue = ethers.hexlify(result.returnValue);
        const decodedValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            returnValue
        );
        expect(decodedValue[0]).to.equal(0n); // Default value should be 0
    });

    it("should successfully execute a call to set a value", async function () {
        // Set a value using setValue
        const setValue = 42n;
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const setValueData = SimpleNumberStorage.interface.encodeFunctionData(
            setValueFunction,
            [setValue]
        );

        await executeContractCall(setValueData);

        // Get the value to verify it was set
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await executeContractCall(getValueData);
        const returnValue = ethers.hexlify(result.returnValue);
        const decodedValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            returnValue
        );
        expect(decodedValue[0]).to.equal(setValue);
    });

    it("should successfully set state using bytes", async function () {
        // Set a value using setState (takes bytes as input)
        const newValue = 99n;
        const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [newValue]
        );

        const setStateFunction =
            SimpleNumberStorage.interface.getFunction("setState");
        const setStateData = SimpleNumberStorage.interface.encodeFunctionData(
            setStateFunction,
            [encodedValue]
        );

        await executeContractCall(setStateData);

        // Get the value to verify it was set
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await executeContractCall(getValueData);
        const returnValue = ethers.hexlify(result.returnValue);
        const decodedValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            returnValue
        );
        expect(decodedValue[0]).to.equal(newValue);
    });

    it("should return RPC-style logs", async function () {
        const contractInterface = new ethers.Interface([
            "event ValueSet(uint256 value)"
        ]);
        const topic = ethers.id("ValueSet(uint256)");
        const deployment = await contractExecutor.deploy(
            createLogOnlyInitCode(topic)
        );

        const result = await contractExecutor.executeCall(
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
    });

    it("should simulate a mutating call without persisting it", async function () {
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const setValueData = SimpleNumberStorage.interface.encodeFunctionData(
            setValueFunction,
            [777n]
        );

        const beforeResult = await executeContractCall(getValueData);
        const beforeValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            ethers.hexlify(beforeResult.returnValue)
        )[0];

        await simulateContractCall(setValueData);

        const afterResult = await executeContractCall(getValueData);
        const afterValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            ethers.hexlify(afterResult.returnValue)
        )[0];

        expect(afterValue).to.equal(beforeValue);
    });

    it("should not expand the underlying EVM DB on simulated mutating calls", async function () {
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const setValueData = SimpleNumberStorage.interface.encodeFunctionData(
            setValueFunction,
            [1_000_001n]
        );

        const dbSizeBefore = getUnderlyingDbSize();

        await simulateContractCall(setValueData);

        expect(getUnderlyingDbSize()).to.equal(dbSizeBefore);
    });

    it("should expand the underlying EVM DB on canonical mutating calls", async function () {
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const setValueData = SimpleNumberStorage.interface.encodeFunctionData(
            setValueFunction,
            [1_000_002n]
        );

        const dbSizeBefore = getUnderlyingDbSize();

        await executeContractCall(setValueData);

        expect(getUnderlyingDbSize()).to.be.greaterThan(dbSizeBefore);
    });

    it("should make simulations wait while a canonical call holds the mutex", async function () {
        const evmWithPatchedRunCall = evm as EVM & {
            runCall: (...args: any[]) => ReturnType<EVM["runCall"]>;
        };
        const originalRunCall = evmWithPatchedRunCall.runCall.bind(evm);
        let releaseCanonicalCall!: () => void;
        let canonicalCallStarted = false;
        const canonicalCallStartedPromise = new Promise<void>((resolve) => {
            evmWithPatchedRunCall.runCall = async (...args: any[]) => {
                if (!canonicalCallStarted) {
                    canonicalCallStarted = true;
                    resolve();
                    await new Promise<void>((release) => {
                        releaseCanonicalCall = release;
                    });
                }

                return await originalRunCall(...args);
            };
        });

        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const setValueData = SimpleNumberStorage.interface.encodeFunctionData(
            setValueFunction,
            [888n]
        );

        const canonicalCall = executeContractCall(setValueData);
        await canonicalCallStartedPromise;
        let simulationCompleted = false;
        const simulation = simulateContractCall(getValueData).then((result) => {
            simulationCompleted = true;
            return result;
        });

        try {
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(simulationCompleted).to.equal(false);
        } finally {
            releaseCanonicalCall();
            await canonicalCall;
            evmWithPatchedRunCall.runCall = originalRunCall;
        }

        expect((await simulation).returnValue).to.not.be.undefined;
    });

    it("should simulate from the committed state after a canonical call releases", async function () {
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const initialValue = 321n;
        const nextValue = 999n;
        const setInitialValueData =
            SimpleNumberStorage.interface.encodeFunctionData(setValueFunction, [
                initialValue
            ]);
        const setNextValueData =
            SimpleNumberStorage.interface.encodeFunctionData(setValueFunction, [
                nextValue
            ]);

        await executeContractCall(setInitialValueData);

        const evmWithPatchedRunCall = evm as EVM & {
            runCall: (...args: any[]) => ReturnType<EVM["runCall"]>;
        };
        const originalRunCall = evmWithPatchedRunCall.runCall.bind(evm);
        let releaseCanonicalCall!: () => void;
        const canonicalLiveStateUpdated = new Promise<void>((resolve) => {
            evmWithPatchedRunCall.runCall = async (...args: any[]) => {
                const result = await originalRunCall(...args);
                resolve();
                await new Promise<void>((release) => {
                    releaseCanonicalCall = release;
                });
                return result;
            };
        });

        const canonicalCall = executeContractCall(setNextValueData);
        await canonicalLiveStateUpdated;
        let simulationCompleted = false;
        const simulation = simulateContractCall(getValueData).then((result) => {
            simulationCompleted = true;
            return result;
        });

        try {
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(simulationCompleted).to.equal(false);
        } finally {
            releaseCanonicalCall();
            await canonicalCall;
            evmWithPatchedRunCall.runCall = originalRunCall;
        }

        const resultAfterCanonicalRelease = await simulation;
        const valueAfterCanonicalRelease =
            ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256"],
                ethers.hexlify(resultAfterCanonicalRelease.returnValue)
            )[0];

        expect(valueAfterCanonicalRelease).to.equal(nextValue);
    });

    it("should serialize detached simulations", async function () {
        const evmWithPatchedRunCall = evm as EVM & {
            runCall: (...args: any[]) => ReturnType<EVM["runCall"]>;
        };
        const originalRunCall = evmWithPatchedRunCall.runCall.bind(evm);
        let activeRunCalls = 0;
        let maxActiveRunCalls = 0;

        evmWithPatchedRunCall.runCall = async (...args: any[]) => {
            activeRunCalls += 1;
            maxActiveRunCalls = Math.max(maxActiveRunCalls, activeRunCalls);

            try {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return await originalRunCall(...args);
            } finally {
                activeRunCalls -= 1;
            }
        };

        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        try {
            await Promise.all(
                Array.from({ length: 30 }, () =>
                    simulateContractCall(getValueData)
                )
            );
        } finally {
            evmWithPatchedRunCall.runCall = originalRunCall;
        }

        expect(maxActiveRunCalls).to.equal(1);
    });

    it("should serialize many detached canonical increments and simulations without corrupting state", async function () {
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");
        const incrementFunction =
            SimpleNumberStorage.interface.getFunction("increment");
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);
        const incrementData =
            SimpleNumberStorage.interface.encodeFunctionData(incrementFunction);
        const canonicalIncrementCount = 20;
        const simulationIncrementCount = 40;
        const initialValue = 10_000n;
        const setInitialValueData =
            SimpleNumberStorage.interface.encodeFunctionData(setValueFunction, [
                initialValue
            ]);

        await executeContractCall(setInitialValueData);

        const initialResult = await executeContractCall(getValueData);
        const valueBeforeIncrements = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            ethers.hexlify(initialResult.returnValue)
        )[0];
        expect(valueBeforeIncrements).to.equal(initialValue);

        const dbSizeBefore = getUnderlyingDbSize();
        const expectedFinalValue =
            initialValue + BigInt(canonicalIncrementCount);

        const simulatedIncrementResult =
            await simulateContractCall(incrementData);
        const simulatedIncrementReturnValue = ethers.hexlify(
            simulatedIncrementResult.returnValue
        );
        const simulatedIncrementValue =
            ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256"],
                simulatedIncrementReturnValue
            )[0];
        expect(simulatedIncrementValue).to.equal(initialValue + 1n);

        const canonicalWrites = Array.from(
            { length: canonicalIncrementCount },
            () => executeContractCall(incrementData)
        );
        const simulatedWrites = Array.from(
            { length: simulationIncrementCount },
            () => simulateContractCall(incrementData)
        );
        const [, simulatedResults] = await Promise.all([
            Promise.all(canonicalWrites),
            Promise.all(simulatedWrites)
        ]);

        for (const result of simulatedResults) {
            const value = ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256"],
                ethers.hexlify(result.returnValue)
            )[0];
            expect(value).to.equal(expectedFinalValue + 1n);
        }

        const finalResult = await executeContractCall(getValueData);
        const finalValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            ethers.hexlify(finalResult.returnValue)
        )[0];

        expect(finalValue).to.equal(expectedFinalValue);
        expect(finalValue).to.not.equal(
            initialValue +
                BigInt(canonicalIncrementCount + simulationIncrementCount)
        );
        expect(getUnderlyingDbSize()).to.be.greaterThan(dbSizeBefore);
    });

    it("should serialize canonical detached calls before entering evm.runCall", async function () {
        const evmWithPatchedRunCall = evm as EVM & {
            runCall: (...args: any[]) => ReturnType<EVM["runCall"]>;
        };
        const originalRunCall = evmWithPatchedRunCall.runCall.bind(evm);
        let activeRunCalls = 0;
        let maxActiveRunCalls = 0;

        evmWithPatchedRunCall.runCall = async (...args: any[]) => {
            activeRunCalls += 1;
            maxActiveRunCalls = Math.max(maxActiveRunCalls, activeRunCalls);

            try {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return await originalRunCall(...args);
            } finally {
                activeRunCalls -= 1;
            }
        };

        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);
        const setValueFunction =
            SimpleNumberStorage.interface.getFunction("setValue");

        try {
            const calls = Array.from({ length: 30 }, (_, index) => {
                if (index % 3 === 0) {
                    return executeContractCall(getValueData);
                }

                const setValueData =
                    SimpleNumberStorage.interface.encodeFunctionData(
                        setValueFunction,
                        [BigInt(index)]
                    );
                return executeContractCall(setValueData);
            });

            await Promise.all(calls);
        } finally {
            evmWithPatchedRunCall.runCall = originalRunCall;
        }

        expect(maxActiveRunCalls).to.equal(1);
    });

    it("should throw an error for invalid function calls", async function () {
        // Function signature that doesn't exist
        const invalidFunctionData = "0xffffffff";

        try {
            await executeContractCall(invalidFunctionData);
            // Should not reach here
            expect.fail("Expected call to fail");
        } catch (error: any) {
            // basic error message
            expect(error.message).to.include("EVM execution failed: revert");
        }
    });

    it("should properly decode Solidity revert errors", async function () {
        // Call a function that reverts with a custom error message
        const errorMessage = "Custom test error message";
        const revertFunction =
            SimpleNumberStorage.interface.getFunction("revertWithMessage");
        const revertFunctionData =
            SimpleNumberStorage.interface.encodeFunctionData(revertFunction, [
                errorMessage
            ]);

        try {
            await executeContractCall(revertFunctionData);
            // Should not reach here
            expect.fail("Expected the function to revert");
        } catch (error: any) {
            // custom error
            const customError = tryDecodeCustomError(error);
            expect(customError).to.not.be.null;
            expect(customError!.errorDescription.name).to.equal("Error");
            expect(customError!.errorDescription.args).to.have.length(1);
            expect(customError!.errorDescription.args[0]).to.equal(
                errorMessage
            );
            expect(customError!.originalError.message).to.equal(
                "EVM execution failed: Error"
            );
        }
    });
});
