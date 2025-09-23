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
import ADiamondStateMachine from "@/ADiamondStateMachine";

export class EventHandler {
    constructor(
        private storage: Storage,
        private stateManager: StateManager,
        private p2pEventHooks: P2pEventHooks,
        private diamondStateMachine: ADiamondStateMachine
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

        this.diamondStateMachine.localDiamondContract.onStateSnapshotUpdated(
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
        this.diamondStateMachine.localDiamondContract.onBlockCalldataPosted(
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

    async onDisputeCommitted(
        channelId: ChannelId,
        dispute: DisputeStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp,
        disputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        // sync LocalDiamond state
        this.diamondStateMachine.localDiamondContract.onDisputeCommitted(
            channelId,
            dispute,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp
        );

        // isDisputeWindowRelevant?
        const isRelevant =
            await this.diamondStateMachine.localDiamondContract.isDisputeWindowRelevant(
                channelId,
                dispute
            );
        if (!isRelevant) {
            return;
        }
        /*if it's not part of the fork choice rule 
        (see Dispute Mental Model - fork choice rule) - ignore it - it's spam
        */
    }

    async onChainSlashed(
        channelId: ChannelId,
        participant: Address,
        timestamp: Timestamp
    ): Promise<void> {
        this.diamondStateMachine.localDiamondContract.onOnChainSlashAdded(
            channelId,
            participant,
            timestamp
        );
        const latestFork = this.stateManager.latestForkId;
        const isDisputed =
            await this.diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                latestFork
            );
        const participants = await this.diamondStateMachine.getParticipants();
        if (!isDisputed && participants.includes(participant.toString())) {
            await this.stateManager.disputeManager.createDispute(
                latestFork,
                false
            );
        }
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
        this.diamondStateMachine.localDiamondContract.onDisputeReducedResultCommitted(
            channelId,
            forkId,
            reducedForkId,
            reductionTimestamp,
            forkGenesisTimestamp,
            reducer
        );
    }

    onWithdrawalsUpdated(channelId: ChannelId, totalWithdrawals: any): void {
        this.diamondStateMachine.localDiamondContract.onWithdrawalsUpdated(
            channelId,
            totalWithdrawals
        );
    }

    onChannelStorageCleared(
        channelId: ChannelId,
        latestJoinChannelBlockHash: Hash
    ): void {
        this.diamondStateMachine.localDiamondContract.onChannelStorageCleared(
            channelId,
            latestJoinChannelBlockHash
        );
    }

    onDisputeKilled(
        channelId: ChannelId,
        forkId: ForkId,
        disputer: Address
    ): void {
        this.diamondStateMachine.localDiamondContract.onDisputeKilled(
            channelId,
            forkId,
            disputer
        );
    }

    onJoinChannelProcessed(
        channelId: ChannelId,
        joinChannelBlock: any,
        timestamp: Timestamp,
        totalDeposits: any
    ): void {
        this.diamondStateMachine.localDiamondContract.onJoinChannelProcessed(
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
            await this.diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            );

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

        while (currentSnapshot) {
            if (currentSnapshot.forkId === incomingSnapshotForkId) {
                return true; // the incoming snapshot belongs to a past fork
            }

            if (currentSnapshot.forkId === previousOnChainForkId) {
                return false;
            }

            const originForkId = currentSnapshot.snapshotData.originForkId;

            if (originForkId === "0x00") {
                return false;
            }

            currentSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    originForkId
                );
        }
        return false;
    }
}
