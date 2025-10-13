import ValidationService from "../../src/stateManager/ValidationService";
import { BlockValidationResult } from "../../src/types";
import { expect } from "chai";
import sinon from "sinon";

import {
    BlockBuilder,
    MockSetup,
    ValidationFailure,
    EXPECTED_RESULTS
} from "./testUtils";

describe("ValidationService - Progressive Validation Tests", () => {
    let validationService: ValidationService;
    let mockSetup: MockSetup;

    beforeEach(() => {
        sinon.restore();
        mockSetup = new MockSetup();

        validationService = new ValidationService(
            mockSetup.mockStorage,
            mockSetup.mockDiamondStateMachine,
            mockSetup.mockStateChannelManagerContract,
            mockSetup.mockTimeConfig,
            mockSetup.mockStateManager
        );

        // Make validationService available to MockSetup for internal stubs
        mockSetup.validationService = validationService;
    });

    afterEach(() => {
        mockSetup.cleanup();
    });

    describe("Baseline: Completely Valid Block", () => {
        it("should pass all validations and return SUCCESS", async () => {
            // Manually set up for success without using failWith()
            mockSetup.setupForSuccess();
            const validBlock = BlockBuilder.create(mockSetup).build();

            const result = await validationService.validateBlockConfirmation(
                validBlock,
                mockSetup.mockStrategy
            );

            expect(result).to.equal(BlockValidationResult.SUCCESS);

            // Verify no failure strategies were called
            Object.values(mockSetup.mockStrategy).forEach(
                (strategyMethod: any) => {
                    if (typeof strategyMethod.called !== "undefined") {
                        expect(strategyMethod.called).to.be.false;
                    }
                }
            );
        });
    });

    describe("Progressive Failures: From Last to First Validation Step", () => {
        describe("Step 10: Time Validation Failures", () => {
            it("should fail with subjective invalid timestamp", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.SUBJECTIVE_TIMESTAMP_INVALID)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[
                        ValidationFailure.SUBJECTIVE_TIMESTAMP_INVALID
                    ]
                );
                expect(
                    mockSetup.mockStrategy.subjectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should fail when posted on-chain too late", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.POSTED_ON_CHAIN_TOO_LATE)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.POSTED_ON_CHAIN_TOO_LATE]
                );
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should fail with objective invalid timestamp (too late)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.OBJECTIVE_TIMESTAMP_TOO_LATE)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[
                        ValidationFailure.OBJECTIVE_TIMESTAMP_TOO_LATE
                    ]
                );
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should fail with objective invalid timestamp (basic)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[
                        ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID
                    ]
                );
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should fail when timestamp is in the past (monotonic ordering)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.TIMESTAMP_IN_PAST)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.TIMESTAMP_IN_PAST]
                );
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should fail when timestamp is outside P2P time window", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.TIMESTAMP_OUTSIDE_P2P_WINDOW)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[
                        ValidationFailure.TIMESTAMP_OUTSIDE_P2P_WINDOW
                    ]
                );
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should fail when current timestamp is too far in the future", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(
                        ValidationFailure.CURRENT_TIMESTAMP_TOO_FAR_FUTURE
                    )
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[
                        ValidationFailure.CURRENT_TIMESTAMP_TOO_FAR_FUTURE
                    ]
                );
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });
        });

        describe("Step 9: Leader Validation Failures", () => {
            it("should fail when author is not the next leader", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.WRONG_LEADER)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.WRONG_LEADER]
                );
                expect(
                    mockSetup.mockStrategy.invalidStateTransitionDetected.called
                ).to.be.true;
            });
        });

        describe("Step 8: Linking Validation Failures", () => {
            it("should fail with wrong genesis for unlinked genesis block", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.WRONG_GENESIS)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.WRONG_GENESIS]
                );
                expect(mockSetup.mockStrategy.wrongGenesisDetected.called).to.be
                    .true;
            });

            it("should fail for unlinked non-genesis block", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.NOT_LINKED_NON_GENESIS)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.NOT_LINKED_NON_GENESIS]
                );
                expect(
                    mockSetup.mockStrategy.blockIsNotLinkedAndIsNotFirstBlock
                        .called
                ).to.be.true;
            });
        });

        describe("Step 7: Height Validation Failures", () => {
            it("should fail when block height is too high (future block)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.FUTURE_BLOCK)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.FUTURE_BLOCK]
                );
                expect(
                    mockSetup.mockStrategy.blockIsNotNextAndIsInTheFuture.called
                ).to.be.true;
            });
        });

        describe("Step 6: Fork Dispute Validation Failures", () => {
            it("should fail when fork is disputed locally", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.FORK_DISPUTED_LOCALLY)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.FORK_DISPUTED_LOCALLY]
                );
                expect(mockSetup.mockStrategy.blockForkIsDisputed.called).to.be
                    .true;
            });

            it("should fail when fork is disputed on-chain", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.FORK_DISPUTED_ON_CHAIN)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.FORK_DISPUTED_ON_CHAIN]
                );
                expect(mockSetup.mockStrategy.blockForkIsDisputed.called).to.be
                    .true;
            });
        });

        describe("Step 5: Conflict Detection Failures", () => {
            it("should detect double sign (same author conflict)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.DOUBLE_SIGN)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.DOUBLE_SIGN]
                );
                expect(mockSetup.mockStrategy.doubleSignDetected.called).to.be
                    .true;
            });

            it("should detect invalid state transition (different author, linked)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.INVALID_STATE_TRANSITION)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.INVALID_STATE_TRANSITION]
                );
                expect(
                    mockSetup.mockStrategy.invalidStateTransitionDetected.called
                ).to.be.true;
            });

            it("should handle conflicting but not linked block", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.CONFLICTING_NOT_LINKED)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.CONFLICTING_NOT_LINKED]
                );
                expect(
                    mockSetup.mockStrategy.conflictingButNotLinkedBlockDetected
                        .called
                ).to.be.true;
            });
        });

        describe("Step 4: Author Participant Validation Failures", () => {
            it("should fail when author is not a participant", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.AUTHOR_NOT_PARTICIPANT)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.AUTHOR_NOT_PARTICIPANT]
                );
                expect(
                    mockSetup.mockStrategy.blockAuthorIsNotParticipant.called
                ).to.be.true;
            });
        });

        describe("Step 3: Duplicate Block Validation Failures", () => {
            it("should handle queued block with invalid signers", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.QUEUED_INVALID_SIGNERS)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.QUEUED_INVALID_SIGNERS]
                );
                expect(
                    mockSetup.mockStrategy.notAllSingersAreParticipants.called
                ).to.be.true;
            });

            it("should handle existing block with no new signatures", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.NO_NEW_SIGNATURES)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.NO_NEW_SIGNATURES]
                );
                expect(
                    mockSetup.mockStrategy.noNewSignaturesOnExistingBlock.called
                ).to.be.true;
            });

            it("should handle existing block with new invalid signatures", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.INVALID_NEW_SIGNERS)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.INVALID_NEW_SIGNERS]
                );
                expect(
                    mockSetup.mockStrategy.notAllSingersAreParticipants.called
                ).to.be.true;
            });
        });

        describe("Step 2: Channel Open Validation Failures", () => {
            it("should fail when channel is not open (forkId is ZeroHash)", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.CHANNEL_NOT_OPEN)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.CHANNEL_NOT_OPEN]
                );
                expect(mockSetup.mockStrategy.channelNotOpened.called).to.be
                    .true;
            });
        });

        describe("Step 1: Channel ID Validation Failures", () => {
            it("should fail when block has wrong channel ID", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.WRONG_CHANNEL_ID)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.WRONG_CHANNEL_ID]
                );
                expect(mockSetup.mockStrategy.wrongChannel.called).to.be.true;
            });

            it("should fail when state manager has no channel ID", async () => {
                const invalidBlock = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.NULL_CHANNEL_ID)
                    .build();

                const result =
                    await validationService.validateBlockConfirmation(
                        invalidBlock,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(
                    EXPECTED_RESULTS[ValidationFailure.NULL_CHANNEL_ID]
                );
                expect(mockSetup.mockStrategy.wrongChannel.called).to.be.true;
            });
        });
    });

    describe("Comprehensive Validation Flow Tests", () => {
        it("should validate all failure types have correct expected results", () => {
            // Ensure we have covered all validation failures
            const allFailures = Object.values(
                ValidationFailure
            ) as ValidationFailure[];
            const coveredFailures = Object.keys(EXPECTED_RESULTS);

            expect(coveredFailures.length).to.equal(allFailures.length);

            allFailures.forEach((failure) => {
                expect(EXPECTED_RESULTS[failure]).to.not.be.undefined;
            });
        });

        it("should demonstrate progressive failure approach concept", async () => {
            // This test demonstrates that we have comprehensive coverage
            // of all validation failure points from last to first step
            const allFailures = Object.values(
                ValidationFailure
            ) as ValidationFailure[];
            const coveredFailures = Object.keys(EXPECTED_RESULTS);

            expect(coveredFailures.length).to.equal(allFailures.length);

            // Verify we have the right progression from last validation step to first
            const progressiveOrder = [
                // Step 10: Time validation (last)
                ValidationFailure.SUBJECTIVE_TIMESTAMP_INVALID,
                ValidationFailure.POSTED_ON_CHAIN_TOO_LATE,
                ValidationFailure.OBJECTIVE_TIMESTAMP_TOO_LATE,
                ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID,
                ValidationFailure.TIMESTAMP_IN_PAST,
                ValidationFailure.TIMESTAMP_OUTSIDE_P2P_WINDOW,
                ValidationFailure.CURRENT_TIMESTAMP_TOO_FAR_FUTURE,

                // Step 9: Leader validation
                ValidationFailure.WRONG_LEADER,

                // Step 8: Linking validation
                ValidationFailure.WRONG_GENESIS,
                ValidationFailure.NOT_LINKED_NON_GENESIS,

                // Step 7: Height validation
                ValidationFailure.FUTURE_BLOCK,

                // Step 6: Fork dispute validation
                ValidationFailure.FORK_DISPUTED_LOCALLY,
                ValidationFailure.FORK_DISPUTED_ON_CHAIN,

                // Step 5: Conflict detection
                ValidationFailure.DOUBLE_SIGN,
                ValidationFailure.INVALID_STATE_TRANSITION,
                ValidationFailure.CONFLICTING_NOT_LINKED,

                // Step 4: Author participant validation
                ValidationFailure.AUTHOR_NOT_PARTICIPANT,

                // Step 3: Duplicate validation
                ValidationFailure.QUEUED_INVALID_SIGNERS,
                ValidationFailure.NO_NEW_SIGNATURES,
                ValidationFailure.INVALID_NEW_SIGNERS,

                // Step 2: Channel open validation
                ValidationFailure.CHANNEL_NOT_OPEN,

                // Step 1: Channel ID validation (first)
                ValidationFailure.WRONG_CHANNEL_ID,
                ValidationFailure.NULL_CHANNEL_ID
            ];

            // Verify all failures in our progressive order have expected results
            progressiveOrder.forEach((failure) => {
                expect(EXPECTED_RESULTS[failure]).to.not.be.undefined;
            });

            // This demonstrates the progressive approach: we test failures
            // from the last validation step (time) to the first (channel ID)
            expect(progressiveOrder.length).to.equal(allFailures.length);
        });
    });

    describe("Helper Methods Coverage", () => {
        describe("isChannelOpen", () => {
            it("should return true for non-zero hash", () => {
                expect((validationService as any).isChannelOpen("0xnonzero")).to
                    .be.true;
            });

            it("should return false for ZeroHash", () => {
                expect(
                    (validationService as any).isChannelOpen(
                        "0x0000000000000000000000000000000000000000000000000000000000000000"
                    )
                ).to.be.false;
            });
        });

        describe("fetchOnChainTimestamp", () => {
            it("should return undefined when commitment not found", async () => {
                mockSetup.mockStateChannelManagerContract.getBlockCallDataCommitment.resolves(
                    { found: false }
                );

                const result = await (
                    validationService as any
                ).fetchOnChainTimestamp(BlockBuilder.create(mockSetup).build());

                expect(result).to.be.undefined;
            });

            it("should return timestamp when commitment found", async () => {
                mockSetup.mockStateChannelManagerContract.getBlockCallDataCommitment.resolves(
                    {
                        found: true,
                        blockCalldataCommitment: "0xcommitment"
                    }
                );
                mockSetup.mockStateChannelManagerContract.queryFilter.resolves([
                    {
                        args: {
                            signedBlock: {},
                            timestamp: 1500n
                        }
                    }
                ]);

                const result = await (
                    validationService as any
                ).fetchOnChainTimestamp(BlockBuilder.create(mockSetup).build());

                expect(result).to.equal(1500);
            });

            it("should handle errors gracefully", async () => {
                mockSetup.mockStateChannelManagerContract.getBlockCallDataCommitment.rejects(
                    new Error("Network error")
                );

                const result = await (
                    validationService as any
                ).fetchOnChainTimestamp(BlockBuilder.create(mockSetup).build());

                expect(result).to.be.undefined;
            });
        });

        describe("fetchBlockCommitmentCalldata", () => {
            it("should return undefined when multiple logs found", async () => {
                mockSetup.mockStateChannelManagerContract.queryFilter.resolves([
                    { args: { signedBlock: {}, timestamp: 1500n } },
                    { args: { signedBlock: {}, timestamp: 1600n } }
                ]);

                const result = await (
                    validationService as any
                ).fetchBlockCommitmentCalldata(
                    BlockBuilder.create(mockSetup).build(),
                    "0xcommitment"
                );

                expect(result).to.be.undefined;
            });

            it("should return undefined for no logs", async () => {
                mockSetup.mockStateChannelManagerContract.queryFilter.resolves(
                    []
                );

                const result = await (
                    validationService as any
                ).fetchBlockCommitmentCalldata(
                    BlockBuilder.create(mockSetup).build(),
                    "0xcommitment"
                );

                expect(result).to.be.undefined;
            });

            it("should return data for single log", async () => {
                mockSetup.mockStateChannelManagerContract.queryFilter.resolves([
                    { args: { signedBlock: {}, timestamp: 1500n } }
                ]);

                const result = await (
                    validationService as any
                ).fetchBlockCommitmentCalldata(
                    BlockBuilder.create(mockSetup).build(),
                    "0xcommitment"
                );

                expect(result).to.deep.equal({
                    signedBlock: {},
                    timestamp: 1500
                });
            });
        });

        describe("isPostedOnChainTooLate", () => {
            it("should return true when posted too late", async () => {
                const blockPostedLate = BlockBuilder.create(mockSetup).build();
                blockPostedLate.onChainTimestamp = 8000; // Way too late

                const result = await (
                    validationService as any
                ).isPostedOnChainTooLate(900, blockPostedLate);

                expect(result).to.be.true;
            });

            it("should return false when posted on time", async () => {
                const blockPostedOnTime =
                    BlockBuilder.create(mockSetup).build();
                blockPostedOnTime.onChainTimestamp = 5000; // Within allowed window

                const result = await (
                    validationService as any
                ).isPostedOnChainTooLate(900, blockPostedOnTime);

                expect(result).to.be.false;
            });

            it("should return false when no onChain timestamp available", async () => {
                const blockWithoutOnChain =
                    BlockBuilder.create(mockSetup).build();
                blockWithoutOnChain.onChainTimestamp = undefined as any;
                sinon
                    .stub(validationService as any, "fetchOnChainTimestamp")
                    .resolves(undefined);

                const result = await (
                    validationService as any
                ).isPostedOnChainTooLate(900, blockWithoutOnChain);

                expect(result).to.be.false;
            });

            it("should fetch and set onChain timestamp when not present", async () => {
                const blockWithoutOnChain =
                    BlockBuilder.create(mockSetup).build();
                blockWithoutOnChain.onChainTimestamp = undefined as any;
                (blockWithoutOnChain as any).hash = "0xblockhash";
                sinon
                    .stub(validationService as any, "fetchOnChainTimestamp")
                    .resolves(1500);

                const result = await (
                    validationService as any
                ).isPostedOnChainTooLate(900, blockWithoutOnChain);

                expect(blockWithoutOnChain.onChainTimestamp).to.equal(1500);
                expect(
                    mockSetup.mockStorage.blocks.setOnChainTimestamp.calledWith(
                        "0xblockhash",
                        1500
                    )
                ).to.be.true;
                expect(result).to.be.false;
            });
        });

        describe("getParticipants", () => {
            it("should return participants from storage when available", async () => {
                mockSetup.mockStorage.getParticipants.returns([
                    "0xparticipant1",
                    "0xparticipant2"
                ]);

                const result = await (validationService as any).getParticipants(
                    { forkId: "0xfork123", height: 1 },
                    "0xchannel123"
                );

                expect(result).to.deep.equal(
                    new Set(["0xparticipant1", "0xparticipant2"])
                );
                expect(
                    mockSetup.mockStateChannelManagerContract.getParticipants
                        .called
                ).to.be.false;
                expect(
                    mockSetup.mockStateChannelManagerContract
                        .getPendingParticipants.called
                ).to.be.false;
            });

            it("should fetch participants from chain when storage is empty", async () => {
                mockSetup.mockStorage.getParticipants.returns([]);
                mockSetup.mockStateChannelManagerContract.getParticipants.resolves(
                    ["0xparticipant1", "0xparticipant2"]
                );
                mockSetup.mockStateChannelManagerContract.getPendingParticipants.resolves(
                    ["0xpending1"]
                );

                const result = await (validationService as any).getParticipants(
                    { forkId: "0xfork123", height: 1 },
                    "0xchannel123"
                );

                expect(
                    mockSetup.mockStateChannelManagerContract.getParticipants.calledWith(
                        "0xchannel123"
                    )
                ).to.be.true;
                expect(
                    mockSetup.mockStateChannelManagerContract.getPendingParticipants.calledWith(
                        "0xchannel123"
                    )
                ).to.be.true;
                expect(result).to.deep.equal(
                    new Set(["0xparticipant1", "0xparticipant2", "0xpending1"])
                );
            });

            it("should handle empty chain participants", async () => {
                mockSetup.mockStorage.getParticipants.returns([]);
                mockSetup.mockStateChannelManagerContract.getParticipants.resolves(
                    []
                );
                mockSetup.mockStateChannelManagerContract.getPendingParticipants.resolves(
                    []
                );

                const result = await (validationService as any).getParticipants(
                    { forkId: "0xfork123", height: 1 },
                    "0xchannel123"
                );

                expect(result).to.deep.equal(new Set([]));
            });
        });

        describe("Additional Time Validation Coverage", () => {
            it("should handle on-chain timestamp fetch and update previous block", async () => {
                mockSetup.setupForSuccess();

                const prevBlock = {
                    height: 0,
                    timestamp: 900,
                    onChainTimestamp: undefined,
                    hash: "0xprevhash",
                    getRelevantTimestamp: sinon.stub().returns(900)
                };
                mockSetup.mockStorage.getPreviousBlockOrSnapshot.returns({
                    block: prevBlock
                });
                mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 0)
                    .returns(prevBlock);

                sinon
                    .stub(validationService as any, "fetchOnChainTimestamp")
                    .resolves(1200);

                const blockWithInvalidTime = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID)
                    .build();
                (blockWithInvalidTime as any).timestamp = 2500; // Invalid against original previousTimestamp (900)

                const result =
                    await validationService.validateBlockConfirmation(
                        blockWithInvalidTime,
                        mockSetup.mockStrategy
                    );

                // The validation should still result in DISPUTE
                expect(result).to.equal(BlockValidationResult.DISPUTE);
                // The fetchOnChainTimestamp should have been called
                expect((validationService as any).fetchOnChainTimestamp.called)
                    .to.be.true;
            });

            it("should handle on-chain timestamp fetch returning null", async () => {
                mockSetup.setupForSuccess();

                const prevBlock = {
                    height: 0,
                    timestamp: 900,
                    onChainTimestamp: undefined,
                    hash: "0xprevhash",
                    getRelevantTimestamp: sinon.stub().returns(900)
                };
                mockSetup.mockStorage.getPreviousBlockOrSnapshot.returns({
                    block: prevBlock
                });
                mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 0)
                    .returns(prevBlock);

                sinon
                    .stub(validationService as any, "fetchOnChainTimestamp")
                    .resolves(undefined);

                const blockWithInvalidTime = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID)
                    .build();
                (blockWithInvalidTime as any).timestamp = 2500;

                const result =
                    await validationService.validateBlockConfirmation(
                        blockWithInvalidTime,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(BlockValidationResult.DISPUTE);
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should handle on-chain timestamp fetch returning timestamp <= previousTimestamp", async () => {
                mockSetup.setupForSuccess();

                const prevBlock = {
                    height: 0,
                    timestamp: 900,
                    onChainTimestamp: undefined,
                    hash: "0xprevhash",
                    getRelevantTimestamp: sinon.stub().returns(900)
                };
                mockSetup.mockStorage.getPreviousBlockOrSnapshot.returns({
                    block: prevBlock
                });
                mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 0)
                    .returns(prevBlock);

                sinon
                    .stub(validationService as any, "fetchOnChainTimestamp")
                    .resolves(800); // Less than previousTimestamp

                const blockWithInvalidTime = BlockBuilder.create(mockSetup)
                    .failWith(ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID)
                    .build();
                (blockWithInvalidTime as any).timestamp = 2500;

                const result =
                    await validationService.validateBlockConfirmation(
                        blockWithInvalidTime,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(BlockValidationResult.DISPUTE);
                expect(
                    mockSetup.mockStrategy.objectiveInvalidTimestampDetected
                        .called
                ).to.be.true;
            });

            it("should return SUCCESS when block has onChainTimestamp", async () => {
                mockSetup.setupForSuccess();

                const prevBlock = {
                    height: 0,
                    hash: "0xprevhash",
                    timestamp: 900,
                    getRelevantTimestamp: sinon.stub().returns(900)
                };
                mockSetup.mockStorage.getPreviousBlockOrSnapshot.returns({
                    block: prevBlock
                });
                mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 0)
                    .returns(prevBlock);

                sinon
                    .stub(validationService as any, "isPostedOnChainTooLate")
                    .resolves(false);

                const blockWithOnChainTimestamp =
                    BlockBuilder.create(mockSetup).build();
                blockWithOnChainTimestamp.onChainTimestamp = 1000;

                const result =
                    await validationService.validateBlockConfirmation(
                        blockWithOnChainTimestamp,
                        mockSetup.mockStrategy
                    );

                expect(result).to.equal(BlockValidationResult.SUCCESS);
                expect(
                    mockSetup.mockStrategy.subjectiveInvalidTimestampDetected
                        .called
                ).to.be.false;
            });
        });
    });
});
