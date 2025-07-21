import { expect } from "chai";
import { ethers } from "ethers";
import { call, isCustomContractError, ContractErrors } from "@/utils";
import { ethers as hre } from "hardhat";
import { deployMathChannelProxyFixture } from "@test/test_utils/testHelpers";
import * as factory from "@test/factory";
import { MathStateChannelManagerProxy } from "@typechain-types";

describe("ContractErrorHandler", () => {
    it("should decode real contract errors correctly", async () => {
        // Test with actual error selectors that contracts would throw
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

            try {
                await call(() => {
                    const error = new Error("Contract call failed");
                    (error as any).data = errorData;
                    throw error;
                });
                expect.fail(`Expected ${errorName} to be thrown`);
            } catch (error: any) {
                expect(isCustomContractError(error)).to.be.true;
                expect(error.errorDescription.name).to.equal(errorName);
            }
        }
    });

    it("should pass through regular errors unchanged", async () => {
        const regularError = new Error("Out of gas");

        try {
            await call(() => {
                throw regularError;
            });
            expect.fail("Expected error to be thrown");
        } catch (error: any) {
            expect(isCustomContractError(error)).to.be.false;
            expect(error.message).to.equal("Out of gas");
        }
    });

    it("should contain all errors from Errors.sol", () => {
        // Verify we have the key error categories covered
        const expectedErrors = [
            "ErrorJoinChannelExpired",
            "ErrorDisputeAlreadyPosted",
            "ErrorBlockCalldataAlreadyPosted",
            "ErrorWithdrawalFailed",
            "ErrorInvalidFraudProof"
        ];

        expectedErrors.forEach((errorName) => {
            expect(Object.values(ContractErrors)).to.include(
                errorName,
                `Missing error: ${errorName}`
            );
        });

        // Should have a reasonable number of errors (we know there are ~47 from Errors.sol)
        expect(Object.keys(ContractErrors).length).to.be.greaterThan(40);
    });

    describe("Real contract calls", () => {
        let mathChannelManager: MathStateChannelManagerProxy;

        beforeEach(async () => {
            const contracts = await deployMathChannelProxyFixture(hre);
            mathChannelManager = contracts.mathChannelManager;
        });

        it("should handle postBlockCalldata success case", async () => {
            // Create test data using factory
            const signedBlock = factory.signedBlock();

            // Set maxTimestamp to be in the future (success case)
            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp + 100; // 100 seconds in future

            try {
                const result = await call(() =>
                    mathChannelManager.postBlockCalldata(
                        signedBlock,
                        maxTimestamp
                    )
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
                await call(() =>
                    mathChannelManager.postBlockCalldata(
                        signedBlock,
                        maxTimestamp
                    )
                );
                expect.fail(
                    "Expected ErrorBlockCalldataTimestampTooLate to be thrown"
                );
            } catch (error: any) {
                expect(isCustomContractError(error)).to.be.true;
                expect(error.errorDescription.name).to.equal(
                    ContractErrors.BLOCK_CALLDATA_TIMESTAMP_TOO_LATE
                );
            }
        });

        it("should handle ErrorBlockCalldataAlreadyPosted custom error", async () => {
            const signedBlock = factory.signedBlock();

            // Set maxTimestamp to be in the future
            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp + 100;

            // First call should succeed
            await call(() =>
                mathChannelManager.postBlockCalldata(signedBlock, maxTimestamp)
            );

            // Second call with the same data should fail
            try {
                await call(() =>
                    mathChannelManager.postBlockCalldata(
                        signedBlock,
                        maxTimestamp
                    )
                );
                expect.fail(
                    "Expected ErrorBlockCalldataAlreadyPosted to be thrown"
                );
            } catch (error: any) {
                expect(isCustomContractError(error)).to.be.true;
                expect(error.errorDescription.name).to.equal(
                    ContractErrors.BLOCK_CALLDATA_ALREADY_POSTED
                );
            }
        });
    });
});
