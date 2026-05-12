import { ethers } from "hardhat";
import { expect } from "chai";
import { EVM } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { ContractExecutor } from "@/evm";
import Clock from "@/Clock";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import {
    getSimpleNumberStorageDeploymentTransaction,
    getSimpleNumberStorageFactory
} from "../fixtures/SimpleNumberStorage.fixture";

describe("ContractExecutor", function () {
    let evm: EVM;
    let contractAddress: Address;
    let contractExecutor: ContractExecutor;
    let SimpleNumberStorage: any; // Store the contract factory

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

        contractExecutor = new ContractExecutor(evm, contractAddress);
    });

    it("should successfully execute a call to get a value", async function () {
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await contractExecutor.executeCall(getValueData);

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

        await contractExecutor.executeCall(setValueData);

        // Get the value to verify it was set
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await contractExecutor.executeCall(getValueData);
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

        await contractExecutor.executeCall(setStateData);

        // Get the value to verify it was set
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await contractExecutor.executeCall(getValueData);
        const returnValue = ethers.hexlify(result.returnValue);
        const decodedValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            returnValue
        );
        expect(decodedValue[0]).to.equal(newValue);
    });

    it("should serialize detached calls before entering evm.runCall", async function () {
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
                    return contractExecutor.executeCall(getValueData);
                }

                const setValueData =
                    SimpleNumberStorage.interface.encodeFunctionData(
                        setValueFunction,
                        [BigInt(index)]
                    );
                return contractExecutor.executeCall(setValueData);
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
            await contractExecutor.executeCall(invalidFunctionData);
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
            await contractExecutor.executeCall(revertFunctionData);
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
