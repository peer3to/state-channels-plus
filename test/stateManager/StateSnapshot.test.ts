import { expect } from "chai";
import { ethers } from "ethers";
import StateManager from "@/stateManager/StateManager";
import { stateSnapshot, exitChannelBlock } from "../factory";
import { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";

describe("StateManager - StateSnapshot BlockHeight", () => {
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
                snapshotData: {
                    latestExitChannelBlockHash: "0x0000000000000000"
                }
            })
        };

        // Create mock storage
        mockStorage = {
            stateSnapshots: {
                getGenesisSnapshotDataByForkId: () => stateSnapshot(),
                getStateSnapshotByHash: () => stateSnapshot()
            },
            blocks: {
                getLatestBlockHeight: () => 10
            },
            exitChannelBlocks: {
                getExitChannelBlock: () => exitChannelBlock(),
                getLatestExitChannelBlockHash: () => "0x0000000000000000",
                getTotalWithdrawals: () => ({ amount: 0n, data: "0x" })
            },
            joinChannelBlocks: {
                getLatestJoinChannelBlockHash: () => "0x0000000000000000",
                getTotalDeposits: () => ({ amount: 0n, data: "0x" })
            }
        };

        // Create mock agreement manager
        mockAgreementManager = {
            getStateProof: async () => ({
                milestones: [],
                signedBlocks: []
            })
        };

        // Create mock P2P event hooks
        mockP2pEventHooks = {
            // Add any required methods
        };

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
    });

    describe("createStateSnapshot", () => {
        it("should set blockHeight to 0 for genesis snapshots", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const stateMachineStateHash = "0xabcdef1234567890" as Hash;

            // Call createStateSnapshot with blockHeight = 0 (genesis)
            const stateSnapshot = await (
                stateManager as any
            ).createStateSnapshot(stateMachineStateHash, forkId, 0);

            expect(stateSnapshot.toStruct().blockHeight).to.equal(0n);
        });

        it("should set blockHeight to provided value for regular blocks", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const stateMachineStateHash = "0xabcdef1234567890" as Hash;
            const blockHeight = 5 as BlockHeight;

            // Call createStateSnapshot with blockHeight (regular block)
            const stateSnapshot = await (
                stateManager as any
            ).createStateSnapshot(stateMachineStateHash, forkId, blockHeight);

            expect(stateSnapshot.toStruct().blockHeight).to.equal(
                BigInt(blockHeight)
            );
        });

        it("should set blockHeight to 0 when explicitly passing 0", async () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const stateMachineStateHash = "0xabcdef1234567890" as Hash;
            const blockHeight = 0 as BlockHeight;

            // Call createStateSnapshot with blockHeight = 0
            const stateSnapshot = await (
                stateManager as any
            ).createStateSnapshot(stateMachineStateHash, forkId, blockHeight);

            expect(stateSnapshot.toStruct().blockHeight).to.equal(0n);
        });
    });
});
