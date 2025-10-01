// import ValidationService from "../../src/stateManager/ValidationService";
// import { BlockValidationResult, TimeConfig } from "../../src/types";
// import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
// import { Block } from "../../src/models";
// import { Codec } from "../../src/utils";
// import sinon from "sinon";
// import { expect } from "chai";
// import { ethers } from "ethers";

// describe("ValidationService.validateBlockConfirmation", () => {
//     let validationService: ValidationService;
//     let mockStorage: any;
//     let mockStateMachine: any;
//     let mockStateChannelManagerContract: any;
//     let mockTimeConfig: TimeConfig;
//     let mockChannelId: string;
//     let mockGetForkId: sinon.SinonStub;
//     let mockLocalDiamond: any;

//     // Helper functions for creating meaningful hex values
//     const createHexFromString = (str: string) =>
//         ethers.hexlify(ethers.toUtf8Bytes(str));

//     const createTestSignature = (identifier: string = "default") => {
//         // Create a deterministic but valid 65-byte signature based on identifier
//         const base = ethers.keccak256(ethers.toUtf8Bytes(identifier));
//         // Pad to 65 bytes (130 hex chars + 0x = 132 total)
//         return base + base.slice(2, 4); // Take first 2 chars without 0x to make it 65 bytes
//     };

//     const TestHex = {
//         MAIN_BLOCK: createHexFromString("main_block"), // "0x6d61696e5f626c6f636b"
//         CONFLICTING_BLOCK: createHexFromString("conflicting"), // "0x636f6e666c696374696e67"
//         PREVIOUS_HASH: createHexFromString("prev_hash"), // "0x707265765f68617368"
//         BLOCK_HASH: createHexFromString("block_hash"), // "0x626c6f636b5f68617368"

//         SIGNATURE_AUTHOR: createTestSignature("author"),
//         SIGNATURE_PEER1: createTestSignature("peer1"),
//         SIGNATURE_PEER2: createTestSignature("peer2")
//     };

//     // Simplified test data builders
//     const createBlockConfirmation = (
//         overrides: any = {}
//     ): BlockConfirmationStruct => ({
//         signedBlock: {
//             encodedBlock: TestHex.MAIN_BLOCK,
//             signature: TestHex.SIGNATURE_AUTHOR,
//             ...overrides.signedBlock
//         },
//         signatures: [TestHex.SIGNATURE_PEER1, TestHex.SIGNATURE_PEER2],
//         ...overrides
//     });

//     const createBlock = (overrides: any = {}): Block => {
//         const mockBlock = {
//             channelId: mockChannelId,
//             author: "0xauthor",
//             forkId: "0xfork",
//             height: 1,
//             timestamp: 1000,
//             previousBlockHash: TestHex.PREVIOUS_HASH,
//             hash: TestHex.BLOCK_HASH,
//             coordinates: { forkId: "0xfork", height: 1 },
//             signerAddress: "0xauthor",
//             allSignerAddresses: new Set(["0xauthor", "0xpeer1"]),
//             confirmationSignerAddresses: new Set(["0xpeer1"]),
//             signatureToAddress: undefined,
//             getRelevantTimestamp: sinon.stub().returns(1000),
//             encode: sinon
//                 .stub()
//                 .returns(overrides.encodedBlock || TestHex.MAIN_BLOCK),
//             get signedBlock() {
//                 return {
//                     encodedBlock: this.encode(),
//                     signature: overrides.signature || TestHex.SIGNATURE_AUTHOR
//                 };
//             },
//             ...overrides
//         } as any;

//         return mockBlock;
//     };

//     // Helper to setup conflict detection scenario
//     const setupConflictDetection = (
//         conflictingBlock: Block,
//         isLinked: boolean = true
//     ) => {
//         // Handle both getBlockEntry overloads correctly
//         mockStorage.blocks.getBlockEntry.callsFake(
//             (param1: any, param2?: any) => {
//                 if (param2 === undefined) {
//                     return undefined; // Skip duplicate detection
//                 } else {
//                     return {
//                         block: conflictingBlock
//                     };
//                 }
//             }
//         );

//         // Reset and properly configure Block.fromBlockConfirmation stub to handle multiple calls
//         (Block.fromBlockConfirmation as any).restore();
//         const blockDecodeStub = sinon.stub(Block, "fromBlockConfirmation");
//         blockDecodeStub.callsFake((blockConfirmation: any) => {
//             if (
//                 blockConfirmation.signedBlock.encodedBlock ===
//                 TestHex.MAIN_BLOCK
//             ) {
//                 return createBlock(); // main block
//             }
//             if (
//                 blockConfirmation.signedBlock.encodedBlock ===
//                 TestHex.CONFLICTING_BLOCK
//             ) {
//                 return conflictingBlock; // conflicting block
//             }
//             return createBlock(); // fallback
//         });

//         // Apply isLinked stub BEFORE validation logic
//         const isLinkedStub = sinon.stub(validationService as any, "isLinked");
//         isLinkedStub.returns(isLinked);
//     };

//     beforeEach(() => {
//         sinon.restore();

//         mockStorage = {
//             queues: {
//                 queueBlock: sinon.stub(),
//                 isBlockQueued: sinon.stub().returns(false)
//             },
//             blocks: {
//                 getBlockEntry: sinon.stub(),
//                 getNextBlockHeight: sinon.stub().returns(1),
//                 storeBlock: sinon.stub(),
//                 setOnChainTimestamp: sinon.stub()
//             },
//             disputes: {
//                 didIDispute: sinon.stub().returns(false)
//             },
//             getParticipants: sinon.stub().returns(["0xauthor"]),
//             getPreviousBlockOrSnapshot: sinon.stub().returns({
//                 block: createBlock({ hash: TestHex.PREVIOUS_HASH })
//             }),
//             stateSnapshots: {
//                 getStateSnapshotByHash: sinon.stub().returns(null)
//             },
//             stateMachineStates: {
//                 getStateMachineState: sinon
//                     .stub()
//                     .returns("0xstateMachineState")
//             },
//             fraudProofs: {
//                 storeFraudProof: sinon.stub().returns("0xfraudproof")
//             }
//         };

//         mockStateMachine = {
//             getNextToWrite: sinon.stub().resolves("0xauthor")
//         };

//         mockStateChannelManagerContract = {
//             getParticipants: sinon.stub().resolves(["0xauthor"]),
//             getPendingParticipants: sinon.stub().resolves([]),
//             getBlockCallDataCommitment: sinon.stub().resolves({ found: false }),
//             queryFilter: sinon.stub().resolves([]),
//             filters: { BlockCalldataPosted: sinon.stub().returns("filter") }
//         };

//         mockTimeConfig = {
//             p2pTime: 1000,
//             agreementTime: 2000,
//             chainFallbackTime: 3000,
//             evidenceTime: 4000
//         };

//         mockChannelId = "0xchannel";
//         mockGetForkId = sinon.stub().returns("0xfork");
//         mockLocalDiamond = {
//             isForkDisputed: sinon.stub().resolves(false)
//         };

//         sinon
//             .stub(Block, "fromBlockConfirmation")
//             .callsFake(() => createBlock());

//         validationService = new ValidationService(
//             mockStorage,
//             mockStateMachine,
//             mockStateChannelManagerContract,
//             mockTimeConfig
//         );
//     });

//     afterEach(() => {
//         sinon.restore();
//     });

//     describe("Channel Status Validation", () => {
//         it("should return shouldDisconnect false when channel is not open", async () => {
//             sinon
//                 .stub(validationService as any, "isChannelOpen")
//                 .returns(false);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({ shouldDisconnect: false });
//             expect(mockStorage.queues.queueBlock.called).to.be.true;
//         });
//     });

//     describe("Block Authentication", () => {
//         it("should return shouldDisconnect true when block authentication fails", async () => {
//             sinon
//                 .stub(validationService as any, "authenticateBlock")
//                 .returns(null);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({ shouldDisconnect: true });
//         });

//         it("should return shouldDisconnect true when block has wrong channel or signature", async () => {
//             (Block.fromBlockConfirmation as any).returns(
//                 createBlock({ channelId: "wrong-channel" })
//             );

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({ shouldDisconnect: true });
//         });
//     });

//     describe("Duplicate Block Detection", () => {
//         it("should return shouldDisconnect true when duplicate block has invalid signers", async () => {
//             mockStorage.queues.isBlockQueued.returns(true);
//             const mockBlock = createBlock({
//                 confirmationSignerAddresses: new Set(["0xinvalidsigner"])
//             });
//             // Mock allSignerAddresses getter to return invalid signers
//             (Block.fromBlockConfirmation as any).returns(mockBlock);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({ shouldDisconnect: true });
//         });

//         it("should return shouldDisconnect false when block exists with no new signatures", async () => {
//             const block = createBlock({
//                 confirmationSignatures: new Set([
//                     TestHex.SIGNATURE_PEER1,
//                     TestHex.SIGNATURE_PEER2
//                 ])
//             });
//             mockStorage.blocks.getBlockEntry.returns({
//                 block: block
//             });
//             (Block.fromBlockConfirmation as any).returns(block);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({ shouldDisconnect: false });
//         });

//         it("should return BROADCAST action when block has new valid signatures", async () => {
//             mockStorage.blocks.getBlockEntry.returns({
//                 block: createBlock({
//                     confirmationSignatures: new Set([TestHex.SIGNATURE_PEER1])
//                 })
//             });
//             mockStorage.getParticipants.returns(["0xpeer1", "0xauthor"]);
//             const mockBlock = createBlock({
//                 confirmationSignatures: new Set([
//                     TestHex.SIGNATURE_PEER1,
//                     TestHex.SIGNATURE_PEER2
//                 ]),
//                 signatureToAddress: sinon.stub().returns("0xpeer1")
//             });
//             (Block.fromBlockConfirmation as any).returns(mockBlock);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.BROADCAST);
//         });
//     });

//     describe("Participant Validation", () => {
//         it("should return shouldDisconnect true when author is not a participant", async () => {
//             mockStorage.getParticipants.returns(["0xotherparticipant"]);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.shouldDisconnect).to.be.true;
//         });
//     });

//     describe("Conflict Detection", () => {
//         it("should return DISPUTE for same author conflict (double sign)", async () => {
//             const conflictingBlock = createBlock({
//                 encodedBlock: TestHex.CONFLICTING_BLOCK
//             });
//             setupConflictDetection(conflictingBlock);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({
//                 shouldDisconnect: true,
//                 action: BlockValidationResult.DISPUTE
//             });
//         });

//         it("should return DISPUTE for different author conflict when linked", async () => {
//             const conflictingBlock = createBlock({
//                 author: "0xdifferentauthor",
//                 encodedBlock: TestHex.CONFLICTING_BLOCK
//             });
//             setupConflictDetection(conflictingBlock, true);

//             // Mock StateSnapshot with toStruct method
//             const mockStateSnapshot = {
//                 stateMachineStateHash: "0xstatehash",
//                 toStruct: sinon.stub().returns({})
//             };
//             mockStorage.stateSnapshots.getStateSnapshotByHash.returns(
//                 mockStateSnapshot
//             );

//             sinon.stub(Codec, "encode").returns("0xencodedproof");

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result).to.eql({
//                 shouldDisconnect: true,
//                 action: BlockValidationResult.DISPUTE
//             });
//         });

//         it("should return shouldDisconnect true for different author conflict when not linked", async () => {
//             const conflictingBlock = createBlock({
//                 author: "0xdifferentauthor",
//                 encodedBlock: TestHex.CONFLICTING_BLOCK
//             });
//             setupConflictDetection(conflictingBlock, false);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.shouldDisconnect).to.be.true;
//         });
//     });

//     describe("Fork and Height Validation", () => {
//         it("should return shouldDisconnect false when fork is disputed", async () => {
//             mockLocalDiamond.isForkDisputed.resolves(true);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.shouldDisconnect).to.be.false;
//         });

//         it("should return shouldDisconnect false when block height is in future", async () => {
//             mockStorage.blocks.getNextBlockHeight.returns(0);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.shouldDisconnect).to.be.false;
//         });
//     });

//     describe("Link Validation", () => {
//         it("should return shouldDisconnect true when block is not linked", async () => {
//             sinon.stub(validationService as any, "isLinked").returns(false);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.shouldDisconnect).to.be.true;
//         });

//         it("should validate genesis block linking correctly", async () => {
//             const genesisBlock = createBlock({
//                 height: 0,
//                 previousBlockHash: "0xgenesis"
//             });
//             (Block.fromBlockConfirmation as any).returns(genesisBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);
//             sinon
//                 .stub(validationService as any, "validateTimeLogic")
//                 .resolves(undefined);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.SUCCESS);
//         });
//     });

//     describe("Leader Validation", () => {
//         it("should return DISPUTE when author is not next leader", async () => {
//             mockStateMachine.getNextToWrite.resolves("0xdifferentleader");
//             sinon.stub(validationService as any, "isLinked").returns(true);
//             const mockStateSnapshot = {
//                 stateMachineStateHash: "0xstatehash",
//                 toStruct: sinon.stub().returns({})
//             };
//             mockStorage.stateSnapshots.getStateSnapshotByHash.returns(
//                 mockStateSnapshot
//             );

//             sinon.stub(Codec, "encode").returns("0xencodedproof");

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.shouldDisconnect).to.be.true;
//             expect(result.action).to.equal(BlockValidationResult.DISPUTE);
//         });
//     });

//     describe("Time Logic Validation", () => {
//         let clockStub: sinon.SinonStub;
//         const TIMING = {
//             BASE_TIMESTAMP: 1000,
//             GENESIS_TIMESTAMP: 1000,
//             CLOCK_TIME: 1100,
//             LATE_CLOCK_TIME: 8000,
//             ON_CHAIN_TIMESTAMP: 1200,
//             VERY_LATE_ON_CHAIN: 8000
//         };

//         beforeEach(() => {
//             // Mock Clock.getTimeInSeconds for subjective validation
//             clockStub = sinon
//                 .stub(require("../../src/Clock").default, "getTimeInSeconds")
//                 .returns(5000);
//         });

//         afterEach(() => {
//             clockStub.restore();
//         });

//         // Test Case 1: Author signed previous, valid timing, no on-chain timestamps
//         it("Case 1: Author signed previous, valid P2P timing, passes subjective check", async () => {
//             const previousBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP,
//                 onChainTimestamp: undefined,
//                 getRelevantTimestamp: sinon
//                     .stub()
//                     .returns(TIMING.BASE_TIMESTAMP) // Author signed
//             });

//             const currentBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP + 50, // Within p2pTime (1050)
//                 onChainTimestamp: undefined,
//                 author: "0xauthor"
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             // Mock Clock to be within agreementTime
//             clockStub.returns(1100); // abs(1100 - 1050) = 50 <= 2000 (agreementTime)

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.SUCCESS);
//         });

//         // Test Case 2: Author didn't sign, previous has onChain, extends window
//         it("Case 2: Author didn't sign previous, onChain extends window, valid", async () => {
//             const previousBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP,
//                 onChainTimestamp: TIMING.ON_CHAIN_TIMESTAMP, // Later on-chain timestamp
//                 getRelevantTimestamp: sinon
//                     .stub()
//                     .returns(TIMING.ON_CHAIN_TIMESTAMP) // Author didn't sign, uses onChain
//             });

//             const currentBlock = createBlock({
//                 timestamp: TIMING.ON_CHAIN_TIMESTAMP + 50, // Would fail with original (1000) but passes with onChain (1200)
//                 onChainTimestamp: undefined
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             clockStub.returns(1300); // Within agreementTime

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.SUCCESS);
//         });

//         // Test Case 3: Valid P2P timing but posted too late on-chain
//         it("Case 3: Valid P2P timing but posted too late on-chain → DISPUTE", async () => {
//             const previousBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP,
//                 onChainTimestamp: undefined,
//                 getRelevantTimestamp: sinon
//                     .stub()
//                     .returns(TIMING.BASE_TIMESTAMP)
//             });

//             const currentBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP + 50, // Valid P2P timing
//                 onChainTimestamp: TIMING.VERY_LATE_ON_CHAIN // Way too late: 8000 > 1000 + 1000 + 2000 + 3000 = 7000
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             // Expect fraud proof creation
//             const fraudProofStub = sinon.stub(
//                 validationService["fraudProofService"],
//                 "createInvalidTimestampProof"
//             );

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.DISPUTE);
//             expect(result.shouldDisconnect).to.be.true;
//             expect(fraudProofStub.called).to.be.true;
//         });

//         // Test Case 4: Invalid timing, first block (genesis)
//         it("Case 4: Invalid timing on genesis block → DISPUTE", async () => {
//             const genesisSnapshot = {
//                 timestamp: TIMING.BASE_TIMESTAMP
//             };

//             const currentBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP + 1500, // Way beyond p2pTime from genesis
//                 height: 0
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 stateSnapshot: genesisSnapshot
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             const fraudProofStub = sinon.stub(
//                 validationService["fraudProofService"],
//                 "createInvalidTimestampProof"
//             );

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.DISPUTE);
//             expect(fraudProofStub.called).to.be.true;
//         });

//         // Test Case 5: Invalid timing, previous has onChain, no retry needed
//         it("Case 5: Invalid timing, previous already has onChain → DISPUTE", async () => {
//             const previousBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP,
//                 onChainTimestamp: 1100, // Already has onChain
//                 getRelevantTimestamp: sinon.stub().returns(1100)
//             });

//             const currentBlock = createBlock({
//                 timestamp: 2500 // Way beyond p2pTime (1100 + 1000 = 2100)
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             const fraudProofStub = sinon.stub(
//                 validationService["fraudProofService"],
//                 "createInvalidTimestampProof"
//             );

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.DISPUTE);
//             expect(fraudProofStub.called).to.be.true;
//         });

//         // Test Case 6: Invalid timing, retry successful
//         it("Case 6: Invalid timing, fetch onChain successful, recursive validation passes", async () => {
//             const previousBlock = createBlock({
//                 timestamp: TIMING.BASE_TIMESTAMP,
//                 onChainTimestamp: undefined, // IMPORTANT: No onChain initially
//                 forkId: "0xfork",
//                 height: 1 // NOT genesis (height 0)
//             });

//             // Create a mock that will change behavior after the onChainTimestamp is set
//             let timestampUpdated = false;
//             previousBlock.getRelevantTimestamp = sinon.stub().callsFake(() => {
//                 return timestampUpdated ? 1200 : 1000; // Return updated timestamp after fetch
//             });

//             const currentBlock = createBlock({
//                 timestamp: 1250, // Invalid with original (1000 + 1000 = 2000) but valid after update (1200 + 1000 = 2200)
//                 onChainTimestamp: undefined,
//                 author: "0xauthor",
//                 height: 2, // Next block
//                 forkId: "0xfork"
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             mockStorage.blocks.getNextBlockHeight.returns(2); // Expect height 2
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             // Mock successful fetch that returns better timestamp
//             const fetchStub = sinon.stub(
//                 validationService as any,
//                 "fetchOnChainTimestamp"
//             );
//             fetchStub.resolves(1200); // Better timestamp that makes currentBlock valid

//             // Mock the setOnChainTimestamp to trigger our flag
//             const originalSetOnChain = mockStorage.blocks.setOnChainTimestamp;
//             mockStorage.blocks.setOnChainTimestamp = sinon
//                 .stub()
//                 .callsFake((...args) => {
//                     timestampUpdated = true; // Set flag when timestamp is updated
//                     return originalSetOnChain.apply(mockStorage.blocks, args);
//                 });

//             clockStub.returns(1300); // Within agreementTime

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.SUCCESS);
//         });

//         // Test Case 7: Invalid timing, retry failed
//         it("Case 7: Invalid timing, fetch onChain fails → DISPUTE", async () => {
//             const previousBlock = createBlock({
//                 timestamp: 1000,
//                 onChainTimestamp: undefined,
//                 getRelevantTimestamp: sinon.stub().returns(1000)
//             });

//             const currentBlock = createBlock({
//                 timestamp: 2500 // Way beyond p2pTime
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             // Mock failed fetch
//             const fetchStub = sinon.stub(
//                 validationService as any,
//                 "fetchOnChainTimestamp"
//             );
//             fetchStub.resolves(undefined); // No better timestamp available

//             const fraudProofStub = sinon.stub(
//                 validationService["fraudProofService"],
//                 "createInvalidTimestampProof"
//             );

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.DISPUTE);
//             expect(fraudProofStub.called).to.be.true;
//             expect(fetchStub.called).to.be.true;
//         });

//         // Test Case 8: Valid P2P but outside agreementTime
//         it("Case 8: Valid P2P timing but outside agreementTime → NOT_ENOUGH_TIME", async () => {
//             const previousBlock = createBlock({
//                 timestamp: 1000,
//                 onChainTimestamp: undefined,
//                 getRelevantTimestamp: sinon.stub().returns(1000)
//             });

//             const currentBlock = createBlock({
//                 timestamp: 1050, // Valid P2P timing
//                 onChainTimestamp: undefined
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             // Mock Clock to be outside agreementTime
//             clockStub.returns(8000); // abs(8000 - 1050) = 6950 > 2000 (agreementTime)

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(
//                 BlockValidationResult.NOT_ENOUGH_TIME
//             );
//             expect(result.shouldDisconnect).to.be.false;
//         });

//         // Test Case 9: Current block has onChain, skips subjective check
//         it("Case 9: Current block has onChainTimestamp, skips subjective validation", async () => {
//             const previousBlock = createBlock({
//                 timestamp: 1000,
//                 getRelevantTimestamp: sinon.stub().returns(1000)
//             });

//             const currentBlock = createBlock({
//                 timestamp: 1050,
//                 onChainTimestamp: 1060 // Has onChain timestamp
//             });

//             mockStorage.getPreviousBlockOrSnapshot.returns({
//                 block: previousBlock
//             });
//             (Block.fromBlockConfirmation as any).returns(currentBlock);
//             sinon.stub(validationService as any, "isLinked").returns(true);

//             // Set clock way outside agreementTime - should be ignored
//             clockStub.returns(10000);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.SUCCESS);
//         });
//     });

//     describe("Success Case", () => {
//         it("should return SUCCESS when all validations pass", async () => {
//             sinon.stub(validationService as any, "isLinked").returns(true);
//             sinon
//                 .stub(validationService as any, "validateTimeLogic")
//                 .resolves(undefined);

//             const result = await validationService.validateBlockConfirmation(
//                 createBlockConfirmation()
//             );

//             expect(result.action).to.equal(BlockValidationResult.SUCCESS);
//         });
//     });
// });
