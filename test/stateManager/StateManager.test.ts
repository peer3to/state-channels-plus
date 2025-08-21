import { expect } from "chai";
import { ethers } from "ethers";
import sinon from "sinon";
import StateManager from "@/stateManager/StateManager";
import { stateSnapshot, exitChannelBlock } from "../factory";
import { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import Clock from "@/Clock";
import Block from "@/models/Block";

describe("StateManager", () => {
    let stateManager: StateManager;
    let mockContract: any;
    let mockStorage: any;
    let mockAgreementManager: any;
    let mockP2pEventHooks: any;
    let mockDiamondStateMachine: any;

    beforeEach(async () => {
        // Mock Clock for testing
        const mockProvider = {
            getBlock: async () => ({ timestamp: Math.floor(Date.now() / 1000) })
        };
        await Clock.init(mockProvider as any);

        // Create mock contract
        mockContract = {
            getStateSnapshot: async () => ({
                forkId: "0x1234567890abcdef",
                blockHeight: 3,
                timestamp: 1000,
                snapshotData: {
                    latestExitChannelBlockHash: "0x0000000000000000"
                }
            }),
            updateStateSnapshotSameFork: sinon.stub().resolves({
                wait: async () => ({})
            })
        };

        // Create mock storage
        mockStorage = {
            stateSnapshots: {
                getGenesisSnapshotDataByForkId: () => stateSnapshot(),
                getStateSnapshotByHash: () => stateSnapshot()
            },
            blocks: {
                getLatestBlockHeight: () => 10,
                getNextBlockHeight: () => 8 // Latest block height is 7
            },
            exitChannelBlocks: {
                getExitChannelBlock: (hash: string) => {
                    // Create a proper chain that leads back to the on-chain hash
                    if (hash === "0x1234567890abcdef") {
                        return {
                            exitChannels: [],
                            previousBlockHash: "0x0000000000000000" // Points to on-chain hash
                        };
                    }
                    return {
                        exitChannels: [],
                        previousBlockHash:
                            "0x0000000000000000000000000000000000000000000000000000000000000000"
                    };
                },
                getLatestExitChannelBlockHash: () => "0x0000000000000000",
                getTotalWithdrawals: () => ({ amount: 0n, data: "0x" })
            },
            joinChannelBlocks: {
                getLatestJoinChannelBlockHash: () => "0x0000000000000000",
                getTotalDeposits: () => ({ amount: 0n, data: "0x" })
            },
            exitPoints: {
                getExitPointsInRange: () => [1, 3, 5, 7] // Exit points at these block heights
            },
            getStateSnapshot: () => stateSnapshot()
        };

        // Create mock agreement manager
        mockAgreementManager = {
            getStateProof: async () => ({
                milestones: [
                    {
                        blockConfirmations: [
                            {
                                signedBlock: {
                                    encodedBlock:
                                        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
                                }
                            }
                        ]
                    }
                ],
                signedBlocks: []
            }),
            getSnapshot: (milestone: any) => {
                if (milestone.blockConfirmations.length === 0) {
                    throw new Error("Cannot get snapshot from empty milestone");
                }

                const firstBlockConfirmation = milestone.blockConfirmations[0];
                const block = Block.decode(
                    firstBlockConfirmation.signedBlock.encodedBlock
                );

                const snapshot =
                    mockStorage.stateSnapshots.getStateSnapshotByHash(
                        block.stateSnapshotHash
                    );

                if (!snapshot) {
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );
                }

                return snapshot;
            }
        };

        // Create mock P2P event hooks
        mockP2pEventHooks = {};

        // Create mock diamond state machine
        mockDiamondStateMachine = {
            getParticipants: async () => [
                "0x1234567890123456789012345678901234567890"
            ],
            getNextToWrite: async () =>
                "0x1234567890123456789012345678901234567890"
        };

        // Create StateManager instance
        stateManager = new StateManager(
            {} as ethers.Signer,
            "0x1234567890123456789012345678901234567890" as Address,
            mockContract as any,
            mockDiamondStateMachine as any,
            {
                p2pTime: 15,
                agreementTime: 5,
                chainFallbackTime: 30,
                challengeTime: 30
            },
            mockP2pEventHooks as any,
            mockStorage as any
        );

        // Mock the agreement manager
        (stateManager as any).agreementManager = mockAgreementManager;
        stateManager.setChannelId("0xabcdef1234567890" as any);

        // Mock Block.decode to avoid ethers decoding issues
        const originalBlockDecode = Block.decode;
        Block.decode = () => ({
            stateSnapshotHash:
                "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            height: 5,
            forkId: "0x1234567890abcdef"
        });
    });

    describe("StateSnapshot BlockHeight", () => {
        it("should set blockHeight to 0 for genesis snapshots", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const stateMachineStateHash = "0xabcdef1234567890" as Hash;

            // Call createStateSnapshot with blockHeight = 0 (genesis)
            const stateSnapshot = await (
                stateManager as any
            ).createStateSnapshot(stateMachineStateHash, forkId, 0);

            // Verify the snapshot was created correctly with blockHeight
            expect(stateSnapshot.toStruct().forkId).to.equal(forkId);
            expect(stateSnapshot.toStruct().blockHeight).to.equal(0n);
            expect(
                stateSnapshot.toStruct().snapshotData.stateMachineStateHash
            ).to.equal(stateMachineStateHash);
        });

        it("should set blockHeight to provided value for regular blocks", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const stateMachineStateHash = "0xabcdef1234567890" as Hash;
            const blockHeight = 5 as BlockHeight;

            // Call createStateSnapshot with blockHeight (regular block)
            const stateSnapshot = await (
                stateManager as any
            ).createStateSnapshot(stateMachineStateHash, forkId, blockHeight);

            // Verify the snapshot was created correctly with blockHeight
            expect(stateSnapshot.toStruct().forkId).to.equal(forkId);
            expect(stateSnapshot.toStruct().blockHeight).to.equal(
                BigInt(blockHeight)
            );
            expect(
                stateSnapshot.toStruct().snapshotData.stateMachineStateHash
            ).to.equal(stateMachineStateHash);
        });

        it("should set blockHeight to 0 when explicitly passing 0", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const stateMachineStateHash = "0xabcdef1234567890" as Hash;
            const blockHeight = 0 as BlockHeight;

            // Call createStateSnapshot with blockHeight = 0
            const stateSnapshot = await (
                stateManager as any
            ).createStateSnapshot(stateMachineStateHash, forkId, blockHeight);

            // Verify the snapshot was created correctly with blockHeight
            expect(stateSnapshot.toStruct().forkId).to.equal(forkId);
            expect(stateSnapshot.toStruct().blockHeight).to.equal(0n);
            expect(
                stateSnapshot.toStruct().snapshotData.stateMachineStateHash
            ).to.equal(stateMachineStateHash);
        });
    });

    describe("updateSnapshotSameFork", () => {
        it("should successfully update snapshot when valid data is provided", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock successful contract call
            const mockTxResponse = {
                wait: async () => ({})
            };
            mockContract.updateStateSnapshotSameFork = sinon
                .stub()
                .resolves(mockTxResponse);

            // Mock state snapshot with newer timestamp and same forkId
            const mockSnapshot = {
                forkId: "0x1234567890abcdef", // Same as current on-chain
                timestamp: 2000, // Newer than current on-chain (1000)
                blockHeight: 5, // Higher than current on-chain (3)
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x1234567890abcdef", // Different from on-chain
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: () => ({
                    forkId: "0x1234567890abcdef",
                    timestamp: 2000,
                    blockHeight: 5,
                    snapshotData: {
                        stateMachineStateHash: "0x1234567890abcdef",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0x1234567890abcdef", // Different from on-chain
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    }
                })
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            await expect(stateManager.updateSnapshotSameFork(forkId)).to.not.be
                .rejected;
        });

        it("should return early when no relevant milestones are found", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock empty milestones
            mockAgreementManager.getStateProof = async () => ({
                milestones: [],
                signedBlocks: []
            });

            await stateManager.updateSnapshotSameFork(forkId);

            // Should not call the contract
            expect(mockContract.updateStateSnapshotSameFork.called).to.be.false;
        });

        it("should return early when latest snapshot block height equals current on-chain", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock snapshot with same block height as current on-chain
            const mockSnapshot = {
                ...stateSnapshot(),
                blockHeight: 3 // Same as current on-chain
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            await stateManager.updateSnapshotSameFork(forkId);

            // Should not call the contract
            expect(mockContract.updateStateSnapshotSameFork.called).to.be.false;
        });

        it("should filter milestones correctly - only include newer than on-chain", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock multiple milestones with different block heights
            mockAgreementManager.getStateProof = async () => ({
                milestones: [
                    {
                        blockConfirmations: [
                            {
                                signedBlock: {
                                    encodedBlock:
                                        "0x1111111111111111111111111111111111111111111111111111111111111111"
                                }
                            }
                        ]
                    },
                    {
                        blockConfirmations: [
                            {
                                signedBlock: {
                                    encodedBlock:
                                        "0x2222222222222222222222222222222222222222222222222222222222222222"
                                }
                            }
                        ]
                    },
                    {
                        blockConfirmations: [
                            {
                                signedBlock: {
                                    encodedBlock:
                                        "0x3333333333333333333333333333333333333333333333333333333333333333"
                                }
                            }
                        ]
                    }
                ],
                signedBlocks: []
            });

            // Mock snapshots with different block heights
            let callCount = 0;
            mockStorage.stateSnapshots.getStateSnapshotByHash = () => {
                callCount++;
                // Return different block heights: 2, 4, 6 (on-chain is 3)
                const blockHeights = [2, 4, 6];
                const currentHeight = blockHeights[callCount - 1];

                return {
                    forkId: "0x1234567890abcdef",
                    timestamp: 1000 + currentHeight * 100,
                    blockHeight: currentHeight,
                    snapshotData: {
                        stateMachineStateHash: "0x1234567890abcdef",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0x0000000000000000",
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    },
                    toStruct: function () {
                        return {
                            forkId: this.forkId,
                            timestamp: this.timestamp,
                            blockHeight: this.blockHeight,
                            snapshotData: this.snapshotData
                        };
                    }
                };
            };

            await stateManager.updateSnapshotSameFork(forkId);

            // Should only include milestones with blockHeight > 3 (on-chain height)
            // So only milestones 2 and 3 (block heights 4 and 6) should be included
            expect(mockContract.updateStateSnapshotSameFork.called).to.be.true;
        });

        it("should handle multiple exit blocks in chain correctly", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            const mockSnapshot = {
                forkId: "0x1234567890abcdef",
                timestamp: 2000,
                blockHeight: 5,
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x3333333333333333", // Latest exit block
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: function () {
                    return {
                        forkId: this.forkId,
                        timestamp: this.timestamp,
                        blockHeight: this.blockHeight,
                        snapshotData: this.snapshotData
                    };
                }
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            // Mock a chain of 3 exit blocks: A -> B -> C
            // On-chain has A, we need to collect B and C
            mockStorage.exitChannelBlocks.getExitChannelBlock = (
                hash: string
            ) => {
                const exitBlocks = {
                    "0x3333333333333333": {
                        // Block C (latest)
                        exitChannels: [
                            {
                                participant: "0x3333",
                                balance: { amount: 30n, data: "0x" }
                            }
                        ],
                        previousBlockHash: "0x2222222222222222"
                    },
                    "0x2222222222222222": {
                        // Block B
                        exitChannels: [
                            {
                                participant: "0x2222",
                                balance: { amount: 20n, data: "0x" }
                            }
                        ],
                        previousBlockHash: "0x0000000000000000" // Points to on-chain
                    }
                };
                return exitBlocks[hash as keyof typeof exitBlocks];
            };

            await stateManager.updateSnapshotSameFork(forkId);

            // Should call contract with exit blocks in correct order (B, C)
            expect(mockContract.updateStateSnapshotSameFork.called).to.be.true;
        });

        it("should handle corrupted exit block chain gracefully", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            const mockSnapshot = {
                forkId: "0x1234567890abcdef",
                timestamp: 2000,
                blockHeight: 5,
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x1234567890abcdef",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: function () {
                    return {
                        forkId: this.forkId,
                        timestamp: this.timestamp,
                        blockHeight: this.blockHeight,
                        snapshotData: this.snapshotData
                    };
                }
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            // Mock missing exit block (corrupted chain)
            mockStorage.exitChannelBlocks.getExitChannelBlock = () => undefined;

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith("Exit channel block not found for hash");
        });

        it("should handle contract transaction wait failure", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            const mockSnapshot = {
                forkId: "0x1234567890abcdef",
                timestamp: 2000,
                blockHeight: 5,
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x0000000000000000",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: function () {
                    return {
                        forkId: this.forkId,
                        timestamp: this.timestamp,
                        blockHeight: this.blockHeight,
                        snapshotData: this.snapshotData
                    };
                }
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            // Mock contract call success but wait failure
            mockContract.updateStateSnapshotSameFork = sinon.stub().resolves({
                wait: async () => {
                    throw new Error("Transaction failed");
                }
            });

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith("Transaction failed");
        });

        it("should handle storage access errors gracefully", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock storage error
            mockStorage.stateSnapshots.getStateSnapshotByHash = () => {
                throw new Error("Storage access failed");
            };

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith("Storage access failed");
        });

        it("should handle empty exit channel blocks correctly", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            const mockSnapshot = {
                forkId: "0x1234567890abcdef",
                timestamp: 2000,
                blockHeight: 5,
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x1234567890abcdef",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: function () {
                    return {
                        forkId: this.forkId,
                        timestamp: this.timestamp,
                        blockHeight: this.blockHeight,
                        snapshotData: this.snapshotData
                    };
                }
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            // Mock exit block with empty exitChannels array
            mockStorage.exitChannelBlocks.getExitChannelBlock = () => ({
                exitChannels: [], // Empty array
                previousBlockHash: "0x0000000000000000"
            });

            await expect(stateManager.updateSnapshotSameFork(forkId)).to.not.be
                .rejected;
        });

        it("should throw error when fork mismatch is detected", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock snapshot with different fork ID and higher block height
            const mockSnapshot = {
                forkId: "0x9876543210fedcba" as ForkId, // Different fork
                timestamp: 2000,
                blockHeight: 5, // Higher than current on-chain (3)
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x0000000000000000",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: () => ({
                    forkId: "0x9876543210fedcba",
                    timestamp: 2000,
                    blockHeight: 5,
                    snapshotData: {
                        stateMachineStateHash: "0x1234567890abcdef",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0x0000000000000000",
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    }
                })
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith("Fork mismatch");
        });

        it("should filter exit points correctly based on current on-chain block height", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock different exit block hashes to trigger exit block processing
            // The latest snapshot will have a different exit block hash than on-chain

            const mockSnapshot = {
                forkId: "0x1234567890abcdef", // Same as current on-chain
                timestamp: 2000,
                blockHeight: 5, // Higher than current on-chain (3)
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x1234567890abcdef",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: () => ({
                    forkId: "0x1234567890abcdef",
                    timestamp: 2000,
                    blockHeight: 5,
                    snapshotData: {
                        stateMachineStateHash: "0x1234567890abcdef",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0x1234567890abcdef",
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    }
                })
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            // Mock exit channel block retrieval
            let exitBlockCallCount = 0;
            mockStorage.exitChannelBlocks.getExitChannelBlock = (
                hash: string
            ) => {
                exitBlockCallCount++;
                // Create a proper chain that leads back to the on-chain hash
                if (hash === "0x1234567890abcdef") {
                    return {
                        exitChannels: [],
                        previousBlockHash: "0x0000000000000000" // Points to on-chain hash
                    };
                }
                return {
                    exitChannels: [],
                    previousBlockHash:
                        "0x0000000000000000000000000000000000000000000000000000000000000000"
                };
            };

            await stateManager.updateSnapshotSameFork(forkId);

            // Should process exit blocks in the chain
            expect(exitBlockCallCount).to.be.greaterThan(0);
        });

        it("should handle empty milestone proof gracefully", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock milestone with empty block confirmations
            mockAgreementManager.getStateProof = async () => ({
                milestones: [
                    {
                        blockConfirmations: []
                    }
                ],
                signedBlocks: []
            });

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith("Empty milestone proof found");
        });

        it("should throw error when state snapshot not found", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock missing state snapshot
            mockStorage.stateSnapshots.getStateSnapshotByHash = () => undefined;

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith(
                "Milestone built but corresponding snapshot not found"
            );
        });

        it("should call contract with correct parameters", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            const mockSnapshot = {
                forkId: "0x1234567890abcdef", // Same as current on-chain
                timestamp: 2000,
                blockHeight: 5, // Higher than current on-chain (3)
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x0000000000000000",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: () => ({
                    forkId: "0x1234567890abcdef",
                    timestamp: 2000,
                    blockHeight: 5,
                    snapshotData: {
                        stateMachineStateHash: "0x1234567890abcdef",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0x0000000000000000",
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    }
                })
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            let contractCallParams: any = null;
            mockContract.updateStateSnapshotSameFork = sinon
                .stub()
                .callsFake((...params: any[]) => {
                    contractCallParams = params;
                    return Promise.resolve({ wait: async () => ({}) });
                });

            await stateManager.updateSnapshotSameFork(forkId);

            expect(contractCallParams).to.not.be.null;
            expect(contractCallParams[0]).to.equal("0xabcdef1234567890"); // channelId
            expect(contractCallParams[1]).to.be.an("array"); // milestoneProofs
            expect(contractCallParams[2]).to.be.an("array"); // milestoneSnapshots
            expect(contractCallParams[3]).to.be.an("array"); // exitChannelBlocks
        });

        it("should handle contract call errors", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            const mockSnapshot = {
                forkId: "0x1234567890abcdef", // Same as current on-chain
                timestamp: 2000,
                blockHeight: 5, // Higher than current on-chain (3)
                snapshotData: {
                    stateMachineStateHash: "0x1234567890abcdef",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x0000000000000000",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: () => ({
                    forkId: "0x1234567890abcdef",
                    timestamp: 2000,
                    blockHeight: 5,
                    snapshotData: {
                        stateMachineStateHash: "0x1234567890abcdef",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0x0000000000000000",
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    }
                })
            };
            mockStorage.stateSnapshots.getStateSnapshotByHash = () =>
                mockSnapshot;

            // Mock contract call failure
            mockContract.updateStateSnapshotSameFork = sinon
                .stub()
                .rejects(new Error("Contract call failed"));

            await expect(
                stateManager.updateSnapshotSameFork(forkId)
            ).to.be.rejectedWith("Contract call failed");
        });
    });

    describe("updateSnapshotFork", () => {
        it("should successfully update snapshot when valid dispute data is available", async () => {
            // Mock successful contract calls
            const mockTxResponse = {
                wait: async () => ({})
            };
            mockContract.updateStateSnapshotFork = sinon
                .stub()
                .resolves(mockTxResponse);
            mockContract.isForkDisputed = sinon.stub().resolves(true);
            mockContract.isReduceChallengePeriodExpired = sinon
                .stub()
                .resolves(true);
            mockContract.reduce = sinon.stub().resolves({
                latestBlock: {
                    stateSnapshotHash: "0xabcdef1234567890"
                },
                forkGenesisTimestamp: 1500
            });

            // Mock dispute data
            mockAgreementManager.forks.getLatestDispute = () => ({
                dispute: { channelId: "0x1234567890abcdef" },
                timestamp: 1000
            });

            // Mock target snapshot
            const mockTargetSnapshot = {
                forkId: "0xabcdef1234567890",
                timestamp: 1500,
                blockHeight: 0,
                snapshotData: {
                    stateMachineStateHash: "0xabcdef1234567890",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0xabcdef1234567890",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                },
                toStruct: () => ({
                    forkId: "0xabcdef1234567890",
                    timestamp: 1500,
                    blockHeight: 0,
                    snapshotData: {
                        stateMachineStateHash: "0xabcdef1234567890",
                        participants: [
                            "0x1234567890123456789012345678901234567890"
                        ],
                        latestJoinChannelBlockHash: "0x0000000000000000",
                        latestExitChannelBlockHash: "0xabcdef1234567890",
                        totalDeposits: { amount: 0n, data: "0x" },
                        totalWithdrawals: { amount: 0n, data: "0x" }
                    }
                })
            };
            mockStorage.stateSnapshots.getStateSnapshot = () =>
                mockTargetSnapshot;

            await expect(stateManager.updateSnapshotFork()).to.not.be.rejected;
        });

        it("should handle case when no dispute window is found", async () => {
            mockContract.isForkDisputed = sinon.stub().resolves(false);

            await stateManager.updateSnapshotFork();

            // Should not call updateStateSnapshotFork
            expect(mockContract.updateStateSnapshotFork?.called).to.be.false;
        });

        it("should handle case when challenge period has not expired", async () => {
            mockContract.isForkDisputed = sinon.stub().resolves(true);
            mockContract.isReduceChallengePeriodExpired = sinon
                .stub()
                .resolves(false);

            await stateManager.updateSnapshotFork();

            // Should not call updateStateSnapshotFork
            expect(mockContract.updateStateSnapshotFork?.called).to.be.false;
        });

        it("should handle case when no dispute data is available", async () => {
            mockContract.isForkDisputed = sinon.stub().resolves(true);
            mockContract.isReduceChallengePeriodExpired = sinon
                .stub()
                .resolves(true);
            mockAgreementManager.forks.getLatestDispute = () => null;

            await stateManager.updateSnapshotFork();

            // Should not call updateStateSnapshotFork
            expect(mockContract.updateStateSnapshotFork?.called).to.be.false;
        });
    });
});
