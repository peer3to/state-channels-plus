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

    // Test helper functions
    const createSnapshot = (options: {
        participants: Address[];
        withdrawalAmount?: bigint;
    }): StateSnapshot => {
        const { participants, withdrawalAmount = BigInt(100) } = options;
        return factory.stateSnapshot({
            forkId: forkId,
            snapshotData: {
                participants,
                stateMachineStateHash: genesisStateMachineStateHash,
                latestJoinChannelBlockHash: factory.hash(),
                latestExitChannelBlockHash: factory.hash(),
                totalDeposits: { amount: BigInt(1000), data: "0x" },
                totalWithdrawals: { amount: withdrawalAmount, data: "0x" }
            }
        });
    };

    const createBlock = (options: {
        height: number;
        author: Address;
        snapshotHash?: Hash;
    }): Block => {
        const { height, author, snapshotHash } = options;
        return factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkId: forkId,
                    transactionCnt: height,
                    participant: author
                })
            }),
            stateSnapshotHash: snapshotHash || factory.hash()
        });
    };

    const signBlock = async (
        block: Block,
        options: {
            author: HardhatEthersSigner;
            additionalSigners?: HardhatEthersSigner[];
        }
    ): Promise<Block> => {
        const { author, additionalSigners = [] } = options;
        let signedBlock = await block.signAsAuthor(author);

        if (additionalSigners.length > 0) {
            const additionalSignatures = await Promise.all(
                additionalSigners.map((signer) => signedBlock.sign(signer))
            );
            signedBlock = signedBlock.expandSignatures(additionalSignatures);
        }

        return signedBlock;
    };

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
        describe("basic functionality", () => {
            it("should return StateProofStruct with milestones and signed blocks", async () => {
                storage.blocks.storeBlock(block1);
                storage.blocks.storeBlock(block2);

                const result = await agreementManager.getStateProof(forkId, 10);
                expect(result.milestones).to.be.an("array");
                expect(result.signedBlocks).to.be.an("array");
            });

            it("should throw error when fork not found", async () => {
                const nonExistentForkId = factory.hash();

                await expect(
                    agreementManager.getStateProof(nonExistentForkId, 10)
                ).to.be.rejectedWith("Fork not found");
            });
        });

        describe("when no exit points exis", () => {
            it("should fall back signedBlocks", async () => {
                const result = await agreementManager.getStateProof(forkId, 10);

                expect(result.milestones).to.have.length(0);
                expect(result.signedBlocks).to.be.an("array");
            });

            it("should collect all relevant block confirmations as evidence", async () => {
                // Create scenario that forces signedBlocks collection (no exit points)
                const differentSnapshot = createSnapshot({
                    participants: participants
                });
                storage.stateSnapshots.storeStateSnapshot(differentSnapshot);

                // Create blocks where only some participants sign (insufficient for milestones)
                const blocks = [
                    createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: differentSnapshot.hash
                    }),
                    createBlock({
                        height: 6,
                        author: participants[1],
                        snapshotHash: differentSnapshot.hash
                    }),
                    createBlock({
                        height: 7,
                        author: participants[0],
                        snapshotHash: differentSnapshot.hash
                    })
                ];

                const signedBlocks = await Promise.all([
                    signBlock(blocks[0], { author: signers[0] }), // Only author signs
                    signBlock(blocks[1], { author: signers[1] }), // Only author signs
                    signBlock(blocks[2], { author: signers[0] }) // Only author signs
                ]);

                signedBlocks.forEach((block) =>
                    storage.blocks.storeBlock(block)
                );

                const result = await agreementManager.getStateProof(forkId, 7);

                expect(result.milestones).to.have.length(0);
                expect(result.signedBlocks.length).to.equal(3);
                expect(
                    result.signedBlocks.map(
                        (sb) => Block.fromSignedBlock(sb).height
                    )
                ).to.deep.equal([5, 6, 7]);
            });
        });

        describe("when exit points exist", () => {
            describe("with sufficient consensus", () => {
                it("should create finality proofs when all participants signed", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const snapshot = createSnapshot({
                        participants: [participants[0], participants[1]]
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    const block = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: snapshot.hash
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    });
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones.length).to.equal(1);
                    expect(result.signedBlocks.length).to.equal(1);
                });

                it("should handle multiple exit points in correct order", async () => {
                    // Store exit points in reverse order to test sorting
                    storage.exitPoints.storeExitPoint(forkId, 100);
                    storage.exitPoints.storeExitPoint(forkId, 50);

                    const snapshot1 = createSnapshot({
                        participants: [participants[0]],
                        withdrawalAmount: BigInt(200)
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot1);
                    const block1 = createBlock({
                        height: 100,
                        author: participants[0],
                        snapshotHash: snapshot1.hash
                    });
                    const signedBlock1 = await signBlock(block1, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    });
                    storage.blocks.storeBlock(signedBlock1);

                    const snapshot2 = createSnapshot({
                        participants: [participants[0], participants[1]],
                        withdrawalAmount: BigInt(100)
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot2);
                    const block2 = createBlock({
                        height: 50,
                        author: participants[0],
                        snapshotHash: snapshot2.hash
                    });
                    const signedBlock2 = await signBlock(block2, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    });
                    storage.blocks.storeBlock(signedBlock2);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        150
                    );

                    expect(result.milestones.length).to.equal(2);
                    expect(result.signedBlocks.length).to.equal(1);
                });

                it("should include author signature when building milestone proofs", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const snapshot = createSnapshot({
                        participants: [participants[0], participants[1]],
                        withdrawalAmount: BigInt(100)
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    const block = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: snapshot.hash
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    }); // All participants sign
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones.length).to.be.greaterThan(0);
                    const milestone = result.milestones.find((m) =>
                        m.blockConfirmations.some(
                            (bc) =>
                                bc.signedBlock.encodedBlock ===
                                signedBlock.encode()
                        )
                    );
                    expect(milestone).to.not.be.undefined;
                    expect(milestone!.blockConfirmations).to.have.length(1);
                });

                it("should include all signatures when all participants are current", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const snapshot = createSnapshot({
                        participants: participants,
                        withdrawalAmount: BigInt(100)
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    const block = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: snapshot.hash
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    });
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones.length).to.be.greaterThan(0);
                    const milestone = result.milestones.find((m) =>
                        m.blockConfirmations.some(
                            (bc) =>
                                bc.signedBlock.encodedBlock ===
                                signedBlock.encode()
                        )
                    );
                    expect(milestone).to.not.be.undefined;
                    expect(milestone!.blockConfirmations).to.have.length(1);
                });

                it("should return empty signedBlocks when final milestone building succeeds", async () => {
                    const snapshot = createSnapshot({
                        participants: participants // Same participants as genesis
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);

                    const block = createBlock({
                        height: 10,
                        author: participants[0],
                        snapshotHash: snapshot.hash // Different from genesis
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]] // All 3 genesis participants sign
                    });
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones.length).to.be.greaterThan(0);
                    expect(result.signedBlocks).to.have.length(0);
                });
            });

            describe("with insufficient consensus", () => {
                it("should not create milestone proof when only author signed", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const snapshot = createSnapshot({
                        participants: [participants[0], participants[1]],
                        withdrawalAmount: BigInt(100)
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    const block = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: snapshot.hash
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0]
                    }); // Only author signs
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones).to.have.length(0);
                });
            });

            describe("participant filtering", () => {
                it("should exclude signatures from non-participants", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const snapshot = createSnapshot({
                        participants: [participants[0], participants[1]],
                        withdrawalAmount: BigInt(100)
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    const block = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: snapshot.hash
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    }); // All 3 sign, but only 2 are participants
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones.length).to.be.greaterThan(0);
                    const milestone = result.milestones.find((m) =>
                        m.blockConfirmations.some(
                            (bc) =>
                                bc.signedBlock.encodedBlock ===
                                signedBlock.encode()
                        )
                    );
                    expect(milestone).to.not.be.undefined;
                    expect(milestone!.blockConfirmations).to.have.length(1);
                });
            });

            describe("error handling and edge cases", () => {
                it("should handle case where exit point snapshot is not found", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones).to.have.length(0);
                    expect(result.signedBlocks).to.be.an("array");
                });

                it("should handle missing milestone snapshot gracefully", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    // Create block with snapshot but not exit point snapshot
                    const blockSnapshot = createSnapshot({
                        participants: participants
                    });
                    storage.stateSnapshots.storeStateSnapshot(blockSnapshot);

                    const block = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: blockSnapshot.hash
                    });
                    const signedBlock = await signBlock(block, {
                        author: signers[0],
                        additionalSigners: [signers[1], signers[2]]
                    });
                    storage.blocks.storeBlock(signedBlock);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        10
                    );

                    expect(result.milestones).to.have.length.greaterThan(0);
                });

                it("should continue building proofs when early checkpoint fails but later ones succeed", async () => {
                    storage.exitPoints.storeExitPoint(forkId, 5);

                    const snapshot = createSnapshot({
                        participants: participants
                    });
                    storage.stateSnapshots.storeStateSnapshot(snapshot);

                    // Block at height 5 with insufficient signatures
                    const insufficientBlock = createBlock({
                        height: 5,
                        author: participants[0],
                        snapshotHash: snapshot.hash
                    });
                    const insufficientSigned = await signBlock(
                        insufficientBlock,
                        {
                            author: signers[0]
                        }
                    ); // Only author
                    storage.blocks.storeBlock(insufficientSigned);

                    // Block at height 10 with all signatures
                    const sufficientBlock = createBlock({
                        height: 10,
                        author: participants[1],
                        snapshotHash: snapshot.hash
                    });
                    const sufficientSigned = await signBlock(sufficientBlock, {
                        author: signers[1],
                        additionalSigners: [signers[0], signers[2]]
                    }); // All participants
                    storage.blocks.storeBlock(sufficientSigned);

                    const result = await agreementManager.getStateProof(
                        forkId,
                        15
                    );

                    expect(result.milestones.length).to.be.greaterThan(0);
                });
            });
        });
    });

    describe("tryBuildMilestone", () => {
        it("should build milestone when all participants sign", async () => {
            const snapshot = createSnapshot({
                participants: [participants[0], participants[1]]
            });
            const block = createBlock({ height: 5, author: participants[0] });
            const signedBlock = await signBlock(block, {
                author: signers[0],
                additionalSigners: [signers[1]]
            });

            storage.blocks.storeBlock(signedBlock);

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
            ).to.equal(signedBlock.encode());
            expect(milestone!.blockConfirmations[0].signatures).to.have.length(
                2
            );
            expect(milestone!.blockConfirmations[0].signatures).to.include(
                signedBlock.findSignature(signers[1].address).signature
            );
        });

        it("should return undefined when not all participants sign", async () => {
            const snapshot = createSnapshot({ participants: participants });
            const block = createBlock({
                height: 5,
                author: participants[0],
                snapshotHash: snapshot.hash
            });
            const signedBlock = await signBlock(block, {
                author: signers[0],
                additionalSigners: [signers[1]]
            }); // Only 2 of 3 participants

            storage.blocks.storeBlock(signedBlock);

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
            const snapshot = createSnapshot({
                participants: [participants[0], participants[1]]
            }); // Only 2 participants
            const block = createBlock({ height: 5, author: participants[0] });
            const signedBlock = await signBlock(block, {
                author: signers[0],
                additionalSigners: [signers[1], signers[2]]
            }); // All 3 sign, but only 2 are participants

            storage.blocks.storeBlock(signedBlock);

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
                2
            );
            expect(milestone!.blockConfirmations[0].signatures).to.include(
                signedBlock.findSignature(signers[1].address).signature
            );
            expect(milestone!.blockConfirmations[0].signatures).to.not.include(
                signedBlock.findSignature(signers[2].address).signature
            );
        });

        it("should process blocks correctly regardless of iteration order", async () => {
            const snapshot = createSnapshot({
                participants: [participants[0], participants[1]]
            });

            // Create blocks at different heights
            const block1 = createBlock({ height: 1, author: participants[0] });
            const block2 = createBlock({ height: 2, author: participants[1] });

            const signedBlocks = await Promise.all([
                signBlock(block1, {
                    author: signers[0],
                    additionalSigners: [signers[1]]
                }),
                signBlock(block2, {
                    author: signers[1],
                    additionalSigners: [signers[0]]
                })
            ]);

            signedBlocks.forEach((block) => storage.blocks.storeBlock(block));

            // Use DESC iterator starting from height 2
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
            expect(milestone!.blockConfirmations).to.have.length(1);

            // Should process the first block in DESC order (height 2)
            const firstBlock = Block.fromSignedBlock(
                milestone!.blockConfirmations[0].signedBlock
            );
            expect(firstBlock.height).to.equal(2);
        });
    });

    describe("getSnapshot", () => {
        it("should return snapshot from first block confirmation", async () => {
            // Create a snapshot
            const snapshot = factory.stateSnapshot({
                forkId: forkId,
                snapshotData: {
                    participants: [participants[0], participants[1]],
                    stateMachineStateHash: genesisStateMachineStateHash,
                    latestJoinChannelBlockHash: factory.hash(),
                    latestExitChannelBlockHash: factory.hash(),
                    totalDeposits: { amount: BigInt(1000), data: "0x" },
                    totalWithdrawals: { amount: BigInt(100), data: "0x" }
                }
            });

            storage.stateSnapshots.storeStateSnapshot(snapshot);

            // Create a block that references this snapshot
            const block = await factory
                .block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            forkId: forkId,
                            transactionCnt: 5,
                            participant: participants[0]
                        })
                    }),
                    stateSnapshotHash: snapshot.hash
                })
                .signAsAuthor(signers[0]);

            const milestone: MilestoneProofStruct = {
                blockConfirmations: [block.blockConfirmationStruct]
            };

            const result = agreementManager.getSnapshot(milestone);

            expect(result).to.not.be.undefined;
            expect(result!.hash).to.equal(snapshot.hash);
        });

        it("should throw error when empty milestone is passed", () => {
            const emptyMilestone: MilestoneProofStruct = {
                blockConfirmations: []
            };

            expect(() => {
                agreementManager.getSnapshot(emptyMilestone);
            }).to.throw("Cannot get snapshot from empty milestone");
        });

        it("should throw error when snapshot not found", async () => {
            // Create a block with non-existent snapshot hash
            const block = await factory
                .block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            forkId: forkId,
                            transactionCnt: 5,
                            participant: participants[0]
                        })
                    }),
                    stateSnapshotHash: factory.hash()
                })
                .signAsAuthor(signers[0]);

            const milestone: MilestoneProofStruct = {
                blockConfirmations: [block.blockConfirmationStruct]
            };

            expect(() => {
                agreementManager.getSnapshot(milestone);
            }).to.throw("Milestone built but corresponding snapshot not found");
        });
    });

    describe("didParticipantPostOnChainLocal", () => {
        it("should return false when block does not exist", () => {
            const result = agreementManager.didParticipantPostOnChainLocal(
                forkId,
                999,
                participants[0]
            );

            expect(result).to.be.false;
        });

        it("should return false when block has no on-chain timestamp", () => {
            storage.blocks.storeBlock(block1);

            const result = agreementManager.didParticipantPostOnChainLocal(
                forkId,
                1,
                participants[0]
            );

            expect(result).to.be.false;
        });
    });
});
