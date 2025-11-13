import { expect } from "chai";
import sinon from "sinon";
import {
    hexString,
    joinChannelBlock,
    snapshotData,
    milestoneProof,
    snapshotWithExitChannelBlock,
    exitChannelBlockChain,
    stateSnapshot
} from "../factory";
import { StateManagerTestBuilder, defaults } from "./StateManagerTestBuilder";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ForkId, Timestamp, Address, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";
import StateManager from "@/stateManager";

const exitChannelBlock = {
    exitChannels: [],
    previousBlockHash: defaults.emptyBlockHash // Points to on-chain hash
};

function createDefaultBuilder() {
    return new StateManagerTestBuilder()
        .withChannel(defaults.channelId)
        .withFork(defaults.forkId);
}

describe("StateManager - Refactored", () => {
    let stateManager: StateManager;
    afterEach(async () => {
        sinon.restore();
        await stateManager.dispose();
    });

    describe("prepareUpdateSnapshotSameFork", () => {
        // Arrange: Setup StateManager with default channel and fork, no milestones configured
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Returns undefined because no milestones exist for the fork
        it("should return undefined when no milestones exist for the fork", async () => {
            // Arrange
            stateManager = createDefaultBuilder().build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert
            expect(result).to.be.undefined;
        });

        // Arrange: Setup milestone snapshot with block height matching on-chain block height
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Returns undefined because milestone snapshot is not ahead of on-chain state
        it("should return undefined when milestone snapshot block height equals on-chain block height", async () => {
            // Arrange
            const mockSnapshot = stateSnapshot({
                forkId: defaults.forkId,
                blockHeight: Number(defaults.onChainBlockHeight),
                snapshotData: snapshotData({
                    originForkId: defaults.forkId
                })
            });

            const builder = createDefaultBuilder();
            builder
                .getAgreementManager()
                .withProof(milestoneProof(defaults.forkId))
                .withMilestoneSnapshot(mockSnapshot);

            stateManager = builder.build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert - Should be undefined because milestone blockHeight == on-chain blockHeight
            expect(result).to.be.undefined;
        });

        // Arrange: Setup milestone snapshot with block height ahead of on-chain, configure exit channel block
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Returns update data with milestone proofs, snapshots, and exit channel blocks
        it("should prepare update data with milestone proofs and exit channel blocks when milestone snapshot is ahead of on-chain", async () => {
            // Arrange
            const exitBlockHash = hexString(32) as Hash;
            const mockSnapshot = snapshotWithExitChannelBlock(
                defaults.forkId,
                Number(defaults.milestoneBlockHeight),
                exitBlockHash
            );

            const builder = createDefaultBuilder()
                .withDummyBlock() // So getNextBlockHeight returns 1, making latestBlockHeight = 0
                .withExitChannelBlock(exitBlockHash, exitChannelBlock);

            builder
                .getAgreementManager()
                .withProof(milestoneProof(defaults.forkId))
                .withMilestoneSnapshot(mockSnapshot);

            stateManager = builder.build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert - Should return update data because milestone blockHeight > on-chain blockHeight
            expect(result).to.not.be.undefined;
            expect(result!.milestoneProofs).to.have.length(1);
            expect(result!.milestoneSnapshots).to.have.length(1);
            expect(result!.exitChannelBlocks).to.be.an("array");
            expect(result!.exitChannelBlocks[0]).to.deep.equal(
                exitChannelBlock
            );
        });

        // Arrange: Setup milestone snapshot with different fork ID than current fork
        // Act: Attempt to prepare update snapshot for the current fork
        // Assert: Throws error indicating fork mismatch between current fork and snapshot fork
        it("should throw error when milestone snapshot fork ID does not match current fork", async () => {
            // Arrange
            const mockSnapshot = stateSnapshot({
                forkId: defaults.differentForkId,
                blockHeight: Number(defaults.milestoneBlockHeight),
                snapshotData: snapshotData({
                    originForkId: defaults.forkId
                })
            });

            const builder = createDefaultBuilder().withDummyBlock();
            builder
                .getAgreementManager()
                .withProof(milestoneProof(defaults.forkId))
                .withMilestoneSnapshot(mockSnapshot);

            stateManager = builder.build();

            // Act & Assert
            await expect(
                stateManager.prepareUpdateSnapshotSameFork(defaults.forkId)
            ).to.be.rejectedWith("Fork mismatch: current fork");
        });

        // Arrange: Setup milestone proof with empty block confirmations array
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Throws error indicating empty milestone proof was found
        it("should throw error when milestone proof contains no block confirmations", async () => {
            // Arrange
            const builder = createDefaultBuilder().withDummyBlock();
            builder.getAgreementManager().withProof({
                forkId: defaults.forkId,
                height: 0,
                proof: {
                    milestones: [
                        {
                            blockConfirmations: [] // Empty milestone
                        }
                    ],
                    signedBlocks: []
                }
            });

            stateManager = builder.build();

            // Act & Assert
            await expect(
                stateManager.prepareUpdateSnapshotSameFork(defaults.forkId)
            ).to.be.rejectedWith("Empty milestone proof found");
        });

        // Arrange: Setup milestone proof but no corresponding snapshot
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Throws error indicating milestone was built but corresponding snapshot not found
        it("should throw error when milestone proof exists but corresponding snapshot is missing", async () => {
            // Arrange
            const builder = createDefaultBuilder().withDummyBlock();
            builder
                .getAgreementManager()
                .withProof(milestoneProof(defaults.forkId))
                .withMilestoneSnapshot(undefined); // Snapshot not found

            stateManager = builder.build();

            // Act & Assert
            await expect(
                stateManager.prepareUpdateSnapshotSameFork(defaults.forkId)
            ).to.be.rejectedWith(
                "Milestone built but corresponding snapshot not found"
            );
        });

        // Arrange: Setup milestone snapshot pointing to exit channel block chain with multiple blocks
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Returns update data with all exit channel blocks from the chain (excluding genesis)
        it("should collect all exit channel blocks from chain when milestone snapshot references exit channel block chain", async () => {
            // Arrange - Set up exit channel block chain: latest -> middle -> genesis
            const chain = exitChannelBlockChain(2);
            const latestHash = chain[chain.length - 1].hash;

            const mockSnapshot = snapshotWithExitChannelBlock(
                defaults.forkId,
                Number(defaults.milestoneBlockHeight),
                latestHash
            );

            const builder = createDefaultBuilder().withDummyBlock();
            builder
                .getAgreementManager()
                .withProof(milestoneProof(defaults.forkId))
                .withMilestoneSnapshot(mockSnapshot);

            // Add exit channel blocks to builder (order doesn't matter for storage)
            chain.forEach(({ hash, block }) => {
                builder.withExitChannelBlock(hash, block);
            });

            stateManager = builder.build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert - Should collect the exit channel block chain (excluding genesis)
            expect(result).to.not.be.undefined;
            expect(result!.exitChannelBlocks).to.have.length(2);
        });

        // Arrange: Setup milestone snapshot pointing to non-existent exit channel block hash
        // Act: Attempt to prepare update snapshot for the same fork
        // Assert: Throws error indicating exit channel block not found for the referenced hash
        it("should throw error when milestone snapshot references exit channel block hash that does not exist", async () => {
            // Arrange
            const nonExistentHash = hexString(32);
            const mockSnapshot = snapshotWithExitChannelBlock(
                defaults.forkId,
                Number(defaults.milestoneBlockHeight),
                nonExistentHash
            );

            const builder = createDefaultBuilder().withDummyBlock();
            builder
                .getAgreementManager()
                .withProof(milestoneProof(defaults.forkId))
                .withMilestoneSnapshot(mockSnapshot);

            // Note: We don't configure any exit channel blocks, so the lookup will fail
            stateManager = builder.build();

            // Act & Assert
            await expect(
                stateManager.prepareUpdateSnapshotSameFork(defaults.forkId)
            ).to.be.rejectedWith("not found in storage");
        });
    });

    describe("prepareUpdateStateSnapshotFork", () => {
        // Arrange: Setup StateManager with no disputed forks on-chain
        // Act: Attempt to prepare update state snapshot for fork
        // Assert: Returns undefined because no forks are disputed
        it("should return undefined when no forks are disputed on-chain", async () => {
            // Arrange
            const builder = createDefaultBuilder();
            builder.getTestContract().withForkDisputed(defaults.forkId, false);

            stateManager = builder.build();

            // Act
            const result = await stateManager.prepareUpdateStateSnapshotFork();

            // Assert
            expect(result).to.be.undefined;
        });

        // Arrange: Setup disputed fork on-chain with reduced result pointing to resolved fork, configure genesis snapshot
        // Act: Attempt to prepare update state snapshot for fork
        // Assert: Returns update data with genesis snapshot and exit blocks for the resolved fork
        it("should prepare update data with genesis snapshot when disputed fork has reduced result pointing to resolved fork", async () => {
            // Arrange
            const builder = new StateManagerTestBuilder().withChannel(
                defaults.channelId
            );

            const onChainFork = hexString(32);
            const reducedFork = hexString(32);

            // Store a real exit channel block and use its hash in the genesis snapshot
            const genesisExitBlock = {
                exitChannels: [],
                previousBlockHash: defaults.emptyBlockHash
            };
            const genesisExitBlockHash =
                builder.storeExitChannelBlock(genesisExitBlock);

            // Configure genesis snapshot for the reduced fork (final resolved fork after dispute resolution)
            builder.withGenesisSnapshot(reducedFork, {
                latestExitChannelBlockHash: genesisExitBlockHash
            });

            stateManager = builder.build();

            // Configure contract for disputed fork scenario AFTER building (to avoid builder override)
            const onChainSnapshot = stateSnapshot({
                forkId: onChainFork,
                blockHeight: Number(defaults.onChainBlockHeight),
                timestamp: defaults.defaultTimestamp
            });

            (stateManager.stateChannelManagerContract as any)
                .withStateSnapshot({
                    forkId: onChainFork,
                    blockHeight: defaults.onChainBlockHeight,
                    timestamp: defaults.defaultTimestamp,
                    snapshotData: onChainSnapshot.snapshotData
                })
                .withForkDisputed(onChainFork, true) // On-chain fork is disputed (this triggers the logic)
                .withForkDisputed(reducedFork, false) // Reduced fork is not disputed
                .withReducedResult(onChainFork, reducedFork, true); // Reduced result exists for on-chain fork

            // Act
            const result = await stateManager.prepareUpdateStateSnapshotFork();

            // Assert
            expect(result).to.not.be.undefined;
            expect(result!.genesisSnapshot).to.exist;
            expect(result!.exitBlocks).to.be.an("array");
        });

        // Arrange: Setup disputed fork on-chain but no genesis snapshot exists for the resolved fork
        // Act: Attempt to prepare update state snapshot for fork
        // Assert: Throws error indicating no genesis snapshot found for the fork
        it("should throw error when disputed fork is resolved but genesis snapshot is missing", async () => {
            // Arrange
            const builder = createDefaultBuilder();

            // Configure contract - current fork is disputed but no genesis snapshot exists
            builder
                .getTestContract()
                .withForkDisputed(defaults.forkId, true)
                .withReducedResult(
                    defaults.forkId,
                    defaults.emptyBlockHash,
                    false
                ); // No reduced result

            stateManager = builder.build();

            // Configure getWindowCommitments to return empty array so the loop breaks and tries to get genesis snapshot
            (
                stateManager.stateChannelManagerContract as any
            ).getWindowCommitments = sinon.stub().resolves([]);

            // No genesis snapshot configured - should fail

            // Act & Assert
            await expect(
                stateManager.prepareUpdateStateSnapshotFork()
            ).to.be.rejectedWith("No genesis snapshot found for fork");
        });
    });

    describe("postStateSnapshot", () => {
        // Arrange: Setup StateManager on same fork as on-chain, configure valid milestone snapshot
        // Act: Post state snapshot to on-chain
        // Assert: Calls updateStateSnapshotSameFork contract method
        it("should call updateStateSnapshotSameFork contract method when posting snapshot for same fork as on-chain", async () => {
            // Arrange
            const builder = createDefaultBuilder().withDummyBlock();
            builder.getTestContract().withUpdateStateSnapshotSameForkResult({
                wait: async () => ({})
            });

            stateManager = builder.build();

            // Configure agreement manager to return valid update data
            stateManager.agreementManager.getStateProof = async () => ({
                milestones: [
                    {
                        blockConfirmations: [
                            {
                                signedBlock: {
                                    encodedBlock: "0x",
                                    signature: "0x"
                                },
                                signatures: []
                            }
                        ]
                    }
                ],
                signedBlocks: []
            });

            // Create a proper StateSnapshot object
            const realSnapshot = stateSnapshot({
                forkId: defaults.forkId,
                blockHeight: Number(defaults.milestoneBlockHeight),
                snapshotData: snapshotData({
                    originForkId: defaults.forkId
                })
            });

            stateManager.agreementManager.getSnapshotFromMilestone = () =>
                realSnapshot;

            // Act
            await stateManager.postStateSnapshot(defaults.forkId);

            // Assert
            expect(
                (stateManager.stateChannelManagerContract as any)
                    .updateStateSnapshotSameFork.called
            ).to.be.true;
        });

        // Arrange: Setup disputed fork on-chain with reduced result, configure milestone snapshot for resolved fork
        // Act: Post state snapshot for resolved fork (different from on-chain fork)
        // Assert: Calls multicall contract method to update fork and post snapshot in single transaction
        it("should call multicall contract method when posting snapshot for resolved fork different from disputed on-chain fork", async () => {
            // Arrange
            const builder = createDefaultBuilder();

            const onChainFork = hexString(32);
            const reducedFork = hexString(32);

            // Configure the test contract BEFORE building
            builder
                .getTestContract()
                .withForkDisputed(onChainFork, true) // On-chain fork is disputed
                .withForkDisputed(reducedFork, false) // Reduced fork is not disputed
                .withReducedResult(onChainFork, reducedFork, true) // Points to reduced fork
                .withMulticallResult({ wait: async () => ({}) });

            // Mock the interface.encodeFunctionData method
            builder
                .getTestContract()
                .interface.encodeFunctionData.returns("0xmockedcalldata");

            // Store genesis snapshot for the reduced fork (final resolved fork after dispute resolution)
            builder.withGenesisSnapshot(reducedFork, {
                latestExitChannelBlockHash: defaults.emptyBlockHash
            });

            // Add dummy block so getNextBlockHeight works correctly
            builder.withDummyBlock();

            // Configure agreement manager with proof for the reduced fork
            const reducedSnapshot = snapshotWithExitChannelBlock(
                reducedFork,
                Number(defaults.milestoneBlockHeight),
                defaults.emptyBlockHash
            );

            builder
                .getAgreementManager()
                .withProof({
                    forkId: reducedFork,
                    height: 0, // Since we have a dummy block, latest height - 1 = 0
                    proof: {
                        milestones: [
                            {
                                blockConfirmations: [
                                    {
                                        signedBlock: {
                                            encodedBlock: "0xencoded",
                                            signature: "0xsig"
                                        },
                                        signatures: []
                                    }
                                ]
                            }
                        ],
                        signedBlocks: []
                    }
                })
                .withMilestoneSnapshot(reducedSnapshot);

            stateManager = builder.build();

            // Configure the contract AFTER building to override defaults
            const onChainSnapshot = stateSnapshot({
                forkId: onChainFork,
                blockHeight: Number(defaults.onChainBlockHeight),
                timestamp: defaults.defaultTimestamp
            });

            (stateManager.stateChannelManagerContract as any).withStateSnapshot(
                {
                    forkId: onChainFork,
                    blockHeight: defaults.onChainBlockHeight,
                    timestamp: defaults.defaultTimestamp,
                    snapshotData: onChainSnapshot.snapshotData
                }
            );

            // Act - Call with target fork (reduced fork, different from on-chain fork)
            await stateManager.postStateSnapshot(reducedFork);

            // Assert
            expect(
                (stateManager.stateChannelManagerContract as any).multicall
                    .called
            ).to.be.true;
        });

        // Arrange: Setup StateManager with valid update data, mock contract to throw error
        // Act: Post state snapshot to on-chain
        // Assert: Error propagates from contract call
        it("should propagate contract errors when updateStateSnapshotSameFork fails", async () => {
            // Arrange
            stateManager = createDefaultBuilder().build();

            // Mock prepareUpdateSnapshotSameFork to return valid data
            sinon.stub(stateManager, "prepareUpdateSnapshotSameFork").resolves({
                milestoneProofs: [],
                milestoneSnapshots: [],
                exitChannelBlocks: []
            });

            // Mock contract to throw error
            (
                stateManager.stateChannelManagerContract as any
            ).updateStateSnapshotSameFork.rejects(new Error("Contract error"));

            // Act & Assert
            await expect(
                stateManager.postStateSnapshot(defaults.forkId)
            ).to.be.rejectedWith("Contract error");
        });
    });

    describe("onJoinChannel", () => {
        // Arrange: Setup StateManager with default channel, create join channel block with participant and balance
        // Act: Call onJoinChannel with join channel block and total deposits
        // Assert: Join channel block is stored in storage with correct total deposits
        it("should store join channel block in storage when participant joins channel", async () => {
            // Arrange
            stateManager = createDefaultBuilder().build();
            const participant = hexString(20) as Address;
            const joinChannelBlockData = joinChannelBlock({
                previousBlockHash: defaults.emptyBlockHash,
                joinChannels: [
                    {
                        channelId: defaults.channelId,
                        participant,
                        deadlineTimestamp: BigInt(
                            defaults.defaultTimestamp + 1000
                        ),
                        balance: { amount: 100n, data: "0x" }
                    }
                ]
            });
            const timestamp = defaults.defaultTimestamp as Timestamp;
            const totalDeposits: BalanceStruct = { amount: 100n, data: "0x" };

            // Act
            await stateManager.onJoinChannel(
                joinChannelBlockData,
                timestamp,
                totalDeposits
            );

            // Assert
            const blockHash = ethers.keccak256(
                Codec.encode(joinChannelBlockData, Type.JoinChannelBlock)
            );
            const storedEntry =
                stateManager.storage.joinChannelBlocks.getJoinChannelBlockEntry(
                    blockHash
                );
            expect(storedEntry).to.not.be.undefined;
            expect(storedEntry!.block).to.deep.equal(joinChannelBlockData);
            expect(storedEntry!.totalDeposits).to.deep.equal(totalDeposits);
        });
    });

    describe("setGenesisState", () => {
        // Arrange: Setup StateManager with default channel, create snapshot data and encoded state
        // Act: Call setGenesisState with snapshot data, encoded state, fork ID, and timestamp
        // Assert: Genesis snapshot is stored, state machine state is set, fork ID is updated, and onTurn event is triggered
        it("should set genesis state and trigger onTurn event when initializing new fork", async () => {
            // Arrange
            stateManager = createDefaultBuilder().build();
            const encodedState = hexString(32) as any;
            const timestamp = defaults.defaultTimestamp as Timestamp;
            const participant = hexString(20) as Address;
            const snapshotDataObj = snapshotData({
                originForkId: defaults.forkId,
                stateMachineStateHash: hexString(32),
                participants: [participant],
                totalDeposits: { amount: 100n, data: "0x" }
            });

            // Compute forkId from snapshotData hash (required for genesis snapshot)
            const snapshotDataHash = ethers.keccak256(
                Codec.encode(snapshotDataObj, Type.SnapshotData)
            ) as ForkId;

            // Track if onTurn was called
            let onTurnCalled = false;
            const originalOnTurn = (stateManager.p2pEventHooks as any).onTurn;
            (stateManager.p2pEventHooks as any).onTurn = (address: Address) => {
                onTurnCalled = true;
                if (originalOnTurn) originalOnTurn(address);
            };

            // Act
            await stateManager.setGenesisState(
                snapshotDataObj,
                encodedState,
                snapshotDataHash,
                timestamp
            );

            // Assert
            expect(stateManager.forkId).to.equal(snapshotDataHash);
            const storedSnapshot = stateManager.storage.getStateSnapshot({
                forkId: snapshotDataHash,
                height: 0
            });
            expect(storedSnapshot).to.not.be.undefined;
            expect(storedSnapshot!.snapshotData).to.deep.equal(snapshotDataObj);
            expect(onTurnCalled).to.be.true;
        });
    });
});
