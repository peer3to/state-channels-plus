import ValidationService from "../../src/stateManager/ValidationService";
import { BlockValidationAction, TimeConfig } from "../../src/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Block } from "../../src/models";
import { Codec } from "../../src/utils";
import sinon from "sinon";
import { expect } from "chai";
import { ethers } from "ethers";

describe("ValidationService.validateBlockConfirmation", () => {
    let validationService: ValidationService;
    let mockStorage: any;
    let mockStateMachine: any;
    let mockStateChannelManagerContract: any;
    let mockTimeConfig: TimeConfig;
    let mockChannelId: string;
    let mockGetForkId: sinon.SinonStub;

    // Helper functions for creating meaningful hex values
    const createHexFromString = (str: string) =>
        ethers.hexlify(ethers.toUtf8Bytes(str));

    const createTestSignature = (identifier: string = "default") => {
        // Create a deterministic but valid 65-byte signature based on identifier
        const base = ethers.keccak256(ethers.toUtf8Bytes(identifier));
        // Pad to 65 bytes (130 hex chars + 0x = 132 total)
        return base + base.slice(2, 4); // Take first 2 chars without 0x to make it 65 bytes
    };

    const TestHex = {
        MAIN_BLOCK: createHexFromString("main_block"), // "0x6d61696e5f626c6f636b"
        CONFLICTING_BLOCK: createHexFromString("conflicting"), // "0x636f6e666c696374696e67"
        PREVIOUS_HASH: createHexFromString("prev_hash"), // "0x707265765f68617368"
        BLOCK_HASH: createHexFromString("block_hash"), // "0x626c6f636b5f68617368"

        SIGNATURE_AUTHOR: createTestSignature("author"),
        SIGNATURE_PEER1: createTestSignature("peer1"),
        SIGNATURE_PEER2: createTestSignature("peer2")
    };

    // Simplified test data builders
    const createBlockConfirmation = (
        overrides: any = {}
    ): BlockConfirmationStruct => ({
        signedBlock: {
            encodedBlock: TestHex.MAIN_BLOCK,
            signature: TestHex.SIGNATURE_AUTHOR,
            ...overrides.signedBlock
        },
        signatures: [TestHex.SIGNATURE_PEER1, TestHex.SIGNATURE_PEER2],
        ...overrides
    });

    const createBlock = (overrides: any = {}): Block => {
        const mockBlock = {
            channelId: mockChannelId,
            author: "0xauthor",
            forkId: "0xfork",
            height: 1,
            timestamp: 1000,
            previousBlockHash: TestHex.PREVIOUS_HASH,
            hash: TestHex.BLOCK_HASH,
            coordinates: { forkId: "0xfork", height: 1 },
            signerAddress: "0xauthor",
            allSignerAddresses: new Set(["0xauthor", "0xpeer1"]),
            confirmationSignerAddresses: new Set(["0xpeer1"]),
            signatureToAddress: undefined,
            getRelevantTimestamp: sinon.stub().returns(1000),
            encode: sinon
                .stub()
                .returns(overrides.encodedBlock || TestHex.MAIN_BLOCK),
            get signedBlock() {
                return {
                    encodedBlock: this.encode(),
                    signature: overrides.signature || TestHex.SIGNATURE_AUTHOR
                };
            },
            ...overrides
        } as any;

        return mockBlock;
    };

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
                        block: conflictingBlock
                    };
                }
            }
        );

        // Reset and properly configure Block.fromBlockConfirmation stub to handle multiple calls
        (Block.fromBlockConfirmation as any).restore();
        const blockDecodeStub = sinon.stub(Block, "fromBlockConfirmation");
        blockDecodeStub.callsFake((blockConfirmation: any) => {
            if (
                blockConfirmation.signedBlock.encodedBlock ===
                TestHex.MAIN_BLOCK
            ) {
                return createBlock(); // main block
            }
            if (
                blockConfirmation.signedBlock.encodedBlock ===
                TestHex.CONFLICTING_BLOCK
            ) {
                return conflictingBlock; // conflicting block
            }
            return createBlock(); // fallback
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
                queueBlock: sinon.stub(),
                isBlockQueued: sinon.stub().returns(false)
            },
            blocks: {
                getBlockEntry: sinon.stub(),
                getNextBlockHeight: sinon.stub().returns(1),
                storeBlock: sinon.stub(),
                setOnChainTimestamp: sinon.stub()
            },
            disputes: {
                didIDispute: sinon.stub().returns(false)
            },
            getParticipants: sinon.stub().returns(["0xauthor"]),
            getPreviousBlockOrSnapshot: sinon.stub().returns({
                block: createBlock({ hash: TestHex.PREVIOUS_HASH })
            }),
            stateSnapshots: {
                getStateSnapshotByHash: sinon.stub().returns(null)
            },
            stateMachineStates: {
                getStateMachineState: sinon
                    .stub()
                    .returns("0xstateMachineState")
            },
            fraudProofs: {
                storeFraudProof: sinon.stub().returns("0xfraudproof")
            }
        };

        mockStateMachine = {
            getNextToWrite: sinon.stub().resolves("0xauthor"),
            isForkDisputed: sinon.stub().resolves(false)
        };

        mockStateChannelManagerContract = {
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

        sinon
            .stub(Block, "fromBlockConfirmation")
            .callsFake(() => createBlock());

        validationService = new ValidationService(
            mockStorage,
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
        it("should return shouldDisconnect false when channel is not open", async () => {
            sinon
                .stub(validationService as any, "isChannelOpen")
                .returns(false);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({ shouldDisconnect: false });
            expect(mockStorage.queues.queueConfirmation.called).to.be.true;
        });
    });

    describe("Block Authentication", () => {
        it("should return shouldDisconnect true when block authentication fails", async () => {
            sinon
                .stub(validationService as any, "authenticateBlock")
                .returns(null);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({ shouldDisconnect: true });
        });

        it("should return shouldDisconnect true when block has wrong channel or signature", async () => {
            (Block.fromBlockConfirmation as any).returns(
                createBlock({ channelId: "wrong-channel" })
            );

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({ shouldDisconnect: true });
        });
    });

    describe("Duplicate Block Detection", () => {
        it("should return shouldDisconnect true when duplicate block has invalid signers", async () => {
            mockStorage.queues.isBlockQueued.returns(true);
            const mockBlock = createBlock({
                confirmationSignerAddresses: new Set(["0xinvalidsigner"])
            });
            // Mock allSignerAddresses getter to return invalid signers
            (Block.fromBlockConfirmation as any).returns(mockBlock);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({ shouldDisconnect: true });
        });

        it("should return shouldDisconnect false when block exists with no new signatures", async () => {
            const block = createBlock({
                confirmationSignatures: new Set([
                    TestHex.SIGNATURE_PEER1,
                    TestHex.SIGNATURE_PEER2
                ])
            });
            mockStorage.blocks.getBlockEntry.returns({
                block: block
            });
            (Block.fromBlockConfirmation as any).returns(block);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({ shouldDisconnect: false });
        });

        it("should return BROADCAST action when block has new valid signatures", async () => {
            mockStorage.blocks.getBlockEntry.returns({
                block: createBlock({
                    confirmationSignatures: new Set([TestHex.SIGNATURE_PEER1])
                })
            });
            mockStorage.getParticipants.returns(["0xpeer1", "0xauthor"]);
            const mockBlock = createBlock({
                confirmationSignatures: new Set([
                    TestHex.SIGNATURE_PEER1,
                    TestHex.SIGNATURE_PEER2
                ]),
                signatureToAddress: sinon.stub().returns("0xpeer1")
            });
            (Block.fromBlockConfirmation as any).returns(mockBlock);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.action).to.equal(BlockValidationAction.BROADCAST);
        });
    });

    describe("Participant Validation", () => {
        it("should return shouldDisconnect true when author is not a participant", async () => {
            mockStorage.getParticipants.returns(["0xotherparticipant"]);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.shouldDisconnect).to.be.true;
        });
    });

    describe("Conflict Detection", () => {
        it("should return DISPUTE for same author conflict (double sign)", async () => {
            const conflictingBlock = createBlock({
                encodedBlock: TestHex.CONFLICTING_BLOCK
            });
            setupConflictDetection(conflictingBlock);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({
                shouldDisconnect: true,
                action: BlockValidationAction.DISPUTE
            });
        });

        it("should return DISPUTE for different author conflict when linked", async () => {
            const conflictingBlock = createBlock({
                author: "0xdifferentauthor",
                encodedBlock: TestHex.CONFLICTING_BLOCK
            });
            setupConflictDetection(conflictingBlock, true);

            // Mock StateSnapshot with toStruct method
            const mockStateSnapshot = {
                stateMachineStateHash: "0xstatehash",
                toStruct: sinon.stub().returns({})
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash.returns(
                mockStateSnapshot
            );

            sinon.stub(Codec, "encode").returns("0xencodedproof");

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result).to.eql({
                shouldDisconnect: true,
                action: BlockValidationAction.DISPUTE
            });
        });

        it("should return shouldDisconnect true for different author conflict when not linked", async () => {
            const conflictingBlock = createBlock({
                author: "0xdifferentauthor",
                encodedBlock: TestHex.CONFLICTING_BLOCK
            });
            setupConflictDetection(conflictingBlock, false);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.shouldDisconnect).to.be.true;
        });
    });

    describe("Fork and Height Validation", () => {
        it("should return shouldDisconnect false when fork is disputed", async () => {
            mockStateMachine.isForkDisputed.resolves(true);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.shouldDisconnect).to.be.false;
        });

        it("should return shouldDisconnect false when block height is in future", async () => {
            mockStorage.blocks.getNextBlockHeight.returns(0);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.shouldDisconnect).to.be.false;
        });
    });

    describe("Link Validation", () => {
        it("should return shouldDisconnect true when block is not linked", async () => {
            sinon.stub(validationService as any, "isLinked").returns(false);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.shouldDisconnect).to.be.true;
        });

        it("should validate genesis block linking correctly", async () => {
            const genesisBlock = createBlock({
                height: 0,
                previousBlockHash: "0xgenesis"
            });
            (Block.fromBlockConfirmation as any).returns(genesisBlock);
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon
                .stub(validationService as any, "validateTimeLogic")
                .resolves(undefined);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.action).to.equal(BlockValidationAction.SUCCESS);
        });
    });

    describe("Leader Validation", () => {
        it("should return DISPUTE when author is not next leader", async () => {
            mockStateMachine.getNextToWrite.resolves("0xdifferentleader");
            sinon.stub(validationService as any, "isLinked").returns(true);
            const mockStateSnapshot = {
                stateMachineStateHash: "0xstatehash",
                toStruct: sinon.stub().returns({})
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash.returns(
                mockStateSnapshot
            );

            sinon.stub(Codec, "encode").returns("0xencodedproof");

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.shouldDisconnect).to.be.true;
            expect(result.action).to.equal(BlockValidationAction.DISPUTE);
        });
    });

    describe("Time Logic Validation", () => {
        it("should return NOT_ENOUGH_TIME when insufficient time has passed", async () => {
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon.stub(validationService as any, "validateTimeLogic").resolves({
                action: BlockValidationAction.NOT_ENOUGH_TIME,
                shouldDisconnect: false
            });

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.action).to.equal(
                BlockValidationAction.NOT_ENOUGH_TIME
            );
        });

        it("should return DISPUTE for invalid timestamps", async () => {
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon.stub(validationService as any, "validateTimeLogic").resolves({
                action: BlockValidationAction.DISPUTE,
                shouldDisconnect: true
            });

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.action).to.equal(BlockValidationAction.DISPUTE);
        });
    });

    describe("Success Case", () => {
        it("should return SUCCESS when all validations pass", async () => {
            sinon.stub(validationService as any, "isLinked").returns(true);
            sinon
                .stub(validationService as any, "validateTimeLogic")
                .resolves(undefined);

            const result = await validationService.validateBlockConfirmation(
                createBlockConfirmation()
            );

            expect(result.action).to.equal(BlockValidationAction.SUCCESS);
        });
    });
});
