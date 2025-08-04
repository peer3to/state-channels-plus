import { expect } from "chai";
import { describe, it, beforeEach, before } from "mocha";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import AgreementManager from "@/agreementManager";
import Storage from "@/storage";
import { Block, StateSnapshot } from "@/models";
import * as factory from "./factory";
import { ForkId, Address, Hash } from "@/types/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, Type } from "@/utils";
import { SortOrder } from "@/storage/BlockStorage";

describe("AgreementManager", () => {
    let agreementManager: AgreementManager;
    let storage: Storage;
    let forkId: ForkId;
    let participants: Address[];
    let participant1: Address;
    let participant2: Address;
    let participant3: Address;
    let genesisSnapshot: StateSnapshot;
    let block1: Block;
    let block2: Block;
    let blockConfirmation1: BlockConfirmationStruct;
    let blockConfirmation2: BlockConfirmationStruct;
    let signers: HardhatEthersSigner[];
    let genesisStateMachineStateHash: Hash;

    before(async () => {
        signers = await ethers.getSigners();
        participant1 = signers[0].address;
        participant2 = signers[1].address;
        participant3 = signers[2].address;
        participants = [participant1, participant2, participant3];

        genesisStateMachineStateHash = factory.hash();

        const snapshotData = {
            participants: participants,
            stateMachineStateHash: genesisStateMachineStateHash,
            latestJoinChannelBlockHash: factory.hash(),
            latestExitChannelBlockHash: factory.hash(),
            totalDeposits: { amount: BigInt(1000), data: "0x" },
            totalWithdrawals: { amount: BigInt(0), data: "0x" }
        };

        const snapshotDataHash = ethers.keccak256(
            Codec.encode(snapshotData, Type.SnapshotData)
        );
        forkId = snapshotDataHash;

        genesisSnapshot = factory.stateSnapshot({
            forkId: forkId,
            snapshotData: snapshotData
        });

        block1 = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkId: forkId,
                    transactionCnt: 1,
                    participant: participant1
                })
            }),
            stateSnapshotHash: genesisSnapshot.hash
        });

        block2 = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkId: forkId,
                    transactionCnt: 2,
                    participant: participant2
                })
            }),
            stateSnapshotHash: genesisSnapshot.hash
        });

        const block1Hash = ethers.keccak256(block1.encode());
        const block2Hash = ethers.keccak256(block2.encode());

        const signature1 = await signers[0].signMessage(
            ethers.getBytes(block1Hash)
        );
        const signature2 = await signers[1].signMessage(
            ethers.getBytes(block2Hash)
        );

        blockConfirmation1 = factory.blockConfirmation({
            signedBlock: factory.signedBlock({
                encodedBlock: block1.encode(),
                signature: signature1
            }),
            signatures: []
        });

        blockConfirmation2 = factory.blockConfirmation({
            signedBlock: factory.signedBlock({
                encodedBlock: block2.encode(),
                signature: signature2
            }),
            signatures: []
        });
    });

    beforeEach(() => {
        storage = new Storage();
        agreementManager = new AgreementManager(storage);
        storage.stateSnapshots.storeStateSnapshot(genesisSnapshot);
        storage.stateMachineStates.storeStateMachineState(
            "0x1234567890abcdef",
            { hash: genesisStateMachineStateHash }
        );
    });

    describe("didEveryoneSignBlock", () => {
        it("should return true when all participants signed", async () => {
            const allSignedBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash
            });

            const blockHash = ethers.keccak256(allSignedBlock.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );
            const signature2 = await signers[1].signMessage(
                ethers.getBytes(blockHash)
            );
            const signature3 = await signers[2].signMessage(
                ethers.getBytes(blockHash)
            );

            const allSignedConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: allSignedBlock.encode(),
                    signature: authorSignature
                }),
                signatures: [signature2, signature3]
            });

            storage.blocks.storeBlockConfirmation(allSignedConfirmation);

            expect(agreementManager.didEveryoneSignBlock(allSignedBlock)).to.be
                .true;
        });

        it("should return false when not all participants signed", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);
            expect(agreementManager.didEveryoneSignBlock(block1)).to.be.false;
        });

        it("should return false when block does not exist", () => {
            const nonExistentBlock = factory.block();
            expect(agreementManager.didEveryoneSignBlock(nonExistentBlock)).to
                .be.false;
        });
    });

    describe("getDoubleSignedBlock", () => {
        it("should return existing block when same author signs different block at same coordinates", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const differentBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: ethers.hexlify(ethers.randomBytes(32))
            });

            const differentSignedBlock = factory.signedBlock({
                encodedBlock: differentBlock.encode(),
                signature: factory.signature()
            });

            const result =
                agreementManager.getDoubleSignedBlock(differentSignedBlock);
            expect(result).to.deep.equal(blockConfirmation1.signedBlock);
        });

        it("should return undefined when no existing block at coordinates", () => {
            const newSignedBlock = factory.signedBlock();
            expect(agreementManager.getDoubleSignedBlock(newSignedBlock)).to.be
                .undefined;
        });

        it("should return undefined when different author at same coordinates", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const differentAuthorBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash
            });

            const differentAuthorSignedBlock = factory.signedBlock({
                encodedBlock: differentAuthorBlock.encode(),
                signature: factory.signature()
            });

            expect(
                agreementManager.getDoubleSignedBlock(
                    differentAuthorSignedBlock
                )
            ).to.be.undefined;
        });
    });

    describe("hasParticipantSignedDispute", () => {
        it("should return true when participant is the disputer", () => {
            const dispute = factory.dispute({ disputer: participant1 });
            const disputeConfirmation: DisputeConfirmationStruct = {
                signedDispute: factory.signedDispute({
                    encodedDispute: Codec.encode(dispute, Type.Dispute),
                    signature: factory.signature()
                }),
                signatures: []
            };

            storage.disputes.storeDisputeConfirmation(disputeConfirmation);

            expect(
                agreementManager.hasParticipantSignedDispute(
                    dispute,
                    participant1
                )
            ).to.be.true;
        });

        it("should return true when participant signed as confirmation signer", async () => {
            const dispute = factory.dispute({ disputer: participant2 });
            const disputeHash = ethers.keccak256(
                Codec.encode(dispute, Type.Dispute)
            );
            const signature = await signers[0].signMessage(
                ethers.getBytes(disputeHash)
            );

            const disputeConfirmation: DisputeConfirmationStruct = {
                signedDispute: factory.signedDispute({
                    encodedDispute: Codec.encode(dispute, Type.Dispute),
                    signature: factory.signature()
                }),
                signatures: [signature]
            };

            storage.disputes.storeDisputeConfirmation(disputeConfirmation);

            expect(
                agreementManager.hasParticipantSignedDispute(
                    dispute,
                    signers[0].address
                )
            ).to.be.true;
        });

        it("should return false when participant did not sign", () => {
            const dispute = factory.dispute({ disputer: participant1 });
            const disputeConfirmation: DisputeConfirmationStruct = {
                signedDispute: factory.signedDispute({
                    encodedDispute: Codec.encode(dispute, Type.Dispute),
                    signature: factory.signature()
                }),
                signatures: []
            };

            storage.disputes.storeDisputeConfirmation(disputeConfirmation);

            expect(
                agreementManager.hasParticipantSignedDispute(
                    dispute,
                    participant2
                )
            ).to.be.false;
        });

        it("should return false when dispute confirmation does not exist", () => {
            const dispute = factory.dispute({ disputer: participant1 });
            expect(
                agreementManager.hasParticipantSignedDispute(
                    dispute,
                    participant1
                )
            ).to.be.false;
        });
    });

    describe("getLatestSignedBlockByParticipant", () => {
        it("should return the latest block signed by a participant", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);
            storage.blocks.storeBlockConfirmation(blockConfirmation2);

            const result = agreementManager.getLatestSignedBlockByParticipant(
                forkId,
                participant1
            );

            expect(result).to.not.be.undefined;
            expect(result!.block.equals(block1)).to.be.true;
            expect(result!.signature).to.equal(
                blockConfirmation1.signedBlock.signature
            );
        });

        it("should return undefined when participant has not signed any blocks", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const result = agreementManager.getLatestSignedBlockByParticipant(
                forkId,
                participant3
            );

            expect(result).to.be.undefined;
        });

        it("should return undefined when fork has no blocks", () => {
            const result = agreementManager.getLatestSignedBlockByParticipant(
                forkId,
                participant1
            );

            expect(result).to.be.undefined;
        });
    });

    describe("didParticipantSign", () => {
        it("should return true when participant is the author", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const result = agreementManager.didParticipantSign(
                block1,
                participant1
            );

            expect(result.didSign).to.be.true;
            expect(result.signature).to.equal(
                blockConfirmation1.signedBlock.signature
            );
        });

        it("should return true when participant signed as additional signer", async () => {
            const blockWithAdditionalSigner = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash
            });

            const blockHash = ethers.keccak256(
                blockWithAdditionalSigner.encode()
            );
            const authorSignature = await signers[1].signMessage(
                ethers.getBytes(blockHash)
            );
            const additionalSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );

            const confirmationWithAdditionalSigner = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockWithAdditionalSigner.encode(),
                    signature: authorSignature
                }),
                signatures: [additionalSignature]
            });

            storage.blocks.storeBlockConfirmation(
                confirmationWithAdditionalSigner
            );

            const result = agreementManager.didParticipantSign(
                blockWithAdditionalSigner,
                participant1
            );

            expect(result.didSign).to.be.true;
            expect(result.signature).to.not.be.undefined;
        });

        it("should return false when participant did not sign", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const result = agreementManager.didParticipantSign(
                block1,
                participant3
            );

            expect(result.didSign).to.be.false;
            expect(result.signature).to.be.undefined;
        });

        it("should return false when block does not exist", () => {
            const nonExistentBlock = factory.block();

            const result = agreementManager.didParticipantSign(
                nonExistentBlock,
                participant1
            );

            expect(result.didSign).to.be.false;
            expect(result.signature).to.be.undefined;
        });
    });

    describe("getParticipantsWhoDidntSign", () => {
        it("should return participants who did not sign the block", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const result = agreementManager.getParticipantsWhoDidntSign(block1);

            expect(result).to.include(participant2);
            expect(result).to.include(participant3);
            expect(result).to.not.include(participant1);
        });

        it("should return empty array when all participants signed", async () => {
            const allSignedBlock = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash
            });

            const blockHash = ethers.keccak256(allSignedBlock.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );
            const signature2 = await signers[1].signMessage(
                ethers.getBytes(blockHash)
            );
            const signature3 = await signers[2].signMessage(
                ethers.getBytes(blockHash)
            );

            const allSignedConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: allSignedBlock.encode(),
                    signature: authorSignature
                }),
                signatures: [signature2, signature3]
            });

            storage.blocks.storeBlockConfirmation(allSignedConfirmation);

            const result =
                agreementManager.getParticipantsWhoDidntSign(allSignedBlock);

            expect(result).to.be.empty;
        });

        it("should return empty array when block does not exist", () => {
            const nonExistentBlock = factory.block();

            const result =
                agreementManager.getParticipantsWhoDidntSign(nonExistentBlock);

            expect(result).to.be.empty;
        });
    });

    describe("getStateProof", () => {
        it("should return StateProofStruct with milestones and signed blocks", async () => {
            // Store some blocks
            storage.blocks.storeBlockConfirmation(blockConfirmation1);
            storage.blocks.storeBlockConfirmation(blockConfirmation2);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            expect(result).to.have.property("milestones");
            expect(result).to.have.property("signedBlocks");
            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should handle case with no exit points", async () => {
            // No exit points stored
            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            expect(result.milestones).to.have.length(0);
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should process exit points and build milestone proofs", async () => {
            // Store exit points
            storage.exitPoints.storeExitPoint(forkId, 5);
            storage.exitPoints.storeExitPoint(forkId, 10);

            // Create state snapshots at exit points
            const snapshotAtHeight5 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2], // participant3 removed
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            const snapshotAtHeight10 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1], // participant2 and participant3 removed
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(200), data: "0x" }
                }
            });

            // Store the snapshots
            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);
            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight10);

            // Create blocks at exit point heights
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshotAtHeight5.hash
            });

            const blockAtHeight10 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 10,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: snapshotAtHeight10.hash
            });

            // Store block confirmations with signatures from all participants
            const blockHash5 = ethers.keccak256(blockAtHeight5.encode());
            const blockHash10 = ethers.keccak256(blockAtHeight10.encode());

            const blockConfirmationAtHeight5 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight5.encode(),
                    signature: await signers[0].signMessage(
                        ethers.getBytes(blockHash5)
                    )
                }),
                signatures: [
                    await signers[1].signMessage(ethers.getBytes(blockHash5)),
                    await signers[2].signMessage(ethers.getBytes(blockHash5))
                ]
            });

            const blockConfirmationAtHeight10 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight10.encode(),
                    signature: await signers[1].signMessage(
                        ethers.getBytes(blockHash10)
                    )
                }),
                signatures: [
                    await signers[0].signMessage(ethers.getBytes(blockHash10)),
                    await signers[2].signMessage(ethers.getBytes(blockHash10))
                ]
            });

            storage.blocks.storeBlockConfirmation(blockConfirmationAtHeight5);
            storage.blocks.storeBlockConfirmation(blockConfirmationAtHeight10);

            const result = await agreementManager.getStateProof(
                forkId,
                15,
                participant1
            );

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should handle case where exit point snapshot is not found", async () => {
            // Store exit point but no corresponding snapshot
            storage.exitPoints.storeExitPoint(forkId, 5);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should handle case where milestone proof cannot be built", async () => {
            // Store exit point but no blocks to build proof
            storage.exitPoints.storeExitPoint(forkId, 5);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should throw error when fork not found", async () => {
            const nonExistentForkId = ethers.hexlify(ethers.randomBytes(32));

            await expect(
                agreementManager.getStateProof(
                    nonExistentForkId,
                    10,
                    participant1
                )
            ).to.be.rejectedWith("Fork not found");
        });

        it("should collect signed blocks from backward iteration", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Store some blocks
            storage.blocks.storeBlockConfirmation(blockConfirmation1);
            storage.blocks.storeBlockConfirmation(blockConfirmation2);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            expect(result.signedBlocks).to.be.an("array");
            expect(result.signedBlocks.length).to.be.greaterThan(0);

            // Verify that signed blocks have the correct structure
            result.signedBlocks.forEach((signedBlock) => {
                expect(signedBlock).to.have.property("encodedBlock");
                expect(signedBlock).to.have.property("signature");
            });
        });

        it("should handle multiple exit points in correct order", async () => {
            // Store exit points in reverse order to test sorting
            storage.exitPoints.storeExitPoint(forkId, 100);
            storage.exitPoints.storeExitPoint(forkId, 50);

            // Create state snapshots at exit points
            const snapshotAtHeight50 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2], // participant3 removed
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            const snapshotAtHeight100 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1], // participant2 and participant3 removed
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(200), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight50);
            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight100);

            const result = await agreementManager.getStateProof(
                forkId,
                150,
                participant1
            );

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should include author signature when building milestone proofs", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Create state snapshot at exit point with only 2 participants
            const snapshotAtHeight5 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2], // Only 2 participants
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);

            // Create a block at exit point height authored by participant1
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1 // Author is participant1
                    })
                }),
                stateSnapshotHash: snapshotAtHeight5.hash
            });

            const blockHash5 = ethers.keccak256(blockAtHeight5.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash5)
            );
            const participant2Signature = await signers[1].signMessage(
                ethers.getBytes(blockHash5)
            );
            const participant3Signature = await signers[2].signMessage(
                ethers.getBytes(blockHash5)
            );

            // Create block confirmation with all participants' signatures
            const blockConfirmationAtHeight5 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight5.encode(),
                    signature: authorSignature
                }),
                signatures: [participant2Signature, participant3Signature] // All participants signed
            });

            storage.blocks.storeBlockConfirmation(blockConfirmationAtHeight5);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            // Should have a milestone proof because all participants signed
            expect(result).to.have.property("milestones");
            expect(result).to.have.property("signedBlocks");
            expect(Array.isArray(result.milestones)).to.be.true;
            expect(Array.isArray(result.signedBlocks)).to.be.true;
            expect(result.milestones.length).to.equal(1);
            expect(result.milestones[0].blockConfirmations).to.have.length(1);

            // Verify the milestone proof contains the block confirmation
            const milestoneBlockConfirmation =
                result.milestones[0].blockConfirmations[0];
            expect(
                milestoneBlockConfirmation.signedBlock.encodedBlock
            ).to.equal(blockAtHeight5.encode());
            expect(milestoneBlockConfirmation.signedBlock.signature).to.equal(
                authorSignature
            );

            // With corrected filtering logic: only CURRENT participant signatures should be included
            // participant1 (author) and participant2 are CURRENT participants, so their signatures are included
            // participant3 is NEW participant, so their signature should be filtered out
            expect(milestoneBlockConfirmation.signatures).to.have.length(1);
            expect(milestoneBlockConfirmation.signatures).to.include(
                participant2Signature
            );
            expect(milestoneBlockConfirmation.signatures).to.not.include(
                participant3Signature
            );
        });

        it("should not create milestone proof when only author signed", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Create state snapshot at exit point with 2 participants
            const snapshotAtHeight5 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2], // 2 participants
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);

            // Create a block authored by participant1
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1 // Author is participant1
                    })
                }),
                stateSnapshotHash: snapshotAtHeight5.hash
            });

            const blockHash5 = ethers.keccak256(blockAtHeight5.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash5)
            );

            // Create block confirmation with ONLY author's signature
            const blockConfirmationAtHeight5 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight5.encode(),
                    signature: authorSignature
                }),
                signatures: [] // No additional signatures - only author signed
            });

            storage.blocks.storeBlockConfirmation(blockConfirmationAtHeight5);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            // Should NOT have a milestone proof because only author signed (not all participants)
            expect(result.milestones).to.have.length(0);
        });

        it("should filter out signatures from new participants", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Create state snapshot at exit point with only 2 participants
            const snapshotAtHeight5 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2], // Only 2 participants
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);

            // Create a block authored by participant1 (CURRENT participant)
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1 // Author is CURRENT participant
                    })
                }),
                stateSnapshotHash: snapshotAtHeight5.hash
            });

            const blockHash5 = ethers.keccak256(blockAtHeight5.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash5)
            );
            const participant2Signature = await signers[1].signMessage(
                ethers.getBytes(blockHash5)
            );
            const participant3Signature = await signers[2].signMessage(
                ethers.getBytes(blockHash5)
            );

            // Create block confirmation with ALL signatures
            const blockConfirmationAtHeight5 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight5.encode(),
                    signature: authorSignature
                }),
                signatures: [participant2Signature, participant3Signature] // participant2 is CURRENT, participant3 is NEW
            });

            storage.blocks.storeBlockConfirmation(blockConfirmationAtHeight5);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            // Should have a milestone proof because all current participants signed
            expect(result).to.have.property("milestones");
            expect(result).to.have.property("signedBlocks");
            expect(Array.isArray(result.milestones)).to.be.true;
            expect(Array.isArray(result.signedBlocks)).to.be.true;
            expect(result.milestones.length).to.equal(1);
            expect(result.milestones[0].blockConfirmations).to.have.length(1);

            // Verify the milestone proof contains filtered signatures (only CURRENT participants)
            const milestoneBlockConfirmation =
                result.milestones[0].blockConfirmations[0];
            expect(
                milestoneBlockConfirmation.signedBlock.encodedBlock
            ).to.equal(blockAtHeight5.encode());
            expect(milestoneBlockConfirmation.signedBlock.signature).to.equal(
                authorSignature
            );

            // Should only include participant2's signature (CURRENT participant)
            // participant1 (author) and participant2 signatures should be included (CURRENT participants)
            // participant3's signature should be filtered out (NEW participant)
            expect(milestoneBlockConfirmation.signatures).to.have.length(1);
            expect(milestoneBlockConfirmation.signatures).to.include(
                participant2Signature
            );
            expect(milestoneBlockConfirmation.signatures).to.not.include(
                participant3Signature
            );
        });

        it("should include all signatures when all participants are current", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Create state snapshot at exit point with all 3 participants
            const snapshotAtHeight5 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2, participant3], // All 3 participants
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);

            // Create block with signatures from all participants
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshotAtHeight5.hash
            });

            const blockHash5 = ethers.keccak256(blockAtHeight5.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash5)
            );
            const participant2Signature = await signers[1].signMessage(
                ethers.getBytes(blockHash5)
            );
            const participant3Signature = await signers[2].signMessage(
                ethers.getBytes(blockHash5)
            );

            const blockConfirmationAtHeight5 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight5.encode(),
                    signature: authorSignature
                }),
                signatures: [participant2Signature, participant3Signature]
            });

            storage.blocks.storeBlockConfirmation(blockConfirmationAtHeight5);

            const result = await agreementManager.getStateProof(
                forkId,
                10,
                participant1
            );

            // Should have a milestone proof because all participants signed
            expect(result).to.have.property("milestones");
            expect(result).to.have.property("signedBlocks");
            expect(Array.isArray(result.milestones)).to.be.true;
            expect(Array.isArray(result.signedBlocks)).to.be.true;
            expect(result.milestones.length).to.equal(1);
            expect(result.milestones[0].blockConfirmations).to.have.length(1);

            // Verify the milestone proof contains all signatures from current participants
            const milestoneBlockConfirmation =
                result.milestones[0].blockConfirmations[0];
            expect(
                milestoneBlockConfirmation.signedBlock.encodedBlock
            ).to.equal(blockAtHeight5.encode());
            expect(milestoneBlockConfirmation.signedBlock.signature).to.equal(
                authorSignature
            );
            expect(milestoneBlockConfirmation.signatures).to.have.length(2);
            expect(milestoneBlockConfirmation.signatures).to.include(
                participant2Signature
            );
            expect(milestoneBlockConfirmation.signatures).to.include(
                participant3Signature
            );
        });
    });

    describe("didParticipantPostOnChainLocal", () => {
        it("should return false when block does not exist", () => {
            const result = agreementManager.didParticipantPostOnChainLocal(
                forkId,
                999,
                participant1
            );

            expect(result).to.be.false;
        });

        it("should return false when block has no on-chain timestamp", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);

            const result = agreementManager.didParticipantPostOnChainLocal(
                forkId,
                1,
                participant1
            );

            expect(result).to.be.false;
        });
    });
});
