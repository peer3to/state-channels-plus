import sinon from "sinon";
import StateManager from "@/stateManager/StateManager";
import Storage from "@/storage";
import { TestAgreementManager } from "./implementations/TestAgreementManager";
import { TestDiamondStateMachine } from "./implementations/TestDiamondStateMachine";
import { TestStateChannelManagerContract } from "./implementations/TestStateChannelManagerContract";
import { Address, ChannelId, ForkId, Hash } from "@/types/types";
import { TimeConfig } from "@/types/time";
import { createLogger, Codec, Type, Logger } from "@/utils";
import { Block, StateSnapshot } from "@/models";
import {
    BlockStruct,
    ExitChannelBlockStruct,
    SignedBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { zeroHex, hexString } from "@test/factory";

/**
 * Minimal test builder for StateManager
 *
 * Example usage:
 *   const sm = new StateManagerTestBuilder()
 *     .withChannel("0xabc...")
 *     .withFork("0xdef...")
 *     .build();
 */

export const defaults = {
    channelId:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ChannelId,
    forkId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as ForkId,
    differentForkId:
        "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba" as ForkId,
    emptyBlockHash: zeroHex(32) as Hash,
    // Common test values
    onChainBlockHeight: 3n,
    milestoneBlockHeight: 5n,
    defaultTimestamp: 1000,
    defaultExitChannelBlockHash:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hash,
    signerAddress: hexString(20) as Address
};

export class StateManagerTestBuilder {
    private storage = new Storage();
    private agreementManager: TestAgreementManager;
    private diamondStateMachine = new TestDiamondStateMachine();
    private channelId: ChannelId = "0xdefaultchannel" as ChannelId;
    private forkId: ForkId = "0xdefaultfork" as ForkId;
    private timeConfig: TimeConfig = {
        p2pTime: 15,
        agreementTime: 5,
        chainFallbackTime: 30,
        evidenceTime: 30
    };
    private testContract: TestStateChannelManagerContract;
    private mockP2pEventHooks: any;
    private logger: Logger;

    constructor() {
        // Initialize test implementations for external dependencies
        this.logger = createLogger({ component: "StateManagerTestBuilder" });
        this.testContract = new TestStateChannelManagerContract();
        this.mockP2pEventHooks = { onTurn: () => {} };
        this.agreementManager = new TestAgreementManager(
            this.storage,
            this.logger
        );
    }

    getTestContract(): TestStateChannelManagerContract {
        return this.testContract;
    }

    // Builder methods

    withChannel(channelId: ChannelId): this {
        this.channelId = channelId;
        return this;
    }

    withFork(forkId: ForkId): this {
        this.forkId = forkId;
        return this;
    }

    /**
     * Get the agreement manager for direct configuration
     * Example: builder.getAgreementManager().withProof(...)
     */
    getAgreementManager(): TestAgreementManager {
        return this.agreementManager;
    }

    /**
     * Set an exit channel block for testing
     */
    withExitChannelBlock(hash: Hash, block: ExitChannelBlockStruct): this {
        this.storage.exitChannelBlocks.storeExitChannelBlock(block, undefined, {
            hash
        });
        return this;
    }

    /**
     * Store an exit channel block and return its hash
     */
    storeExitChannelBlock(block: ExitChannelBlockStruct): Hash {
        return this.storage.exitChannelBlocks.storeExitChannelBlock(block);
    }

    withGenesisSnapshot(
        forkId: ForkId,
        snapshotData: Partial<SnapshotDataStruct>
    ): this {
        const fullSnapshotData = {
            originForkId: forkId,
            stateMachineStateHash: defaults.emptyBlockHash,
            participants: [],
            latestJoinChannelBlockHash: defaults.emptyBlockHash,
            latestExitChannelBlockHash: defaults.emptyBlockHash,
            totalDeposits: { amount: 0n, data: "0x" },
            totalWithdrawals: { amount: 0n, data: "0x" },
            ...snapshotData // Override with provided data
        };

        const snapshotStruct = {
            forkId,
            blockHeight: 0n,
            timestamp: 0,
            snapshotData: fullSnapshotData
        };

        const genesisSnapshot = StateSnapshot.from(snapshotStruct);
        (this.storage.stateSnapshots as any).genesisSnapshotDataByForkId.set(
            forkId,
            genesisSnapshot
        );
        return this;
    }

    /**
     * Create a dummy block so getNextBlockHeight returns a reasonable value
     */
    withDummyBlock(): this {
        // Create a minimal block struct
        const blockStruct: BlockStruct = {
            previousBlockHash: defaults.emptyBlockHash,
            stateSnapshotHash: hexString(32) as Hash,
            transaction: {
                header: {
                    channelId: this.channelId,
                    forkId: this.forkId,
                    transactionCnt: 0n,
                    participant: hexString(20) as Address,
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
            getAddress: sinon.stub().resolves(defaults.signerAddress)
        };

        // Create StateManager with all dependencies
        const stateManager = new StateManager(
            mockSigner as any,
            defaults.signerAddress,
            this.testContract as any,
            this.diamondStateMachine as any,
            this.timeConfig,
            this.mockP2pEventHooks as any,
            this.storage as any,
            createLogger({ component: "StateManager" })
        );

        // Configure it
        stateManager.setChannelId(this.channelId);
        stateManager.forkId = this.forkId;

        stateManager.agreementManager = this.agreementManager;

        // Configure default contract behavior
        this.testContract.withStateSnapshot({
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
