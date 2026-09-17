import { SignedBlockEthersType } from "@/types/ethers";
import {
    CustomEvmError,
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { artifacts, errorAbis } from "@/utils/GeneratedArtifacts";
import { routedFacets } from "@/utils/routedFacets";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as factory from "@test/factory";
import { deployMathChannelProxyFixture } from "@test/test_utils/testHelpers";
import { StateChannelManagerInterface } from "@typechain-types";
import { expect } from "chai";
import { ethers, ZeroAddress, ZeroHash } from "ethers";
import { ethers as hre } from "hardhat";

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

    it("includes every routed facet in generated artifacts", () => {
        expect(
            artifacts.map((artifact) => artifact.contractName)
        ).to.include.members(routedFacets.map((facet) => facet.facetName));
    });

    it("includes every ECDSA error reachable through manager facets", () => {
        const names = new Set(errorAbis.map((errorAbi) => errorAbi.name));

        expect(names).to.include("ECDSAInvalidSignature");
        expect(names).to.include("ECDSAInvalidSignatureLength");
        expect(names).to.include("ECDSAInvalidSignatureS");
    });

    it("decodes ECDSAInvalidSignatureS with its argument", () => {
        const fragment = errorAbis.find(
            (errorAbi) => errorAbi.name === "ECDSAInvalidSignatureS"
        )!;
        const data = new ethers.Interface([fragment]).encodeErrorResult(
            "ECDSAInvalidSignatureS",
            [ZeroHash]
        );
        const decoded = tryDecodeCustomError({ data });

        expect(decoded?.errorDescription.name).to.equal(
            "ECDSAInvalidSignatureS"
        );
        expect(decoded?.errorDescription.args[0]).to.equal(ZeroHash);
    });
});

describe("ContractCaller and ContractErrors", () => {
    it("should decode  contract errors correctly", async () => {
        const testCases = [
            "RaceConditionJoinChannelExpired",
            "RaceConditionDisputeKillPeriodExpired",
            "RaceConditionDisputeTimeoutWindowCreatedTooEarly",
            "ErrorDisputeAlreadyPosted",
            "ErrorBlockCalldataAlreadyPosted"
        ];

        for (const errorName of testCases) {
            // Encoded from the error's own ABI fragment: the list deliberately
            // mixes argument-less and argument-bearing errors, and a
            // hand-hashed `Name()` selector stops matching as soon as an error
            // gains a parameter.
            const errorData = factory.encodedCustomErrorRevert(errorName);

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

    it("passes the decoded custom error to its handler", async () => {
        const errorData = factory.encodedCustomErrorRevert(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
        const originalError = Object.assign(new Error("execution reverted"), {
            data: errorData
        });
        let handledError: CustomEvmError | undefined;

        const handled = await tryHandleEvmError(originalError, {
            handlers: {
                RaceConditionDisputeEvidencePeriodExpired: (customError) => {
                    handledError = customError;
                }
            }
        });

        expect(handled).to.be.true;
        expect(handledError!.originalError).to.equal(originalError);
        expect(handledError!.errorDescription.name).to.equal(
            "RaceConditionDisputeEvidencePeriodExpired"
        );
    });

    describe("Real contract calls", () => {
        let mathChannelManager: StateChannelManagerInterface;
        let testSigner: HardhatEthersSigner;
        // a second account, so a block author can differ from the sender
        let blockAuthorSigner: HardhatEthersSigner;

        beforeEach(async () => {
            const contracts = await deployMathChannelProxyFixture(hre);
            mathChannelManager = contracts.mathChannelManager;
            const signers = await hre.getSigners();
            testSigner = signers[0];
            blockAuthorSigner = signers[1];
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
            // the block names the second account as its author while the
            // transaction is sent by the first, so the two payload addresses
            // are different and cannot be swapped without failing
            const signedBlock = factory.signedBlock({
                encodedBlock: factory
                    .block(undefined, blockAuthorSigner)
                    .encode()
            });

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
                // expectedAuthor is the block's participant, actualSender the caller
                const args = customError!.errorDescription.args;
                expect(args[0]).to.equal(blockAuthorSigner.address);
                expect(args[1]).to.equal(testSigner.address);
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
            // mutually distinguishable operands: a fork id that is not the
            // factory default and a non-zero transaction count
            const forkId = ethers.id("already-posted-fork");
            const transactionCnt = 7n;
            const signedBlock = factory.signedBlock({
                encodedBlock: factory
                    .block({ header: { forkId, transactionCnt } }, testSigner)
                    .encode()
            });

            // Set maxTimestamp to be in the future
            const currentBlock = await hre.provider.getBlock("latest");
            const maxTimestamp = currentBlock!.timestamp + 100;

            // First call should succeed
            const firstPost = await mathChannelManager.postBlockCalldata(
                signedBlock,
                maxTimestamp
            );
            const firstPostReceipt = await firstPost.wait();
            const firstPostBlock = await hre.provider.getBlock(
                firstPostReceipt!.blockNumber
            );

            // Derived here from the first post's payload and its mined
            // timestamp - never read back out of the contract under test
            const expectedCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    [SignedBlockEthersType, "uint256"],
                    [
                        [signedBlock.encodedBlock, signedBlock.signature],
                        firstPostBlock!.timestamp
                    ]
                )
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
                // forkId, transactionCnt, participant, existingCommitment
                const args = customError!.errorDescription.args;
                expect(args[0]).to.equal(forkId);
                expect(args[1]).to.equal(transactionCnt);
                expect(args[2]).to.equal(testSigner.address);
                expect(args[3]).to.equal(expectedCommitment);
            }
        });
    });
});

describe("encodedCustomErrorRevert", () => {
    it("encodes an argument-less error as its bare selector", () => {
        const errorData = factory.encodedCustomErrorRevert(
            "ErrorNoDisputesProvided"
        );

        // 0x + 8 hex chars: a selector with no argument words after it
        expect(errorData).to.have.lengthOf(10);
        const customError = tryDecodeCustomError({ data: errorData });
        expect(customError!.errorDescription.name).to.equal(
            "ErrorNoDisputesProvided"
        );
        expect(customError!.errorDescription.args.length).to.equal(0);
    });

    it("encodes an argument-bearing error with a zero value per parameter", () => {
        const errorData = factory.encodedCustomErrorRevert(
            "ErrorDisputeAlreadyPosted"
        );

        const customError = tryDecodeCustomError({ data: errorData });
        expect(customError!.errorDescription.name).to.equal(
            "ErrorDisputeAlreadyPosted"
        );
        // ErrorDisputeAlreadyPosted(bytes32 forkId, address disputer)
        expect([...customError!.errorDescription.args]).to.deep.equal([
            ZeroHash,
            ZeroAddress
        ]);
    });

    it("throws for a name that is not a contract error", () => {
        expect(() =>
            factory.encodedCustomErrorRevert("ErrorThatDoesNotExist")
        ).to.throw("Unknown contract error: ErrorThatDoesNotExist");
    });
});
