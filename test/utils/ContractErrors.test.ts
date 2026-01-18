import { expect } from "chai";
import { ethers } from "ethers";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import { ethers as hre } from "hardhat";
import { deployMathChannelProxyFixture } from "@test/test_utils/testHelpers";
import * as factory from "@test/factory";
import { StateChannelManagerProxy } from "@typechain-types";
import { artifacts, errorAbis } from "@/utils/GeneratedArtifacts";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("artifacts loading", () => {
    it("should load all required facet artifacts", () => {
        expect(artifacts).to.be.an("array");
        expect(artifacts.length).to.be.greaterThan(0);

        // Check that each artifact has the expected structure
        artifacts.forEach((artifact: any) => {
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
            "RaceConditionJoinChannelExpired",
            "ErrorDisputeAlreadyPosted",
            "ErrorBlockCalldataAlreadyPosted"
        ];

        for (const errorName of testCases) {
            // Create the error selector (first 4 bytes of keccak256)
            const fullHash = ethers.keccak256(
                ethers.toUtf8Bytes(`${errorName}()`)
            );
            const errorData = fullHash.slice(0, 10); // 0x + 8 hex chars = 4 bytes

            const mockContract = {
                testMethod: async () => {
                    const error = new Error("Contract call failed");
                    (error as any).data = errorData;
                    throw error;
                }
            };

            try {
                await mockContract.testMethod();
                expect.fail(`Expected ${errorName} to be thrown`);
            } catch (error: any) {
                const customError = tryDecodeCustomError(error);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(errorName);
            }
        }
    });

    it("should pass through regular errors unchanged", async () => {
        const regularError = new Error("Out of gas");

        // Create a mock contract object that throws a regular error
        const mockContract = {
            testMethod: async () => {
                throw regularError;
            }
        };
        try {
            await mockContract.testMethod();
            expect.fail("Expected error to be thrown");
        } catch (error: any) {
            const customError = tryDecodeCustomError(error);
            expect(customError).to.equal(null);
            expect(error.message).to.equal("Out of gas");
        }
    });

    describe("Real contract calls", () => {
        let mathChannelManager: StateChannelManagerProxy;
        let testSigner: HardhatEthersSigner;

        beforeEach(async () => {
            const contracts = await deployMathChannelProxyFixture(hre);
            mathChannelManager = contracts.mathChannelManager;
            const signers = await hre.getSigners();
            testSigner = signers[0];
        });

        it("should handle postBlockCalldata success case", async () => {
            // Create test data using factory
            const signedBlock = factory.signedBlock(undefined, testSigner);

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

        it("should handle ErrorBlockCalldataMsgSenderNotBlockAuthor custom error", async () => {
            const signedBlock = factory.signedBlock(); //will be random signer

            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp + 100;

            try {
                await mathChannelManager.postBlockCalldata(
                    signedBlock,
                    maxTimestamp
                );
                expect.fail(
                    "Expected ErrorBlockCalldataMsgSenderNotBlockAuthor to be thrown"
                );
            } catch (error: any) {
                const customError = tryDecodeCustomError(error);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(
                    "ErrorBlockCalldataMsgSenderNotBlockAuthor"
                );
            }
        });

        it("should handle RaceConditionBlockCalldataTimestampTooLate custom error", async () => {
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
                    "Expected RaceConditionBlockCalldataTimestampTooLate to be thrown"
                );
            } catch (error: any) {
                const customError = tryDecodeCustomError(error);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(
                    "RaceConditionBlockCalldataTimestampTooLate"
                );
            }
        });

        it("should handle ErrorBlockCalldataAlreadyPosted custom error", async () => {
            const signedBlock = factory.signedBlock(undefined, testSigner);

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
                const customError = tryDecodeCustomError(error);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(
                    "ErrorBlockCalldataAlreadyPosted"
                );
            }
        });
    });
});
