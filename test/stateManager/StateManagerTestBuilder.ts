import sinon from "sinon";
import StateManager from "@/stateManager/StateManager";
import Storage from "@/storage";
import { TestAgreementManager } from "./implementations/TestAgreementManager";
import { TestDiamondStateMachine } from "./implementations/TestDiamondStateMachine";
import { Address, Bytes, ChannelId, ForkId } from "@/types/types";
import { TimeConfig } from "@/types/time";
import { createLogger, Codec, Type } from "@/utils";
import { Block } from "@/models";
import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";

/**
 * Minimal test builder for StateManager
 * Only implements what's actually needed - no overengineering
 *
 * Example usage:
 *   const sm = new StateManagerTestBuilder()
 *     .withChannel("0xabc...")
 *     .withFork("0xdef...")
 *     .build();
 */

export const defaults = {
    channelId:
        "0x700909316746ebacbfa48a7d4d1e5086696d503f75bef6fbd74805d8b6b6390f" as ChannelId,
    forkId: "0xf5af30cd04f85777516e3ee5525df003d0cc962c0df64356bbf5bd9202c9aa8f" as ForkId,
    emptyBlockHash:
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Bytes
};

export class StateManagerTestBuilder {
    private storage = new Storage();
    private agreementManager = new TestAgreementManager();
    private diamondStateMachine = new TestDiamondStateMachine();
    private channelId: ChannelId = "0xdefaultchannel" as ChannelId;
    private forkId: ForkId = "0xdefaultfork" as ForkId;
    private timeConfig: TimeConfig = {
        p2pTime: 15,
        agreementTime: 5,
        chainFallbackTime: 30,
        evidenceTime: 30
    };
    private mockContract: any;
    private mockP2pEventHooks: any;

    constructor() {
        // Initialize minimal mocks for dependencies we can't avoid
        this.mockContract = this.createMockContract();
        this.mockP2pEventHooks = { onTurn: () => {} };
    }

    /**
     * Create minimal contract mock - only stub what StateManager actually calls
     */
    private createMockContract() {
        return {
            getStateSnapshot: sinon.stub().resolves({
                forkId: this.forkId,
                blockHeight: 3n,
                timestamp: 1000,
                snapshotData: {
                    originForkId: this.forkId,
                    stateMachineStateHash: "0x",
                    participants: [],
                    latestJoinChannelBlockHash: "0x",
                    latestExitChannelBlockHash: "0x",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                }
            }),
            isForkDisputed: sinon.stub().resolves(false),
            getReducedResult: sinon.stub().resolves([null, false]),
            multicall: sinon.stub().resolves({ wait: async () => ({}) }),
            updateStateSnapshotSameFork: sinon
                .stub()
                .resolves({ wait: async () => ({}) }),
            interface: {
                encodeFunctionData: sinon.stub().returns("0x")
            },
            // Event filters needed by StateChannelEventListener
            filters: {
                ChannelOpened: sinon.stub().returns("ChannelOpened_filter"),
                StateSnapshotUpdated: sinon
                    .stub()
                    .returns("StateSnapshotUpdated_filter"),
                BlockCalldataPosted: sinon
                    .stub()
                    .returns("BlockCalldataPosted_filter"),
                DisputeCommitted: sinon
                    .stub()
                    .returns("DisputeCommitted_filter"),
                ChainSlashed: sinon.stub().returns("ChainSlashed_filter"),
                DisputeReducedResultCommitted: sinon
                    .stub()
                    .returns("DisputeReducedResultCommitted_filter"),
                DisputeCommittedWithAuditingData: sinon
                    .stub()
                    .returns("DisputeCommittedWithAuditingData_filter"),
                WithdrawalsUpdated: sinon
                    .stub()
                    .returns("WithdrawalsUpdated_filter"),
                ChannelStorageCleared: sinon
                    .stub()
                    .returns("ChannelStorageCleared_filter"),
                DisputeKilled: sinon.stub().returns("DisputeKilled_filter"),
                JoinChannelProcessed: sinon
                    .stub()
                    .returns("JoinChannelProcessed_filter")
            },
            on: sinon.stub().resolves(),
            off: sinon.stub().resolves()
        };
    }

    // Builder methods - add only what tests actually need

    withChannel(channelId: ChannelId): this {
        this.channelId = channelId;
        return this;
    }

    withFork(forkId: ForkId): this {
        this.forkId = forkId;
        return this;
    }

    withAgreementManager(manager: TestAgreementManager): this {
        this.agreementManager = manager;
        return this;
    }

    /**
     * Get the agreement manager for direct configuration
     * Example: builder.agreementManager.withProof(...)
     */
    getAgreementManager(): TestAgreementManager {
        return this.agreementManager;
    }

    /**
     * Set an exit channel block for testing
     */
    withExitChannelBlock(hash: string, block: any): this {
        this.storage.exitChannelBlocks.storeExitChannelBlock(block, undefined, {
            hash
        });
        return this;
    }

    /**
     * Create a dummy block so getNextBlockHeight returns a reasonable value
     */
    withDummyBlock(): this {
        // Create a minimal block struct
        const blockStruct: BlockStruct = {
            previousBlockHash: defaults.emptyBlockHash,
            stateSnapshotHash:
                "0xccc141f2e5e971802d39c9cc698923cc72dc93cd6f986f5846973672ae97f413" as Bytes,
            transaction: {
                header: {
                    channelId: this.channelId,
                    forkId: this.forkId,
                    transactionCnt: 0n,
                    participant:
                        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0x",
                    data: "0x"
                }
            }
        };

        // Create a signed block struct
        const signedBlockStruct: SignedBlockStruct = {
            encodedBlock: Codec.encode(blockStruct, Type.Block),
            signature: "0x" + "00".repeat(64) // 65 bytes of zeros as dummy signature
        };

        // Create proper Block instance
        const dummyBlock = Block.fromSignedBlock(signedBlockStruct);
        this.storage.blocks.storeBlock(dummyBlock);
        return this;
    }

    /**
     * Configure contract mock - for tests that need specific contract behavior
     */
    configureContract(configure: (contract: any) => void): this {
        configure(this.mockContract);
        return this;
    }

    /**
     * Build the StateManager instance with all configured dependencies
     */
    build(): StateManager {
        // Initialize Clock if needed
        try {
            const mockProvider = {
                getBlock: async () => ({
                    timestamp: Math.floor(Date.now() / 1000)
                })
            };
            Clock.init(mockProvider as any).catch(() => {
                // Clock might already be initialized
            });
        } catch {
            // Clock initialization may already be done
        }

        // Create a minimal signer mock
        const mockSigner = {
            signMessage: sinon.stub().resolves("0xsignature"),
            getAddress: sinon
                .stub()
                .resolves("0x1234567890123456789012345678901234567890")
        };

        // Create StateManager with all dependencies
        const stateManager = new StateManager(
            mockSigner as any,
            "0x1234567890123456789012345678901234567890" as Address,
            this.mockContract as any,
            this.diamondStateMachine as any,
            this.timeConfig,
            this.mockP2pEventHooks as any,
            this.storage as any,
            createLogger({ component: "StateManager" })
        );

        // Configure it
        stateManager.setChannelId(this.channelId);
        stateManager.forkId = this.forkId;
        stateManager.agreementManager = this.agreementManager as any;

        // Update contract mock to return the correct forkId
        this.mockContract.getStateSnapshot.resolves({
            forkId: this.forkId,
            blockHeight: 3n,
            timestamp: 1000,
            snapshotData: {
                originForkId: this.forkId,
                stateMachineStateHash: "0x",
                participants: [],
                latestJoinChannelBlockHash: defaults.emptyBlockHash,
                latestExitChannelBlockHash: defaults.emptyBlockHash,
                totalDeposits: { amount: 0n, data: "0x" },
                totalWithdrawals: { amount: 0n, data: "0x" }
            }
        });

        return stateManager;
    }
}
