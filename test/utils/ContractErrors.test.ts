import { expect } from "chai";
import { ethers } from "ethers";
import { isCustomEvmError, decodeErrorProxy } from "@/utils/evmErrorHandler";
import { ethers as hre } from "hardhat";
import { deployMathChannelProxyFixture } from "@test/test_utils/testHelpers";
import * as factory from "@test/factory";
import { MathStateChannelManagerProxy } from "@typechain-types";
import { artifacts, errorAbis } from "@/utils/GeneratedArtifacts";

describe("artifacts loading", () => {
    it("should load all required facet artifacts", () => {
        expect(artifacts).to.be.an("array");
        expect(artifacts.length).to.be.greaterThan(0);

        // Check that each artifact has the expected structure
        artifacts.forEach((artifact) => {
            expect(artifact).to.have.property("abi");
            expect(artifact.abi).to.be.an("array");
            expect(artifact).to.have.property("contractName");
            expect(artifact).to.have.property("bytecode");
        });
    });

    it("should extract error ABIs from artifacts", () => {
        expect(errorAbis).to.be.an("array");

        // Check that all extracted items are actually errors
        errorAbis.forEach((errorAbi: any) => {
            expect(errorAbi).to.have.property("type", "error");
            expect(errorAbi).to.have.property("name");
        });
    });
});

describe("ContractCaller and ContractErrors", () => {
    it("should decode  contract errors correctly", async () => {
        const testCases = [
            "ErrorJoinChannelExpired",
            "ErrorDisputeAlreadyPosted",
            "ErrorBlockCalldataAlreadyPosted"
        ];

        for (const errorName of testCases) {
            // Create the error selector (first 4 bytes of keccak256)
            const fullHash = ethers.keccak256(
                ethers.toUtf8Bytes(`${errorName}()`)
            );
            const errorData = fullHash.slice(0, 10); // 0x + 8 hex chars = 4 bytes

            const mockContract = decodeErrorProxy({
                testMethod: async () => {
                    const error = new Error("Contract call failed");
                    (error as any).data = errorData;
                    throw error;
                }
            });

            try {
                await mockContract.testMethod();
                expect.fail(`Expected ${errorName} to be thrown`);
            } catch (error: any) {
                expect(isCustomEvmError(error)).to.be.true;
                expect(error.errorDescription.name).to.equal(errorName);
            }
        }
    });

    it("should pass through regular errors unchanged", async () => {
        const regularError = new Error("Out of gas");

        // Create a mock contract object that throws a regular error
        const mockContract = decodeErrorProxy({
            testMethod: async () => {
                throw regularError;
            }
        });

        try {
            await mockContract.testMethod();
            expect.fail("Expected error to be thrown");
        } catch (error: any) {
            expect(isCustomEvmError(error)).to.be.false;
            expect(error.message).to.equal("Out of gas");
        }
    });

    describe("Real contract calls", () => {
        let mathChannelManager: MathStateChannelManagerProxy;

        beforeEach(async () => {
            const contracts = await deployMathChannelProxyFixture(hre);
            mathChannelManager = decodeErrorProxy(contracts.mathChannelManager);
        });

        it("should handle postBlockCalldata success case", async () => {
            // Create test data using factory
            const signedBlock = factory.signedBlock();

            // Set maxTimestamp to be in the future (success case)
            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp + 100; // 100 seconds in future

            try {
                const result = await mathChannelManager.postBlockCalldata(
                    signedBlock,
                    maxTimestamp
                );

                // Should succeed without throwing
                expect(result).to.not.be.undefined;
            } catch (error: any) {
                // This should not happen
                expect.fail(`Unexpected error: ${error.message}`);
            }
        });

        it("should handle ErrorBlockCalldataTimestampTooLate custom error", async () => {
            const signedBlock = factory.signedBlock();

            // Set maxTimestamp to be in the past (error case)
            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp - 100;

            try {
                await mathChannelManager.postBlockCalldata(
                    signedBlock,
                    maxTimestamp
                );
                expect.fail(
                    "Expected ErrorBlockCalldataTimestampTooLate to be thrown"
                );
            } catch (error: any) {
                expect(isCustomEvmError(error)).to.be.true;
                expect(error.errorDescription.name).to.equal(
                    "ErrorBlockCalldataTimestampTooLate"
                );
            }
        });

        it("should handle ErrorBlockCalldataAlreadyPosted custom error", async () => {
            const signedBlock = factory.signedBlock();

            // Set maxTimestamp to be in the future
            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp + 100;

            // First call should succeed
            await mathChannelManager.postBlockCalldata(
                signedBlock,
                maxTimestamp
            );

            // Second call with the same data should fail
            try {
                await mathChannelManager.postBlockCalldata(
                    signedBlock,
                    maxTimestamp
                );
                expect.fail(
                    "Expected ErrorBlockCalldataAlreadyPosted to be thrown"
                );
            } catch (error: any) {
                expect(isCustomEvmError(error)).to.be.true;
                expect(error.errorDescription.name).to.equal(
                    "ErrorBlockCalldataAlreadyPosted"
                );
            }
        });
    });
});
