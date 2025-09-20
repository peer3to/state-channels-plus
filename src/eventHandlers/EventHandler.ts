import { LocalDiamond } from "@typechain-types";
import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { ChannelId, Timestamp, Address, Hash, ForkId } from "@/types/types";
import Storage from "@/storage";

export class EventHandler {
    constructor(
        private storage: Storage,
        private stateManager: StateManager,
        private p2pEventHooks: P2pEventHooks,
        private localDiamondContract: LocalDiamond
    ) {}

    async onStateSnapshotUpdated(
        channelId: ChannelId,
        stateSnapshot: StateSnapshotStruct,
        timestamp: Timestamp
    ): Promise<void> {
        if (!(await this.isSnapshotInPast(channelId, stateSnapshot))) {
            // TODO: tryRecover

            throw new Error(
                "StateSnapshotUpdated: Rejected snapshot for channel " +
                    channelId +
                    " - not in past"
            );
        }

        this.localDiamondContract.onStateSnapshotUpdated(
            channelId,
            stateSnapshot,
            timestamp
        );
    }

    onBlockCalldataPosted(
        channelId: ChannelId,
        sender: Address,
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ): void {
        this.localDiamondContract.onBlockCalldataPosted(
            channelId,
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
    onDisputeCommitted(
        channelId: ChannelId,
        dispute: DisputeStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp,
        disputeAuditingData?: DisputeAuditingDataStruct
    ): void {
        throw new Error("TODO - Not implemented");
    }

    onChainSlashed(
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

    onDisputeReducedResultCommitted(
        channelId: ChannelId,
        forkId: ForkId,
        reducedForkId: ForkId,
        reductionTimestamp: Timestamp,
        forkGenesisTimestamp: Timestamp,
        reducer: Address
    ): void {
        throw new Error("TODO - Not implemented");
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
    onWithdrawalsUpdated(channelId: ChannelId, totalWithdrawals: any): void {
        this.localDiamondContract.onWithdrawalsUpdated(
            channelId,
            totalWithdrawals
        );
    }

    /**
     * Handle ChannelStorageCleared event
     */
    onChannelStorageCleared(
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
    onDisputeKilled(
        channelId: ChannelId,
        forkId: ForkId,
        disputer: Address
    ): void {
        this.localDiamondContract.onDisputeKilled(channelId, forkId, disputer);
    }

    /**
     * Handle JoinChannelProcessed event
     */
    onJoinChannelProcessed(
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

    private async isSnapshotInPast(
        channelId: ChannelId,
        incomingSnapshot: StateSnapshotStruct
    ): Promise<boolean> {
        const previousOnChainSnapshot =
            await this.localDiamondContract.getStateSnapshot(channelId);

        if (previousOnChainSnapshot.forkId === incomingSnapshot.forkId) {
            return (
                Number(incomingSnapshot.blockHeight) <
                Number(previousOnChainSnapshot.blockHeight)
            );
        }

        // Different fork
        return this.isIncomingSnapshotInForkChain(
            previousOnChainSnapshot.forkId,
            incomingSnapshot.forkId
        );
    }

    private isIncomingSnapshotInForkChain(
        previousOnChainForkId: ForkId,
        incomingSnapshotForkId: ForkId
    ): boolean {
        // Get the newest state snapshot from storage
        // We need to find the latest block for the current fork and get its state snapshot
        const latestBlock = this.storage.blocks.getLatestBlock(
            this.stateManager.latestForkId
        );
        if (!latestBlock) {
            // No blocks in storage for this fork, can't determine if incoming is in past
            return false;
        }

        let currentSnapshot = this.storage.getStateSnapshot(
            latestBlock.coordinates
        );
        if (!currentSnapshot) {
            return false;
        }

        // Traverse backwards through the fork chain using originForkId
        while (currentSnapshot) {
            if (currentSnapshot.forkId === incomingSnapshotForkId) {
                return true; // the incoming snapshot belongs to a past fork
            }

            // Check if we've reached the previous on-chain snapshot
            if (currentSnapshot.forkId === previousOnChainForkId) {
                return false;
            }

            // Move to the previous snapshot using originForkId
            // The originForkId points to the previous fork in the chain
            const originForkId = currentSnapshot.snapshotData.originForkId;

            // If originForkId is zero, we've reached the genesis
            if (originForkId === "0x00") {
                return false;
            }

            // Get the genesis snapshot of the origin fork
            currentSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    originForkId
                );
        }
        return false;
    }
}
