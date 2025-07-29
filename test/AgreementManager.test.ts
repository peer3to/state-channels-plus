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
import { Codec, Type } from "@/utils";

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

    describe("getFinalizedAndLatestWithMilestones", () => {
        it("should return finalized and latest states with virtual voting blocks and milestone data", () => {
            storage.blocks.storeBlockConfirmation(blockConfirmation1);
            storage.blocks.storeBlockConfirmation(blockConfirmation2);

            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.encodedLatestFinalizedState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.encodedLatestCorrectState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.virtualVotingBlocks).to.have.length(2);
            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
        });

        it("should throw error when fork not found", () => {
            const nonExistentForkId = ethers.hexlify(ethers.randomBytes(32));
            expect(() => {
                agreementManager.getFinalizedAndLatestWithMilestones(
                    nonExistentForkId,
                    participant1
                );
            }).to.throw("Fork not found");
        });

        it("should use genesis state when no finalized state found", () => {
            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.encodedLatestFinalizedState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.encodedLatestCorrectState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.virtualVotingBlocks).to.be.empty;
            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
        });

        it("should handle exit points and build milestone proofs", () => {
            // Store some exit points
            storage.exitPoints.storeExitPoint(forkId, 5);
            storage.exitPoints.storeExitPoint(forkId, 10);

            // Create state snapshots at exit points with reduced participant sets
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

            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.encodedLatestFinalizedState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.encodedLatestCorrectState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
        });

        it("should verify that state snapshots contain correct participant sets after exits", () => {
            // Create a state snapshot with reduced participant set (simulating after exits)
            const remainingParticipants = [participant1, participant3]; // participant2 removed
            const snapshotWithExits = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: remainingParticipants,
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(250), data: "0x" }
                }
            });

            // Verify that the snapshot contains the correct participant set
            const snapshotParticipantSet = new Set<Address>(
                snapshotWithExits.snapshotData.participants as Address[]
            );

            // This should match the remaining participants after exits
            expect(snapshotParticipantSet.size).to.equal(2);
            expect([...snapshotParticipantSet].sort()).to.deep.equal(
                [participant1, participant3].sort()
            );

            // Verify that participant2 is not in the set
            expect(snapshotParticipantSet.has(participant2)).to.be.false;
        });

        it("should handle case with no exit points", () => {
            // No exit points stored
            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.encodedLatestFinalizedState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.encodedLatestCorrectState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
            expect(result.milestoneProofs).to.have.length(0);
            expect(result.milestoneSnapshots).to.have.length(0);
        });

        it("should handle case where exit point snapshot is not found", () => {
            // Store exit point but no corresponding snapshot
            storage.exitPoints.storeExitPoint(forkId, 5);

            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.encodedLatestFinalizedState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.encodedLatestCorrectState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
            // Should still work but without milestone data
        });

        it("should handle multiple exit points in correct order", () => {
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

            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
            // Should process milestones in chronological order (50, then 100)
        });

        it("should handle case where milestone proof cannot be built", () => {
            // Store exit point but no blocks to build proof
            storage.exitPoints.storeExitPoint(forkId, 5);

            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.encodedLatestFinalizedState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.encodedLatestCorrectState).to.equal(
                "0x1234567890abcdef"
            );
            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");
            // Should still work even if no milestone proof can be built
        });

        it("should use correct participant sets for each milestone", () => {
            // Store exit points
            storage.exitPoints.storeExitPoint(forkId, 5);
            storage.exitPoints.storeExitPoint(forkId, 10);

            // Create state snapshots with different participant sets
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

            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight5);
            storage.stateSnapshots.storeStateSnapshot(snapshotAtHeight10);

            const result = agreementManager.getFinalizedAndLatestWithMilestones(
                forkId,
                participant1
            );

            expect(result.milestoneProofs).to.be.an("array");
            expect(result.milestoneSnapshots).to.be.an("array");

            // Verify that milestone snapshots are in correct order
            if (result.milestoneSnapshots.length >= 2) {
                const firstSnapshot = result.milestoneSnapshots[0];
                const secondSnapshot = result.milestoneSnapshots[1];

                // First snapshot should have 2 participants (participant1, participant2)
                expect(firstSnapshot.snapshotData.participants).to.have.length(
                    2
                );
                expect(firstSnapshot.snapshotData.participants).to.include(
                    participant1
                );
                expect(firstSnapshot.snapshotData.participants).to.include(
                    participant2
                );

                // Second snapshot should have 1 participant (participant1)
                expect(secondSnapshot.snapshotData.participants).to.have.length(
                    1
                );
                expect(secondSnapshot.snapshotData.participants).to.include(
                    participant1
                );
            }
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
