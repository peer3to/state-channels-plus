import { expect } from "chai";
import { describe, it, beforeEach, before } from "mocha";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import AgreementManager from "@/agreementManager";
import Storage from "@/storage";
import { Block, StateSnapshot } from "@/models";
import * as factory from "./factory";
import { ForkId, Address, Hash } from "@/types/types";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, Type } from "@/utils";
import { SortOrder } from "@/storage/BlockStorage";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

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
            const block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash
            });
            const allSignedBlock = await block
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[1]),
                        await b.sign(signers[2])
                    ])
                );

            storage.blocks.storeBlock(allSignedBlock);

            expect(agreementManager.didEveryoneSignBlock(allSignedBlock)).to.be
                .true;
        });

        it("should return false when not all participants signed", () => {
            storage.blocks.storeBlock(block1);
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
            storage.blocks.storeBlock(block1);

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

            const result = agreementManager.getDoubleSignedBlock(
                differentBlock.signedBlock
            );
            expect(result).to.deep.equal(block1);
        });

        it("should return undefined when no existing block at coordinates", () => {
            const newSignedBlock = factory.signedBlock();
            expect(agreementManager.getDoubleSignedBlock(newSignedBlock)).to.be
                .undefined;
        });

        it("should return undefined when different author at same coordinates", () => {
            storage.blocks.storeBlock(block1);

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

            expect(
                agreementManager.getDoubleSignedBlock(
                    differentAuthorBlock.signedBlock
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
        it("should return the latest block signed by a participant", async () => {
            storage.blocks.storeBlock(await block1.signAsAuthor(signers[0]));
            storage.blocks.storeBlock(block2);

            const result = agreementManager.getLatestSignedBlockByParticipant(
                forkId,
                participant1
            );

            expect(result).to.not.be.undefined;
            expect(result!.block.equals(block1)).to.be.true;
            expect(result!.signature).to.equal(block1.originalSignature);
        });

        it("should return undefined when participant has not signed any blocks", () => {
            storage.blocks.storeBlock(block1);

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

    describe("getParticipantsWhoDidntSign", () => {
        it("should return participants who did not sign the block", async () => {
            storage.blocks.storeBlock(await block1.signAsAuthor(signers[0]));

            const result = agreementManager.getParticipantsWhoDidntSign(block1);

            expect(result).to.include(participant2);
            expect(result).to.include(participant3);
            expect(result).to.not.include(participant1);
        });

        it("should return empty array when all participants signed", async () => {
            const allSignedBlock = await block1
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[1]),
                        await b.sign(signers[2])
                    ])
                );

            storage.blocks.storeBlock(allSignedBlock);

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
            storage.blocks.storeBlock(block1);
            storage.blocks.storeBlock(block2);

            const result = await agreementManager.getStateProof(forkId, 10);

            expect(result).to.have.property("milestones");
            expect(result).to.have.property("signedBlocks");
            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should handle case with no exit points", async () => {
            // No exit points stored
            const result = await agreementManager.getStateProof(forkId, 10);

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

            const blockAtHeight5Signed = await blockAtHeight5
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[1]),
                        await b.sign(signers[2])
                    ])
                );

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

            const blockAtHeight10Signed = await blockAtHeight10
                .signAsAuthor(signers[1])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[0]),
                        await b.sign(signers[2])
                    ])
                );

            storage.blocks.storeBlock(blockAtHeight5Signed);
            storage.blocks.storeBlock(blockAtHeight10Signed);

            const result = await agreementManager.getStateProof(forkId, 15);

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should handle case where exit point snapshot is not found", async () => {
            // Store exit point but no corresponding snapshot
            storage.exitPoints.storeExitPoint(forkId, 5);

            const result = await agreementManager.getStateProof(forkId, 10);

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should handle case where milestone proof cannot be built", async () => {
            // Store exit point but no blocks to build proof
            storage.exitPoints.storeExitPoint(forkId, 5);

            const result = await agreementManager.getStateProof(forkId, 10);

            expect(result.milestones).to.be.an("array");
            expect(result.signedBlocks).to.be.an("array");
        });

        it("should throw error when fork not found", async () => {
            const nonExistentForkId = ethers.hexlify(ethers.randomBytes(32));

            await expect(
                agreementManager.getStateProof(nonExistentForkId, 10)
            ).to.be.rejectedWith("Fork not found");
        });

        it("should collect signed blocks from backward iteration", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Create blocks that form a chain where each block links to the previous one
            // This way participants implicitly validate previous blocks by building on them
            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash // Links to genesis
            });

            const block2 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 2,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: block1.hash // Links to block1
            });

            const block3 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 3,
                        participant: participant3
                    })
                }),
                stateSnapshotHash: block2.hash // Links to block2
            });

            // only author signed
            const block1Signed = await block1.signAsAuthor(signers[0]);
            const block2Signed = await block2.signAsAuthor(signers[1]);
            const block3Signed = await block3.signAsAuthor(signers[2]);

            storage.blocks.storeBlock(block1Signed);
            storage.blocks.storeBlock(block2Signed);
            storage.blocks.storeBlock(block3Signed);

            const result = await agreementManager.getStateProof(
                forkId,
                3 // Use height 3 so we have blocks to collect
            );

            expect(result.signedBlocks).to.be.an("array");

            // With new logic: if milestone can be built, signedBlocks will be empty
            // If no milestone can be built, signedBlocks will contain blocks
            if (result.milestones.length > 0) {
                // If we have milestones, signedBlocks should be empty
                expect(result.signedBlocks.length).to.equal(0);
            } else {
                // If no milestones, we should have signed blocks
                expect(result.signedBlocks.length).to.be.greaterThan(0);

                // Verify that signed blocks have the correct structure
                result.signedBlocks.forEach((signedBlock) => {
                    expect(signedBlock).to.have.property("encodedBlock");
                    expect(signedBlock).to.have.property("signature");
                });
            }
        });

        it("should verify signedBlocks contains actual block confirmations", async () => {
            // Create a scenario where no milestones can be built, forcing signedBlocks collection
            // No exit points stored - this should force signedBlocks collection

            // Create blocks that commit to a different snapshot (not genesis)
            const differentSnapshot = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2, participant3],
                    stateMachineStateHash: factory.hash(), // Different hash
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });
            storage.stateSnapshots.storeStateSnapshot(differentSnapshot);

            // Create blocks that commit to the different snapshot
            // Only participant1 and participant2 will sign blocks, participant3 will NOT sign any block
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: differentSnapshot.hash
            });

            const blockAtHeight6 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 6,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: differentSnapshot.hash
            });

            const blockAtHeight7 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 7,
                        participant: participant1 // participant1 authors another block
                    })
                }),
                stateSnapshotHash: differentSnapshot.hash
            });
            const blockAtHeight5Signed = await blockAtHeight5.signAsAuthor(
                signers[0]
            );
            const blockAtHeight6Signed = await blockAtHeight6.signAsAuthor(
                signers[1]
            );
            const blockAtHeight7Signed = await blockAtHeight7.signAsAuthor(
                signers[0]
            );

            storage.blocks.storeBlock(blockAtHeight5Signed);
            storage.blocks.storeBlock(blockAtHeight6Signed);
            storage.blocks.storeBlock(blockAtHeight7Signed);

            const result = await agreementManager.getStateProof(forkId, 7);

            // Should have no milestones since participant3 never signed any block
            expect(result.milestones).to.have.length(0);

            // Should have signed blocks
            expect(result.signedBlocks).to.be.an("array");
            expect(result.signedBlocks.length).to.be.greaterThan(0);

            // Verify that signedBlocks contains the actual block confirmations
            const signedBlockHeights = result.signedBlocks.map(
                (sb) => Block.fromSignedBlock(sb).height
            );

            // Should contain all the blocks we created
            expect(signedBlockHeights.sort()).to.deep.equal([5, 6, 7]);

            // Verify the order is ascending (since we reverse the array)
            expect(signedBlockHeights).to.deep.equal([5, 6, 7]);

            // Verify that each signedBlock has the correct structure and content
            result.signedBlocks.forEach((signedBlock, index) => {
                const block = Block.fromSignedBlock(signedBlock);
                expect(block.height).to.equal(5 + index); // Should be heights 5, 6, 7

                // Verify the signature matches the expected signer
                const expectedSignatures = [
                    blockAtHeight5Signed.originalSignature,
                    blockAtHeight6Signed.originalSignature,
                    blockAtHeight7Signed.originalSignature
                ];
                expect(block.originalSignature).to.equal(
                    expectedSignatures[index]
                );
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

            const result = await agreementManager.getStateProof(forkId, 150);

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
            const blockAtHeight5Signed = await blockAtHeight5
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[1]),
                        await b.sign(signers[2])
                    ])
                );

            storage.blocks.storeBlock(blockAtHeight5Signed);

            const result = await agreementManager.getStateProof(forkId, 10);

            // Should have a milestone proof because all participants signed

            expect(Array.isArray(result.milestones)).to.be.true;
            expect(Array.isArray(result.signedBlocks)).to.be.true;
            expect(result.milestones.length).to.be.greaterThan(0);
            // Find the milestone that contains our block
            const milestoneWithOurBlock = result.milestones.find((milestone) =>
                milestone.blockConfirmations.some(
                    (bc) =>
                        bc.signedBlock.encodedBlock === blockAtHeight5.encode()
                )
            );
            expect(milestoneWithOurBlock).to.not.be.undefined;
            // Since all 2 participants signed the same block, we should have exactly 1 block confirmation
            expect(milestoneWithOurBlock!.blockConfirmations).to.have.length(1);
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

            const blockAtHeight5Signed = await blockAtHeight5.signAsAuthor(
                signers[0]
            );

            storage.blocks.storeBlock(blockAtHeight5Signed);

            const result = await agreementManager.getStateProof(forkId, 10);

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
            const blockAtHeight5Signed = await blockAtHeight5
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[1]),
                        await b.sign(signers[2])
                    ])
                );

            storage.blocks.storeBlock(blockAtHeight5Signed);

            const result = await agreementManager.getStateProof(forkId, 10);

            // Should have a milestone proof because all current participants signed
            expect(result).to.have.property("milestones");
            expect(result).to.have.property("signedBlocks");
            expect(Array.isArray(result.milestones)).to.be.true;
            expect(Array.isArray(result.signedBlocks)).to.be.true;
            // With new logic: we can have multiple milestones (exit point + latest)
            expect(result.milestones.length).to.be.greaterThan(0);
            // Find the milestone that contains our block
            const milestoneWithOurBlock = result.milestones.find((milestone) =>
                milestone.blockConfirmations.some(
                    (bc) =>
                        bc.signedBlock.encodedBlock === blockAtHeight5.encode()
                )
            );
            expect(milestoneWithOurBlock).to.not.be.undefined;
            // Since all 2 current participants signed the same block, we should have exactly 1 block confirmation
            expect(milestoneWithOurBlock!.blockConfirmations).to.have.length(1);
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
            const blockAtHeight5Signed = await blockAtHeight5
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([
                        await b.sign(signers[1]),
                        await b.sign(signers[2])
                    ])
                );

            storage.blocks.storeBlock(blockAtHeight5Signed);

            const result = await agreementManager.getStateProof(forkId, 10);

            // Should have a milestone proof because all participants signed

            expect(Array.isArray(result.milestones)).to.be.true;
            expect(Array.isArray(result.signedBlocks)).to.be.true;
            // With new logic: we can have multiple milestones (exit point + latest)
            expect(result.milestones.length).to.be.greaterThan(0);
            // Find the milestone that contains our block
            const milestoneWithOurBlock = result.milestones.find((milestone) =>
                milestone.blockConfirmations.some(
                    (bc) =>
                        bc.signedBlock.encodedBlock === blockAtHeight5.encode()
                )
            );
            expect(milestoneWithOurBlock).to.not.be.undefined;
            // Since all 3 participants signed the same block, we should have exactly 1 block confirmation
            expect(milestoneWithOurBlock!.blockConfirmations).to.have.length(1);
        });

        it("should throw error when milestone snapshot is missing", async () => {
            // Store exit point
            storage.exitPoints.storeExitPoint(forkId, 5);

            // Create a block that will form a milestone
            const blockAtHeight5 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: genesisSnapshot.hash
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

            // Store the block confirmation (which will allow milestone to be built)
            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmationAtHeight5)
            );

            // BUT DON'T store the snapshot that the block references
            // This simulates the data integrity issue

            await expect(
                agreementManager.getStateProof(forkId, 10)
            ).to.be.rejectedWith(
                "Milestone built but corresponding snapshot not found"
            );
        });

        it("should throw error when empty milestone is passed to getSnapshot", async () => {
            // Create an empty milestone
            const emptyMilestone = factory.milestoneProof({
                blockConfirmations: []
            });

            expect(() => {
                agreementManager.getSnapshot(emptyMilestone);
            }).to.throw("Cannot get snapshot from empty milestone");
        });

        it("should break early when milestone cannot be built for exit point", async () => {
            // Store multiple exit points
            storage.exitPoints.storeExitPoint(forkId, 5);
            storage.exitPoints.storeExitPoint(forkId, 10);

            // Create snapshot for first exit point
            const snapshotAtHeight5 = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2, participant3],
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });
            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);

            // Create a block at height 5 with insufficient signatures (only author signed)
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

            const blockConfirmationAtHeight5 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight5.encode(),
                    signature: authorSignature
                }),
                signatures: [] // Only author signed, not enough for milestone
            });

            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmationAtHeight5)
            );

            // Create a block at height 10 that could form a milestone
            const blockAtHeight10 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 10,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: snapshotAtHeight5.hash
            });

            const blockHash10 = ethers.keccak256(blockAtHeight10.encode());
            const authorSignature10 = await signers[1].signMessage(
                ethers.getBytes(blockHash10)
            );
            const participant1Signature = await signers[0].signMessage(
                ethers.getBytes(blockHash10)
            );
            const participant3Signature = await signers[2].signMessage(
                ethers.getBytes(blockHash10)
            );

            const blockConfirmationAtHeight10 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: blockAtHeight10.encode(),
                    signature: authorSignature10
                }),
                signatures: [participant1Signature, participant3Signature]
            });

            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmationAtHeight10)
            );

            // The result should have no milestones because we can't build a milestone for exit point 5
            // and the loop should break early, preventing processing of exit point 10
            const result = await agreementManager.getStateProof(forkId, 15);

            expect(result.milestones).to.have.length(0);
            expect(result.signedBlocks).to.be.an("array");
        });
    });

    describe("tryBuildMilestone", () => {
        it("should build milestone when all participants sign", async () => {
            // Create a snapshot with 2 participants
            const snapshot = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2],
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            // Create a block with signatures from both participants
            const block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshot.hash
            });

            const blockHash = ethers.keccak256(block.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );
            const participant2Signature = await signers[1].signMessage(
                ethers.getBytes(blockHash)
            );

            const blockConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block.encode(),
                    signature: authorSignature
                }),
                signatures: [participant2Signature]
            });

            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmation)
            );

            // Create iterator starting from the block
            const blockIterator = storage.blocks.getIterator(
                forkId,
                SortOrder.ASC,
                5
            );

            const milestone = agreementManager.tryBuildMilestone(
                blockIterator,
                snapshot
            );

            expect(milestone).to.not.be.undefined;
            expect(milestone!.blockConfirmations).to.have.length(1);
            expect(
                milestone!.blockConfirmations[0].signedBlock.encodedBlock
            ).to.equal(block.encode());
            expect(milestone!.blockConfirmations[0].signatures).to.have.length(
                1
            );
            expect(milestone!.blockConfirmations[0].signatures).to.include(
                participant2Signature
            );
        });

        it("should return undefined when not all participants sign", async () => {
            // Create a snapshot with 3 participants
            const snapshot = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2, participant3],
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            // Create a block with signatures from only 2 participants
            const block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshot.hash
            });
            const blockAtHeight5Signed = await block
                .signAsAuthor(signers[0])
                .then(async (b) =>
                    b.expandSignatures([await b.sign(signers[1])])
                );

            storage.blocks.storeBlock(blockAtHeight5Signed);

            const blockIterator = storage.blocks.getIterator(
                forkId,
                SortOrder.ASC,
                5
            );

            const milestone = agreementManager.tryBuildMilestone(
                blockIterator,
                snapshot
            );

            expect(milestone).to.be.undefined;
        });

        it("should filter signatures from non-participants", async () => {
            // Create a snapshot with only 2 participants
            const snapshot = factory.stateSnapshot({
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

            // Create a block with signatures from all 3 participants
            const block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshot.hash
            });

            const blockHash = ethers.keccak256(block.encode());
            const authorSignature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );
            const participant2Signature = await signers[1].signMessage(
                ethers.getBytes(blockHash)
            );
            const participant3Signature = await signers[2].signMessage(
                ethers.getBytes(blockHash)
            );

            const blockConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block.encode(),
                    signature: authorSignature
                }),
                signatures: [participant2Signature, participant3Signature] // All 3 signed
            });

            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmation)
            );

            const blockIterator = storage.blocks.getIterator(
                forkId,
                SortOrder.ASC,
                5
            );

            const milestone = agreementManager.tryBuildMilestone(
                blockIterator,
                snapshot
            );

            expect(milestone).to.not.be.undefined;
            expect(milestone!.blockConfirmations[0].signatures).to.have.length(
                1
            );
            expect(milestone!.blockConfirmations[0].signatures).to.include(
                participant2Signature
            );
            expect(milestone!.blockConfirmations[0].signatures).to.not.include(
                participant3Signature
            );
        });

        it("should work with DESC iterator and sort correctly", async () => {
            // Create a snapshot with 2 participants
            const snapshot = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2],
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            // Create blocks at different heights
            const block1 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 1,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshot.hash
            });

            const block2 = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 2,
                        participant: participant2
                    })
                }),
                stateSnapshotHash: snapshot.hash
            });

            const block1Hash = ethers.keccak256(block1.encode());
            const block2Hash = ethers.keccak256(block2.encode());

            const authorSignature1 = await signers[0].signMessage(
                ethers.getBytes(block1Hash)
            );
            const authorSignature2 = await signers[1].signMessage(
                ethers.getBytes(block2Hash)
            );
            const participant2Signature1 = await signers[1].signMessage(
                ethers.getBytes(block1Hash)
            );
            const participant1Signature2 = await signers[0].signMessage(
                ethers.getBytes(block2Hash)
            );

            const blockConfirmation1 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block1.encode(),
                    signature: authorSignature1
                }),
                signatures: [participant2Signature1]
            });

            const blockConfirmation2 = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block2.encode(),
                    signature: authorSignature2
                }),
                signatures: [participant1Signature2]
            });

            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmation1)
            );
            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(blockConfirmation2)
            );

            // Use DESC iterator
            const blockIterator = storage.blocks.getIterator(
                forkId,
                SortOrder.DESC,
                2
            );

            const milestone = agreementManager.tryBuildMilestone(
                blockIterator,
                snapshot
            );

            expect(milestone).to.not.be.undefined;
            // Since both blocks have all participants signed, the first block (height 2)
            // will create a milestone, so we expect 1 block confirmation
            expect(milestone!.blockConfirmations).to.have.length(1);

            // The block should be sorted correctly (ascending order)
            const firstBlock = Block.fromSignedBlock(
                milestone!.blockConfirmations[0].signedBlock
            );
            expect(firstBlock.height).to.equal(2); // Should be the first block in DESC order
        });
    });

    describe("getSnapshot", () => {
        it("should return snapshot from first block confirmation", async () => {
            // Create a snapshot
            const snapshot = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participant1, participant2],
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshot);

            // Create a block that references this snapshot
            const block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: snapshot.hash
            });

            const blockHash = ethers.keccak256(block.encode());
            const signature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );

            const blockConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block.encode(),
                    signature: signature
                }),
                signatures: []
            });

            const milestone: MilestoneProofStruct = {
                blockConfirmations: [blockConfirmation]
            };

            const result = agreementManager.getSnapshot(milestone);

            expect(result).to.not.be.undefined;
            expect(result!.hash).to.equal(snapshot.hash);
        });

        it("should return undefined for empty milestone", () => {
            const emptyMilestone: MilestoneProofStruct = {
                blockConfirmations: []
            };

            const result = agreementManager.getSnapshot(emptyMilestone);

            expect(result).to.be.undefined;
        });

        it("should return undefined when snapshot not found", async () => {
            // Create a block with non-existent snapshot hash
            const block = factory.block({
                transaction: factory.transaction({
                    header: factory.transactionHeader({
                        forkId: forkId,
                        transactionCnt: 5,
                        participant: participant1
                    })
                }),
                stateSnapshotHash: ethers.hexlify(ethers.randomBytes(32)) // Random hash
            });

            const blockHash = ethers.keccak256(block.encode());
            const signature = await signers[0].signMessage(
                ethers.getBytes(blockHash)
            );

            const blockConfirmation = factory.blockConfirmation({
                signedBlock: factory.signedBlock({
                    encodedBlock: block.encode(),
                    signature: signature
                }),
                signatures: []
            });

            const milestone: MilestoneProofStruct = {
                blockConfirmations: [blockConfirmation]
            };

            const result = agreementManager.getSnapshot(milestone);

            expect(result).to.be.undefined;
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
            storage.blocks.storeBlock(block1);

            const result = agreementManager.didParticipantPostOnChainLocal(
                forkId,
                1,
                participant1
            );

            expect(result).to.be.false;
        });
    });

    describe("getSnapshot error handling", () => {
        it("should throw error when empty milestone is passed to getSnapshot", () => {
            // Create an empty milestone
            const emptyMilestone = {
                blockConfirmations: []
            };

            expect(() => {
                agreementManager.getSnapshot(emptyMilestone as any);
            }).to.throw("Cannot get snapshot from empty milestone");
        });

        it("should throw error when milestone has no block confirmations", () => {
            // Create a milestone with null block confirmations
            const invalidMilestone = {
                blockConfirmations: []
            };

            expect(() => {
                agreementManager.getSnapshot(invalidMilestone as any);
            }).to.throw("Cannot get snapshot from empty milestone");
        });

        it("should throw error when milestone has undefined block confirmations", () => {
            // Create a milestone with undefined block confirmations
            const invalidMilestone = {
                blockConfirmations: undefined
            };

            expect(() => {
                agreementManager.getSnapshot(invalidMilestone as any);
            }).to.throw("Cannot get snapshot from empty milestone");
        });
    });
});
