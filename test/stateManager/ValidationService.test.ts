import ValidationService from "../../src/stateManager/ValidationService";
import { ExecutionFlags, TimeConfig } from "../../src/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Block } from "../../src/models";
import {
    DoubleSignException,
    InvalidTimestampException
} from "../../src/stateManager/utils/FraudProofService";
import {
    isChannelOpen,
    getPreviousBlockOrSnapshot
} from "../../src/stateManager/utils/channelValidation";
import sinon from "sinon";
import { expect } from "chai";

describe("ValidationService.validateBlockConfirmation", () => {
    let validationService: ValidationService;
    let mockStorage: any;
    let mockFraudProofService: any;
    let mockStateMachine: any;
    let mockStateChannelManagerContract: any;
    let mockTimeConfig: TimeConfig;
    let mockChannelId: string;
    let mockGetForkId: sinon.SinonStub;

    // Simplified test data builders
    const createBlockConfirmation = (
        overrides: any = {}
    ): BlockConfirmationStruct => ({
        signedBlock: {
            encodedBlock: "0x1234",
            signature: "0xsignature",
            ...overrides.signedBlock
        },
        signatures: ["0xsig1", "0xsig2"],
        ...overrides
    });

    const createBlock = (overrides: any = {}): Block =>
        ({
            channelId: mockChannelId,
            author: "0xauthor",
            forkId: "0xfork",
            height: 1,
            timestamp: 1000,
            previousBlockHash: "0xprevhash",
            hash: "0xblockhash",
            coordinates: { forkId: "0xfork", height: 1 },
            getSignerAddress: sinon.stub().returns("0xauthor"),
            getSignerAddresses: sinon.stub().returns(new Set(["0xauthor"])),
            getRelevantTimestamp: sinon.stub().returns(1000),
            ...overrides
        }) as any;

    // Helper to setup conflict detection scenario
    const setupConflictDetection = (
        conflictingBlock: Block,
        isLinked: boolean = true
    ) => {
        // Handle both getBlockEntry overloads correctly
        mockStorage.blocks.getBlockEntry.callsFake(
            (param1: any, param2?: any) => {
                if (param2 === undefined) {
                    return undefined; // Skip duplicate detection
                } else {
                    return {
                        blockConfirmation: {
                            signedBlock: { encodedBlock: "0xconflicting" }
                        }
                    };
                }
            }
        );

        // Reset and properly configure Block.decode stub to handle multiple calls
        (Block.decode as any).restore();
        const blockDecodeStub = sinon.stub(Block, "decode");
        blockDecodeStub.callsFake((encodedBlock: any) => {
            if (encodedBlock === "0x1234") {
                return createBlock(); // main block
            }
            if (encodedBlock === "0xconflicting") {
                return conflictingBlock; // conflicting block
            }
            {
                return createBlock(); // fallback
            }
        });

        // Apply isLinked stub BEFORE validation logic
        const isLinkedStub = sinon.stub(validationService as any, "isLinked");
        isLinkedStub.returns(isLinked);
    };

    beforeEach(() => {
        sinon.restore();

        mockStorage = {
            queues: {
                queueConfirmation: sinon.stub(),
                isBlockQueued: sinon.stub().returns(false)
            },
            blocks: {
                getBlockEntry: sinon.stub(),
                getNextBlockHeight: sinon.stub().returns(1),
                getSignatures: sinon.stub().returns([]),
                storeBlockConfirmation: sinon.stub(),
                setOnChainTimestamp: sinon.stub()
            },
            stateSnapshots: {
                getGenesisSnapshotDataByForkId: sinon
                    .stub()
                    .returns({ hash: "0xgenesis" })
            },
            disputes: {
                getDisputedFork: sinon.stub().returns(false)
            },
            getParticipants: sinon.stub().returns(["0xauthor"])
        };

        mockFraudProofService = {
            createFraudProof: sinon.stub().returns("fraud-proof")
        };

        mockStateMachine = {
            getNextToWrite: sinon.stub().resolves("0xauthor")
        };

        mockStateChannelManagerContract = {
            isForkDisputed: sinon.stub().resolves(false),
            getParticipants: sinon.stub().resolves(["0xauthor"]),
            getPendingParticipants: sinon.stub().resolves([]),
            getBlockCallDataCommitment: sinon.stub().resolves({ found: false }),
            queryFilter: sinon.stub().resolves([]),
            filters: { BlockCalldataPosted: sinon.stub().returns("filter") }
        };

        mockTimeConfig = {
            p2pTime: 1000,
            agreementTime: 2000,
            chainFallbackTime: 3000,
            challengeTime: 4000
        };

        mockChannelId = "0xchannel";
        mockGetForkId = sinon.stub().returns("0xfork");

        // Mock utility functions
        (isChannelOpen as any) = sinon.stub().returns(true);
        (getPreviousBlockOrSnapshot as any) = sinon.stub().returns({
            blockConfirmation: {
                signedBlock: { encodedBlock: "0xprev" },
                signatures: ["0xprevsig"]
            }
        });

        sinon.stub(Block, "decode").callsFake(() => createBlock());

        validationService = new ValidationService(
            mockStorage,
            mockFraudProofService,
            mockStateMachine,
            mockStateChannelManagerContract,
            mockTimeConfig,
            mockChannelId,
            mockGetForkId
        );
    });

    afterEach(() => {
        sinon.restore();
    });

    describe("Channel Status Validation", () => {
        it("should return NOT_READY when channel is not open", async () => {
            (isChannelOpen as any).returns(false);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.NOT_READY);
            expect(mockStorage.queues.queueConfirmation.called).to.be.true;
        });
    });

    describe("Block Authentication", () => {
        it("should return DISCONNECT when block authentication fails", async () => {
            sinon
                .stub(validationService as any, "authenticateBlock")
                .returns(null);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISCONNECT);
        });

        it("should return DISCONNECT when block has wrong channel or signature", async () => {
            (Block.decode as any).returns(
                createBlock({ channelId: "wrong-channel" })
            );

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISCONNECT);
        });
    });

    describe("Duplicate Block Detection", () => {
        it("should return DISCONNECT when duplicate block has invalid signers", async () => {
            mockStorage.queues.isBlockQueued.returns(true);
            const mockBlock = createBlock();
            // signer that is not a participant
            (mockBlock.getSignerAddresses as sinon.SinonStub).returns(
                new Set(["0xinvalidsigner"])
            );
            (Block.decode as any).returns(mockBlock);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISCONNECT);
        });

        it("should return DUPLICATE when block exists with no new signatures", async () => {
            mockStorage.blocks.getBlockEntry.returns({ blockConfirmation: {} });
            mockStorage.blocks.getSignatures.returns(["0xsig1", "0xsig2"]);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation({ signatures: ["0xsig1", "0xsig2"] })
            );

            expect(result).to.equal(ExecutionFlags.DUPLICATE);
        });

        it("should return BROADCAST when block has new valid signatures", async () => {
            mockStorage.blocks.getBlockEntry.returns({ blockConfirmation: {} });
            mockStorage.blocks.getSignatures.returns(["0xsig1"]);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation({ signatures: ["0xsig1", "0xsig2"] })
            );

            expect(result).to.equal(ExecutionFlags.BROADCAST);
        });
    });

    describe("Participant Validation", () => {
        it("should return DISCONNECT when author is not a participant", async () => {
            mockStorage.getParticipants.returns(["0xotherparticipant"]);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISCONNECT);
        });
    });

    describe("Conflict Detection", () => {
        it("should return DISPUTE for same author conflict (double sign)", async () => {
            const conflictingBlock = createBlock(); // Same author
            setupConflictDetection(conflictingBlock);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISPUTE);
            expect(mockFraudProofService.createFraudProof.called).to.be.true;
        });

        it("should return DISPUTE for different author conflict when linked", async () => {
            const conflictingBlock = createBlock({
                author: "0xdifferentauthor"
            });
            setupConflictDetection(conflictingBlock, true);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISPUTE);
        });

        it("should return DISCONNECT for different author conflict when not linked", async () => {
            const conflictingBlock = createBlock({
                author: "0xdifferentauthor"
            });
            setupConflictDetection(conflictingBlock, false);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISCONNECT);
        });
    });

    describe("Fork and Height Validation", () => {
        it("should return NOT_READY when fork is disputed", async () => {
            mockStateChannelManagerContract.isForkDisputed.resolves(true);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.NOT_READY);
        });

        it("should return NOT_READY when block height is in future", async () => {
            mockStorage.blocks.getNextBlockHeight.returns(0);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.NOT_READY);
        });
    });

    describe("Link Validation", () => {
        it("should return DISCONNECT when block is not linked", async () => {
            sinon.stub(validationService as any, "isLinked").returns(false);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISCONNECT);
        });

        it("should validate genesis block linking correctly", async () => {
            const genesisBlock = createBlock({
                height: 0,
                previousBlockHash: "0xgenesis"
            });
            (Block.decode as any).returns(genesisBlock);
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon
                .stub(validationService as any, "validateTimeLogic")
                .resolves(null);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.SUCCESS);
        });
    });

    describe("Leader Validation", () => {
        it("should return DISPUTE when author is not next leader", async () => {
            mockStateMachine.getNextToWrite.resolves("0xdifferentleader");
            sinon.stub(validationService as any, "isLinked").returns(true);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISPUTE);
        });
    });

    describe("Time Logic Validation", () => {
        it("should return NOT_ENOUGH_TIME when insufficient time has passed", async () => {
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon
                .stub(validationService as any, "validateTimeLogic")
                .resolves(ExecutionFlags.NOT_ENOUGH_TIME);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.NOT_ENOUGH_TIME);
        });

        it("should return DISPUTE for invalid timestamps", async () => {
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon
                .stub(validationService as any, "validateTimeLogic")
                .rejects(new InvalidTimestampException({}, {} as any));

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISPUTE);
        });
    });

    describe("Success Case", () => {
        it("should return SUCCESS when all validations pass", async () => {
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon
                .stub(validationService as any, "validateTimeLogic")
                .resolves(null);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.SUCCESS);
        });
    });

    describe("Exception Handling", () => {
        it("should catch ValidationFraudException and return DISPUTE", async () => {
            const fraudException = new DoubleSignException(
                {} as any,
                {} as any
            );
            sinon
                .stub(validationService as any, "authenticateBlock")
                .throws(fraudException);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.equal(ExecutionFlags.DISPUTE);
            expect(
                mockFraudProofService.createFraudProof.calledWith(
                    fraudException
                )
            ).to.be.true;
        });

        it("should re-throw non-fraud exceptions", async () => {
            const regularError = new Error("Regular error");
            sinon
                .stub(validationService as any, "authenticateBlock")
                .throws(regularError);

            await expect(
                validationService.validateBlockConfirmation(
                    createBlockConfirmation()
                )
            ).to.be.rejectedWith("Regular error");
        });
    });
});
