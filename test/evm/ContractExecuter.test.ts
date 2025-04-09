import { ethers } from "hardhat";
import { expect } from "chai";
import { EVM } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { ContractExecuter } from "@/evm";
import {
    getSimpleNumberStorageDeploymentTransaction,
    getSimpleNumberStorageFactory
} from "../fixtures/SimpleNumberStorage.fixture";

describe("ContractExecuter", function () {
    let evm: EVM;
    let contractAddress: Address;
    let contractExecuter: ContractExecuter;
    let SimpleNumberStorage: any; // Store the contract factory

    // Deploy the SimpleNumberStorage contract
    before(async function () {
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

        contractExecuter = new ContractExecuter(evm, contractAddress);
    });

    it("should successfully execute a call to get a value", async function () {
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await contractExecuter.executeCall(getValueData);

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

        await contractExecuter.executeCall(setValueData);

        // Get the value to verify it was set
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await contractExecuter.executeCall(getValueData);
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

        await contractExecuter.executeCall(setStateData);

        // Get the value to verify it was set
        const getValueFunction =
            SimpleNumberStorage.interface.getFunction("getValue");
        const getValueData =
            SimpleNumberStorage.interface.encodeFunctionData(getValueFunction);

        const result = await contractExecuter.executeCall(getValueData);
        const returnValue = ethers.hexlify(result.returnValue);
        const decodedValue = ethers.AbiCoder.defaultAbiCoder().decode(
            ["uint256"],
            returnValue
        );
        expect(decodedValue[0]).to.equal(newValue);
    });

    it("should throw an error for invalid function calls", async function () {
        // Function signature that doesn't exist
        const invalidFunctionData = "0xffffffff";

        try {
            await contractExecuter.executeCall(invalidFunctionData);
            // Should not reach here
            expect.fail("Expected call to fail");
        } catch (error: any) {
            expect(error.message).to.include("data out-of-bounds");
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
            await contractExecuter.executeCall(revertFunctionData);
            // Should not reach here
            expect.fail("Expected the function to revert");
        } catch (error: any) {
            // The decoded error message should contain our custom error
            expect(error.message).to.include("EVM execution error");
            expect(error.message).to.include(errorMessage);
        }
    });
});
