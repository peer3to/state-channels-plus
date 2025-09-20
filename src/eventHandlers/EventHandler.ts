import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { ChannelId, Timestamp, Address, Hash, ForkId } from "@/types/types";
import Storage from "@/storage";

/**
 * EventHandler - Centralized event handling with validation
 *
 * This class handles all blockchain events and performs necessary validation
 * before delegating to appropriate components. It acts as a gate on external input.
 */
export class EventHandler {
    constructor(
        private storage: Storage,
        private stateManager: StateManager,
        private stateChannelManagerContract: StateChannelManagerProxy,
        private p2pEventHooks: P2pEventHooks,
        private localDiamondContract: LocalDiamond
    ) {}

    /**
     * Handle StateSnapshotUpdated event with sanity check
     * This implements the note: "Check that the snapshot is in your past - iterate from the
     * previous on-chain snapshot until you reach your perception of the 'newest' and make sure
     * that the updated snapshot.forkId is in the past"
     */
    async handleStateSnapshotUpdated(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct,
        timestamp: Timestamp
    ): Promise<boolean> {
        // Perform sanity check before updating
        if (!(await this.isSnapshotInPast(channelId, stateSnapshot))) {
            // If sanity check fails, don't update the snapshot
            // This prevents accepting invalid or future snapshots
            console.warn(
                `StateSnapshotUpdated: Rejected snapshot for channel ${channelId} - not in past`
            );
            return false;
        }

        this.localDiamondContract.onStateSnapshotUpdated(
            channelId,
            stateSnapshot,
            timestamp
        );
        return true;
    }

    /**
     * Handle BlockCalldataPosted event
     */
    handleBlockCalldataPosted(
        channelId: ChannelId,
        commitmentHash: Hash,
        sender: Address,
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ): void {
        this.localDiamondContract.onBlockCalldataPosted(
            channelId,
            commitmentHash,
            sender,
            signedBlock,
            timestamp
        );
        this.p2pEventHooks.onPostedCalldata?.();
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock,
            signatures: []
        };
        this.stateManager.onBlockConfirmation(blockConfirmation, timestamp);
    }

    /**
     * Handle DisputeCommitted event
     */
    handleDisputeCommitted(
        channelId: ChannelId,
        dispute: DisputeStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp
    ): void {
        this.localDiamondContract.onDisputeCommitted(
            channelId,
            dispute,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp
        );
        const timestamp = Number(windowCreationTimestamp);
        this.stateManager.onDisputeCommitted(dispute, timestamp);
    }

    /**
     * Handle ChainSlashed event
     */
    handleChainSlashed(
        channelId: ChannelId,
        participant: Address,
        timestamp: Timestamp
    ): void {
        this.localDiamondContract.onOnChainSlashAdded(
            channelId,
            participant,
            timestamp
        );
    }

    /**
     * Handle DisputeReducedResultCommitted event
     */
    handleDisputeReducedResultCommitted(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp,
        forkGenesisTimestamp: Timestamp,
        reducer: Address
    ): void {
        this.localDiamondContract.onDisputeReducedResultCommitted(
            channelId,
            forkId,
            reducedForkId,
            reductionTimestamp,
            forkGenesisTimestamp,
            reducer
        );
    }

    /**
     * Handle WithdrawalsUpdated event
     */
    handleWithdrawalsUpdated(
        channelId: ChannelId,
        totalWithdrawals: any
    ): void {
        this.localDiamondContract.onWithdrawalsUpdated(
            channelId,
            totalWithdrawals
        );
    }

    /**
     * Handle ChannelStorageCleared event
     */
    handleChannelStorageCleared(
        channelId: ChannelId,
        latestJoinChannelBlockHash: Hash
    ): void {
        this.localDiamondContract.onChannelStorageCleared(
            channelId,
            latestJoinChannelBlockHash
        );
    }

    /**
     * Handle DisputeKilled event
     */
    handleDisputeKilled(
        channelId: ChannelId,
        forkId: ForkId,
        disputer: Address
    ): void {
        this.localDiamondContract.onDisputeKilled(channelId, forkId, disputer);
    }

    /**
     * Handle JoinChannelProcessed event
     */
    handleJoinChannelProcessed(
        channelId: ChannelId,
        joinChannelBlock: any,
        timestamp: Timestamp,
        totalDeposits: any
    ): void {
        this.localDiamondContract.onJoinChannelProcessed(
            channelId,
            joinChannelBlock,
            timestamp,
            totalDeposits
        );
        this.stateManager.onJoinChannel(
            joinChannelBlock,
            timestamp,
            totalDeposits
        );
    }

    // ====================================
    // PRIVATE VALIDATION METHODS
    // ====================================

    /**
     * Sanity check: Verify that the incoming snapshot is in the past
     * This implements the note: "Check that the snapshot is in your past - iterate from the
     * previous on-chain snapshot until you reach your perception of the 'newest' and make sure
     * that the updated snapshot.forkId is in the past"
     */
    private async isSnapshotInPast(
        channelId: ChannelId,
        incomingSnapshot: StateSnapshotStruct
    ): Promise<boolean> {
        // Get the current on-chain snapshot (single source of truth)
        const currentOnChainSnapshot =
            await this.localDiamondContract.getStateSnapshot(channelId);

        // If no current snapshot exists, accept the incoming one
        if (
            currentOnChainSnapshot.forkId ===
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
            return true;
        }

        // Check if the incoming snapshot is from the same fork but older
        if (currentOnChainSnapshot.forkId === incomingSnapshot.forkId) {
            // Same fork: check if incoming snapshot is older (lower block height)
            return (
                Number(incomingSnapshot.blockHeight) <
                Number(currentOnChainSnapshot.blockHeight)
            );
        }

        // Different fork: need to check if incoming forkId is in the past
        // by traversing dispute windows from current on-chain snapshot
        return this.isForkIdInPast(
            channelId,
            currentOnChainSnapshot.forkId,
            incomingSnapshot.forkId
        );
    }

    /**
     * Check if a forkId is in the past by traversing dispute windows
     * This implements the fork choice algorithm to determine if a fork is historical
     */
    private async isForkIdInPast(
        channelId: ChannelId,
        currentForkId: ForkId,
        targetForkId: ForkId
    ): Promise<boolean> {
        // If target fork is the same as current, it's not in the past
        if (currentForkId === targetForkId) {
            return false;
        }

        // Traverse dispute windows to see if targetForkId appears in the chain
        let forkId = currentForkId;
        const maxIterations = 100; // Reasonable limit to prevent infinite loops
        let iterations = 0;

        while (iterations < maxIterations) {
            // Check if there's a dispute window for this fork
            const isDisputed =
                await this.stateChannelManagerContract.isForkDisputed(
                    channelId,
                    forkId
                );

            if (!isDisputed) {
                // No dispute window, we've reached the end of the chain
                break;
            }

            // Get the reduced result for this fork
            const reducedResult =
                await this.stateChannelManagerContract.getReducedResult(
                    channelId,
                    forkId
                );

            if (
                reducedResult[0] &&
                reducedResult[0] !==
                    "0x0000000000000000000000000000000000000000000000000000000000000000"
            ) {
                // Check if this is our target fork
                if (reducedResult[0] === targetForkId) {
                    return true; // Found target fork in the past
                }

                // Move to the next fork in the chain
                forkId = reducedResult[0];
            } else {
                // No valid reduced result, can't traverse further
                break;
            }

            iterations++;
        }

        // Target fork not found in the historical chain
        return false;
    }
}
