import { expect } from "chai";
import sinon from "sinon";
import StateManager from "@/stateManager/StateManager";
import { stateSnapshot } from "../factory";
import { Address, ForkId, Hash, Timestamp } from "@/types/types";
import { Block, StateSnapshot } from "@/models";
import {
    SignedBlockStruct,
    TransactionStruct,
    JoinChannelBlockStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { MockSetup } from "./testUtils";

describe("StateManager", () => {
    let stateManager: StateManager;
    let mockSetup: MockSetup;

    beforeEach(async () => {
        sinon.restore();

        mockSetup = new MockSetup();
        await mockSetup.initializeClock();

        mockSetup.mockTimeConfig = {
            p2pTime: 15,
            agreementTime: 5,
            chainFallbackTime: 30,
            evidenceTime: 30
        };

        stateManager = new StateManager(
            mockSetup.mockSigner,
            "0x1234567890123456789012345678901234567890" as Address,
            mockSetup.mockStateChannelManagerContract as any,
            mockSetup.mockDiamondStateMachine as any,
            mockSetup.mockTimeConfig,
            mockSetup.mockP2pEventHooks as any,
            mockSetup.mockStorage as any
        );

        stateManager.setChannelId("0xabcdef1234567890" as any);
        stateManager.forkId = "0x1234567890abcdef" as ForkId;
    });

    afterEach(() => {
        mockSetup.cleanup();
    });

    describe("prepareUpdateSnapshotSameFork", () => {
        it("should return undefined when no relevant milestones are found", async () => {
            // Mock empty milestones
            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [],
                    signedBlocks: []
                });

            const result = await stateManager.prepareUpdateSnapshotSameFork(
                "0x1234567890abcdef" as ForkId
            );
            expect(result).to.be.undefined;
        });

        it("should return undefined when latest snapshot equals current on-chain", async () => {
            // Mock milestone with same block height as on-chain
            const mockSnapshot = {
                ...stateSnapshot(),
                blockHeight: 3, // Same as current on-chain
                forkId: "0x1234567890abcdef"
            };

            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [
                                {
                                    signedBlock: { encodedBlock: "0xencoded" }
                                }
                            ]
                        }
                    ],
                    signedBlocks: []
                });

            stateManager.agreementManager.getSnapshotFromMilestone = sinon
                .stub()
                .returns(mockSnapshot);

            const result = await stateManager.prepareUpdateSnapshotSameFork(
                "0x1234567890abcdef" as ForkId
            );
            expect(result).to.be.undefined;
        });

        it("should successfully prepare update data when valid milestones exist", async () => {
            // Mock milestone with newer block height
            const mockSnapshot = {
                ...stateSnapshot(),
                blockHeight: 5, // Higher than current on-chain (3)
                forkId: "0x1234567890abcdef",
                snapshotData: {
                    ...stateSnapshot().snapshotData,
                    latestExitChannelBlockHash: "0x1234567890abcdef"
                }
            };

            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [
                                {
                                    signedBlock: { encodedBlock: "0xencoded" }
                                }
                            ]
                        }
                    ],
                    signedBlocks: []
                });

            stateManager.agreementManager.getSnapshotFromMilestone = sinon
                .stub()
                .returns(mockSnapshot);

            // Mock exit channel block chain
            mockSetup.mockStorage.exitChannelBlocks.getExitChannelBlock
                .withArgs("0x1234567890abcdef")
                .returns({
                    exitChannels: [],
                    previousBlockHash: "0x0000000000000000" // Points to on-chain hash
                });

            const result = await stateManager.prepareUpdateSnapshotSameFork(
                "0x1234567890abcdef" as ForkId
            );

            expect(result).to.not.be.undefined;
            expect(result!.milestoneProofs).to.have.length(1);
            expect(result!.milestoneSnapshots).to.have.length(1);
            expect(result!.exitChannelBlocks).to.be.an("array");
        });

        it("should throw error when fork mismatch is detected", async () => {
            // Mock snapshot with different fork ID
            const mockSnapshot = {
                ...stateSnapshot(),
                blockHeight: 5,
                forkId: "0x9876543210fedcba" // Different fork
            };

            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [
                                {
                                    signedBlock: { encodedBlock: "0xencoded" }
                                }
                            ]
                        }
                    ],
                    signedBlocks: []
                });

            stateManager.agreementManager.getSnapshotFromMilestone = sinon
                .stub()
                .returns(mockSnapshot);

            await expect(
                stateManager.prepareUpdateSnapshotSameFork(
                    "0x1234567890abcdef" as ForkId
                )
            ).to.be.rejectedWith("Fork mismatch");
        });

        it("should throw error when empty milestone proof is found", async () => {
            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [] // Empty
                        }
                    ],
                    signedBlocks: []
                });

            await expect(
                stateManager.prepareUpdateSnapshotSameFork(
                    "0x1234567890abcdef" as ForkId
                )
            ).to.be.rejectedWith("Empty milestone proof found");
        });

        it("should throw error when snapshot not found", async () => {
            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [
                                {
                                    signedBlock: { encodedBlock: "0xencoded" }
                                }
                            ]
                        }
                    ],
                    signedBlocks: []
                });

            stateManager.agreementManager.getSnapshotFromMilestone = sinon
                .stub()
                .returns(undefined);

            await expect(
                stateManager.prepareUpdateSnapshotSameFork(
                    "0x1234567890abcdef" as ForkId
                )
            ).to.be.rejectedWith(
                "Milestone built but corresponding snapshot not found"
            );
        });

        it("should handle exit channel block chain correctly", async () => {
            const mockSnapshot = {
                ...stateSnapshot(),
                blockHeight: 5,
                forkId: "0x1234567890abcdef",
                snapshotData: {
                    ...stateSnapshot().snapshotData,
                    latestExitChannelBlockHash: "0x3333333333333333"
                }
            };

            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [
                                {
                                    signedBlock: { encodedBlock: "0xencoded" }
                                }
                            ]
                        }
                    ],
                    signedBlocks: []
                });

            stateManager.agreementManager.getSnapshotFromMilestone = sinon
                .stub()
                .returns(mockSnapshot);

            // Mock a chain of exit blocks: A -> B -> C
            const exitBlocks = {
                "0x3333333333333333": {
                    exitChannels: [
                        {
                            participant: "0x3333",
                            balance: { amount: 30n, data: "0x" }
                        }
                    ],
                    previousBlockHash: "0x2222222222222222"
                },
                "0x2222222222222222": {
                    exitChannels: [
                        {
                            participant: "0x2222",
                            balance: { amount: 20n, data: "0x" }
                        }
                    ],
                    previousBlockHash: "0x0000000000000000" // Points to on-chain
                }
            };

            mockSetup.mockStorage.exitChannelBlocks.getExitChannelBlock = sinon
                .stub()
                .callsFake((hash: string) => {
                    return exitBlocks[hash as keyof typeof exitBlocks];
                });

            const result = await stateManager.prepareUpdateSnapshotSameFork(
                "0x1234567890abcdef" as ForkId
            );

            expect(result).to.not.be.undefined;
            expect(result!.exitChannelBlocks).to.have.length(2);
        });

        it("should throw error when exit channel block not found", async () => {
            const mockSnapshot = {
                ...stateSnapshot(),
                blockHeight: 5,
                forkId: "0x1234567890abcdef",
                snapshotData: {
                    ...stateSnapshot().snapshotData,
                    latestExitChannelBlockHash: "0x1234567890abcdef"
                }
            };

            stateManager.agreementManager.getStateProof = sinon
                .stub()
                .resolves({
                    milestones: [
                        {
                            blockConfirmations: [
                                {
                                    signedBlock: { encodedBlock: "0xencoded" }
                                }
                            ]
                        }
                    ],
                    signedBlocks: []
                });

            stateManager.agreementManager.getSnapshotFromMilestone = sinon
                .stub()
                .returns(mockSnapshot);

            // Mock missing exit block
            mockSetup.mockStorage.exitChannelBlocks.getExitChannelBlock.returns(
                undefined
            );

            await expect(
                stateManager.prepareUpdateSnapshotSameFork(
                    "0x1234567890abcdef" as ForkId
                )
            ).to.be.rejectedWith("Exit channel block not found for hash");
        });
    });

    describe("prepareUpdateStateSnapshotFork", () => {
        it("should return undefined when fork is not disputed", async () => {
            mockSetup.mockStateChannelManagerContract.isForkDisputed.resolves(
                false
            );

            const result = await stateManager.prepareUpdateStateSnapshotFork();
            expect(result).to.be.undefined;
        });

        it("should handle disputed fork with existing reduced result", async () => {
            // Mock isForkDisputed to return true for initial fork, false for reduced fork
            mockSetup.mockStateChannelManagerContract.isForkDisputed.callsFake(
                (channelId: any, forkId: string) => {
                    if (forkId === "0x1234567890abcdef") {
                        return Promise.resolve(true); // Original fork is disputed
                    } else if (forkId === "0xreducedFork") {
                        return Promise.resolve(false); // Reduced fork is not disputed
                    }
                    return Promise.resolve(false);
                }
            );

            mockSetup.mockStateChannelManagerContract.getReducedResult.callsFake(
                (channelId: any, forkId: string) => {
                    if (forkId === "0x1234567890abcdef") {
                        return Promise.resolve(["0xreducedFork", true]);
                    }
                    return Promise.resolve([null, false]);
                }
            );

            // Mock StateSnapshot.from to return the proper snapshot
            sinon.stub(StateSnapshot, "from").returns({
                forkId: "0x1234567890abcdef",
                snapshotData: {
                    latestExitChannelBlockHash: "0xonchain"
                }
            } as any);

            // Mock genesis snapshot
            mockSetup.mockStorage.stateSnapshots.getGenesisSnapshotDataByForkId.returns(
                {
                    forkId: "0x1234567890abcdef",
                    snapshotData: {
                        latestExitChannelBlockHash: "0xgenesis"
                    }
                }
            );

            // Mock exit channel block entry
            mockSetup.mockStorage.exitChannelBlocks.getExitChannelBlockEntry.callsFake(
                (hash: string) => {
                    if (hash === "0xgenesis") {
                        return {
                            block: {
                                previousBlockHash: "0xonchain"
                            }
                        };
                    }
                    return undefined;
                }
            );

            const result = await stateManager.prepareUpdateStateSnapshotFork();

            expect(result).to.not.be.undefined;
            expect(result!.genesisSnapshot).to.exist;
            expect(result!.exitBlocks).to.be.an("array");

            // Restore the stub
            (StateSnapshot.from as any).restore();
        });

        it("should throw error when genesis snapshot not found", async () => {
            mockSetup.mockStateChannelManagerContract.isForkDisputed.resolves(
                true
            );
            mockSetup.mockStorage.stateSnapshots.getGenesisSnapshotDataByForkId.returns(
                undefined
            );

            await expect(
                stateManager.prepareUpdateStateSnapshotFork()
            ).to.be.rejectedWith("No genesis snapshot found for fork");
        });
    });

    describe("postStateSnapshot", () => {
        it("should call updateStateSnapshotSameFork when on same fork", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock prepareUpdateSnapshotSameFork to return valid data
            sinon.stub(stateManager, "prepareUpdateSnapshotSameFork").resolves({
                milestoneProofs: [],
                milestoneSnapshots: [],
                exitChannelBlocks: []
            });

            await stateManager.postStateSnapshot(forkId);

            expect(
                mockSetup.mockStateChannelManagerContract
                    .updateStateSnapshotSameFork.called
            ).to.be.true;
        });

        it("should handle multicall when on different fork", async () => {
            const forkId = "0x9876543210fedcba" as ForkId;

            // Mock different fork on-chain
            mockSetup.mockStateChannelManagerContract.getStateSnapshot.resolves(
                {
                    forkId: "0x1111111111111111", // Different fork
                    blockHeight: 3n,
                    timestamp: 1000,
                    snapshotData: {
                        latestExitChannelBlockHash: "0x0000000000000000"
                    }
                }
            );

            // Mock prepare methods
            sinon
                .stub(stateManager, "prepareUpdateStateSnapshotFork")
                .resolves({
                    genesisSnapshot: {
                        forkId: forkId,
                        toStruct: () => ({ forkId })
                    } as any,
                    exitBlocks: []
                });

            sinon.stub(stateManager, "prepareUpdateSnapshotSameFork").resolves({
                milestoneProofs: [],
                milestoneSnapshots: [],
                exitChannelBlocks: []
            });

            await stateManager.postStateSnapshot(forkId);

            expect(mockSetup.mockStateChannelManagerContract.multicall.called)
                .to.be.true;
        });

        it("should log when no updates needed", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock prepareUpdateSnapshotSameFork to return undefined
            sinon
                .stub(stateManager, "prepareUpdateSnapshotSameFork")
                .resolves(undefined);

            const consoleSpy = sinon.spy(console, "log");

            await stateManager.postStateSnapshot(forkId);

            expect(consoleSpy.calledWith("No state snapshot updates needed")).to
                .be.true;
            consoleSpy.restore();
        });

        it("should handle contract errors gracefully", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;

            // Mock prepareUpdateSnapshotSameFork to return valid data
            sinon.stub(stateManager, "prepareUpdateSnapshotSameFork").resolves({
                milestoneProofs: [],
                milestoneSnapshots: [],
                exitChannelBlocks: []
            });

            // Mock contract to throw error
            mockSetup.mockStateChannelManagerContract.updateStateSnapshotSameFork.rejects(
                new Error("Contract error")
            );

            await expect(
                stateManager.postStateSnapshot(forkId)
            ).to.be.rejectedWith("Contract error");
        });
    });

    describe("onJoinChannel", () => {
        it("should store join channel block correctly", async () => {
            const joinChannelBlock: JoinChannelBlockStruct = {
                previousBlockHash: "0xprevhash" as Hash,
                joinChannels: [
                    {
                        channelId: "0xabcdef1234567890",
                        participant:
                            "0x1234567890123456789012345678901234567890" as Address,
                        deadlineTimestamp: 2000,
                        balance: { amount: 100n, data: "0x" }
                    }
                ]
            };
            const timestamp = 1000 as Timestamp;
            const totalDeposits: BalanceStruct = { amount: 100n, data: "0x" };

            await stateManager.onJoinChannel(
                joinChannelBlock,
                timestamp,
                totalDeposits
            );

            expect(
                mockSetup.mockStorage.joinChannelBlocks.storeJoinChannelBlock.calledOnceWith(
                    joinChannelBlock,
                    totalDeposits
                )
            ).to.be.true;
        });
    });

    describe("setState", () => {
        it("should set state and trigger events correctly", async () => {
            const encodedState = "0x1234567890abcdef" as any; // Valid hex bytes
            const forkId = "0xnewfork" as ForkId;
            const timestamp = 2000 as Timestamp;

            await stateManager.setGenesisState(
                mockSetup.mockSnapshotData,
                encodedState,
                forkId,
                timestamp
            );

            expect(
                mockSetup.mockDiamondStateMachine.setState.calledWith(
                    encodedState
                )
            ).to.be.true;
            expect(stateManager.forkId).to.equal(forkId);
            expect(
                mockSetup.mockStorage.stateMachineStates.storeStateMachineState
                    .called
            ).to.be.true;
            expect(mockSetup.mockP2pEventHooks.onTurn.called).to.be.true;
        });
    });

    describe("onSignedBlock", () => {
        it("should process signed block correctly", async () => {
            const signedBlock: SignedBlockStruct = {
                encodedBlock: "0xencodedblock",
                signature: "0xsignature"
            };

            // Mock Block.fromBlockConfirmation to avoid actual decoding
            sinon.stub(Block, "fromBlockConfirmation").returns({
                author: "0x1234567890123456789012345678901234567890",
                forkId: "0x1234567890abcdef",
                height: 1,
                transaction: { header: { transactionCnt: 1n } },
                stateSnapshotHash: "0xsnaphash",
                blockConfirmationStruct: {
                    signedBlock,
                    signatures: []
                }
            } as any);

            const result = await stateManager.onSignedBlock(signedBlock);

            expect(result).to.be.a("boolean");
        });
    });

    describe("applyTransaction", () => {
        it("should apply transaction and return result", async () => {
            const transaction: TransactionStruct = {
                header: {
                    channelId: "0xabcdef1234567890",
                    participant: "0x1234567890123456789012345678901234567890",
                    forkId: "0x1234567890abcdef",
                    transactionCnt: 1n,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0xtransactionbody",
                    data: "0xdata"
                }
            };

            const result = await stateManager.applyTransaction(transaction);

            expect(result).to.have.property("success");
            expect(result).to.have.property("encodedState");
            expect(result).to.have.property("successCallback");
            expect(result).to.have.property("exitChannels");
            expect(result).to.have.property("leftParticipants");
        });
    });

    describe("playTransaction", () => {
        it("should throw error when channel not open", async () => {
            const transaction: TransactionStruct = {
                header: {
                    channelId: "0xabcdef1234567890",
                    participant: "0x1234567890123456789012345678901234567890",
                    forkId: "0x1234567890abcdef",
                    transactionCnt: 1n,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0xtransactionbody",
                    data: "0xdata"
                }
            };

            // Mock channel as closed
            stateManager.validationService.isChannelOpen = sinon
                .stub()
                .returns(false);

            await expect(
                stateManager.playTransaction(transaction)
            ).to.be.rejectedWith("Channel not open");
        });

        it("should throw error when not player's turn", async () => {
            const transaction: TransactionStruct = {
                header: {
                    channelId: "0xabcdef1234567890",
                    participant: "0x1234567890123456789012345678901234567890",
                    forkId: "0x1234567890abcdef",
                    transactionCnt: 1n,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0xtransactionbody",
                    data: "0xdata"
                }
            };

            // Mock channel as open but not player's turn
            stateManager.validationService.isChannelOpen = sinon
                .stub()
                .returns(true);
            mockSetup.mockDiamondStateMachine.getNextToWrite.resolves(
                "0xdifferentplayer"
            );

            await expect(
                stateManager.playTransaction(transaction)
            ).to.be.rejectedWith("Not player turn");
        });
    });

    describe("getParticipantsCurrent", () => {
        it("should return current participants", async () => {
            const participants = await stateManager.getParticipantsCurrent();
            expect(participants).to.deep.equal([
                "0x1234567890123456789012345678901234567890"
            ]);
        });
    });

    describe("dispose", () => {
        it("should dispose resources correctly", async () => {
            // Mock p2pManager dispose
            const p2pManagerDisposeSpy = sinon
                .stub(stateManager.p2pManager, "dispose")
                .resolves();
            const eventListenerDisposeSpy = sinon.stub(
                stateManager.stateChannelEventListener,
                "dispose"
            );

            await stateManager.dispose();

            expect(stateManager.isDisposed).to.be.true;
            expect(eventListenerDisposeSpy.called).to.be.true;
            expect(p2pManagerDisposeSpy.called).to.be.true;
        });
    });

    describe("setReductionTimeout", () => {
        it("should set reduction timeout correctly", () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const triggerTimestamp = 2000;

            // Ensure the stateManager's forkId matches the one we're testing
            stateManager.forkId = forkId;

            stateManager.setReductionTimeout(forkId, triggerTimestamp);

            expect(stateManager.reductionTriggerMap.has(forkId)).to.be.true;
            const reductionHandle =
                stateManager.reductionTriggerMap.get(forkId);
            expect(reductionHandle).to.not.be.undefined;
            expect(reductionHandle!.triggerTimestamp).to.equal(
                triggerTimestamp
            );
            expect(reductionHandle!.handle).to.not.be.undefined;
        });
    });

    describe("onDisputeCommitted", () => {
        it("should throw not implemented error", async () => {
            const dispute = {} as any;
            const timestamp = 1000 as Timestamp;

            await expect(
                stateManager.onDisputeCommitted(dispute, timestamp)
            ).to.be.rejectedWith("TODO - Not implemented");
        });
    });
});
