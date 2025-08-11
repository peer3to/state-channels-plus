import { StateChannelManagerProxy, LocalDiamond } from "../typechain-types";

/**
 * Handles automatic mirroring of on-chain StateChannelManagerProxy events
 * to the local diamond storage
 */
export class EventMirror {
    private isRunning: boolean = false;

    constructor(
        private onChainProxy: StateChannelManagerProxy,
        private localDiamond: LocalDiamond
    ) {}

    /**
     * Start mirroring events from on-chain proxy to local diamond
     */
    public startMirroring(): void {
        if (this.isRunning) {
            console.warn("EventMirror is already running");
            return;
        }

        this.isRunning = true;
        console.log("Starting automatic event mirroring...");
        this.setupEventListeners();
        console.log("Event mirroring started successfully");
    }

    /**
     * Stop event mirroring and remove all listeners
     */
    public stopMirroring(): void {
        if (!this.isRunning) {
            console.warn("EventMirror is not running");
            return;
        }

        this.isRunning = false;
        this.onChainProxy.removeAllListeners();
        console.log("Event mirroring stopped");
    }

    /**
     * Get the current status of the event mirror
     */
    public getStatus(): { isRunning: boolean } {
        return { isRunning: this.isRunning };
    }

    /**
     * Setup all event listeners for automatic mirroring
     */
    private setupEventListeners(): void {
        // Mirror ChannelSnapshotSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.ChannelSnapshotSet(),
            async (channelId, stateSnapshot) => {
                try {
                    await this.localDiamond.setChannelSnapshot(
                        channelId,
                        stateSnapshot
                    );
                    console.log(
                        `Mirrored ChannelSnapshotSet for channel ${channelId}`
                    );
                } catch (error) {
                    console.error("Error mirroring ChannelSnapshotSet:", error);
                }
            }
        );

        // Mirror BlockCalldataCommitmentSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.BlockCalldataCommitmentSet(),
            async (channelId, participant, forkId, blockHeight, commitment) => {
                try {
                    await this.localDiamond.setBlockCalldataCommitment(
                        channelId,
                        participant,
                        forkId,
                        blockHeight,
                        commitment
                    );
                    console.log(
                        `Mirrored BlockCalldataCommitmentSet for channel ${channelId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring BlockCalldataCommitmentSet:",
                        error
                    );
                }
            }
        );

        // Mirror OnChainJoinChannelSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.OnChainJoinChannelSet(),
            async (channelId, blockHash, value) => {
                try {
                    await this.localDiamond.setOnChainJoinChannel(
                        channelId,
                        blockHash,
                        value
                    );
                    console.log(
                        `Mirrored OnChainJoinChannelSet for channel ${channelId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring OnChainJoinChannelSet:",
                        error
                    );
                }
            }
        );

        // Mirror OnChainJoinChannelDeleted events
        this.onChainProxy.on(
            this.onChainProxy.filters.OnChainJoinChannelDeleted(),
            async (channelId, blockHash) => {
                try {
                    await this.localDiamond.deleteOnChainJoinChannel(
                        channelId,
                        blockHash
                    );
                    console.log(
                        `Mirrored OnChainJoinChannelDeleted for channel ${channelId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring OnChainJoinChannelDeleted:",
                        error
                    );
                }
            }
        );

        // Mirror LatestJoinChannelBlockHashSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.LatestJoinChannelBlockHashSet(),
            async (channelId, blockHash) => {
                try {
                    await this.localDiamond.setLatestJoinChannelBlockHash(
                        channelId,
                        blockHash
                    );
                    console.log(
                        `Mirrored LatestJoinChannelBlockHashSet for channel ${channelId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring LatestJoinChannelBlockHashSet:",
                        error
                    );
                }
            }
        );

        // Mirror TotalOnChainWithdrawalsSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.TotalOnChainWithdrawalsSet(),
            async (channelId, totalOnChainWithdrawals) => {
                try {
                    await this.localDiamond.setTotalOnChainWithdrawals(
                        channelId,
                        totalOnChainWithdrawals
                    );
                    console.log(
                        `Mirrored TotalOnChainWithdrawalsSet for channel ${channelId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring TotalOnChainWithdrawalsSet:",
                        error
                    );
                }
            }
        );

        // Mirror PendingParticipantAdded events
        this.onChainProxy.on(
            this.onChainProxy.filters.PendingParticipantAdded(),
            async (channelId, participant) => {
                try {
                    await this.localDiamond.addPendingParticipant(
                        channelId,
                        participant
                    );
                    console.log(
                        `Mirrored PendingParticipantAdded for channel ${channelId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring PendingParticipantAdded:",
                        error
                    );
                }
            }
        );

        // Mirror DisputeWindowCreated events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputeWindowCreated(),
            async (channelId, forkId, creationTimestamp) => {
                try {
                    await this.localDiamond.createDisputeWindow(
                        channelId,
                        forkId,
                        creationTimestamp
                    );
                    console.log(
                        `Mirrored DisputeWindowCreated for channel ${channelId}, fork ${forkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputeWindowCreated:",
                        error
                    );
                }
            }
        );

        // Mirror DisputeWindowCreationTimestampSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputeWindowCreationTimestampSet(),
            async (channelId, forkId, creationTimestamp) => {
                try {
                    await this.localDiamond.setDisputeWindowCreationTimestamp(
                        channelId,
                        forkId,
                        creationTimestamp
                    );
                    console.log(
                        `Mirrored DisputeWindowCreationTimestampSet for channel ${channelId}, fork ${forkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputeWindowCreationTimestampSet:",
                        error
                    );
                }
            }
        );

        // Mirror DisputeCommitmentsCleared events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputeCommitmentsCleared(),
            async (channelId, forkId) => {
                try {
                    await this.localDiamond.clearDisputeCommitments(
                        channelId,
                        forkId
                    );
                    console.log(
                        `Mirrored DisputeCommitmentsCleared for channel ${channelId}, fork ${forkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputeCommitmentsCleared:",
                        error
                    );
                }
            }
        );

        // Mirror DisputeCommitmentPushed events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputeCommitmentPushed(),
            async (channelId, forkId, commitment) => {
                try {
                    await this.localDiamond.pushDisputeCommitment(
                        channelId,
                        forkId,
                        commitment
                    );
                    console.log(
                        `Mirrored DisputeCommitmentPushed for channel ${channelId}, fork ${forkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputeCommitmentPushed:",
                        error
                    );
                }
            }
        );

        // Mirror DisputeCommitmentRemoved events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputeCommitmentRemoved(),
            async (channelId, forkId, index) => {
                try {
                    await this.localDiamond.removeDisputeCommitment(
                        channelId,
                        forkId,
                        index
                    );
                    console.log(
                        `Mirrored DisputeCommitmentRemoved for channel ${channelId}, fork ${forkId}, index ${index}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputeCommitmentRemoved:",
                        error
                    );
                }
            }
        );

        // Mirror HasPostedSet events
        this.onChainProxy.on(
            this.onChainProxy.filters.HasPostedSet(),
            async (channelId, forkId, participant, hasPosted) => {
                try {
                    await this.localDiamond.setHasPosted(
                        channelId,
                        forkId,
                        participant,
                        hasPosted
                    );
                    console.log(
                        `Mirrored HasPostedSet for channel ${channelId}, fork ${forkId}, participant ${participant}`
                    );
                } catch (error) {
                    console.error("Error mirroring HasPostedSet:", error);
                }
            }
        );

        // Mirror DisputeWindowDeleted events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputeWindowDeleted(),
            async (channelId, forkId) => {
                try {
                    await this.localDiamond.deleteDisputeWindow(
                        channelId,
                        forkId
                    );
                    console.log(
                        `Mirrored DisputeWindowDeleted for channel ${channelId}, fork ${forkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputeWindowDeleted:",
                        error
                    );
                }
            }
        );

        // Mirror ReducedResultCommitted events
        this.onChainProxy.on(
            this.onChainProxy.filters.ReducedResultCommitted(),
            async (
                channelId,
                disputedForkId,
                reducedForkId,
                reductionTimestamp,
                forkGenesisTimestamp,
                reducer
            ) => {
                try {
                    await this.localDiamond.commitReducedResult(
                        channelId,
                        disputedForkId,
                        reducedForkId,
                        reductionTimestamp,
                        forkGenesisTimestamp,
                        reducer
                    );
                    console.log(
                        `Mirrored ReducedResultCommitted for channel ${channelId}, disputed fork ${disputedForkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring ReducedResultCommitted:",
                        error
                    );
                }
            }
        );

        // Mirror ReducedResultForkIdCleared events
        this.onChainProxy.on(
            this.onChainProxy.filters.ReducedResultForkIdCleared(),
            async (channelId, disputedForkId) => {
                try {
                    await this.localDiamond.clearReducedResultForkId(
                        channelId,
                        disputedForkId
                    );
                    console.log(
                        `Mirrored ReducedResultForkIdCleared for channel ${channelId}, disputed fork ${disputedForkId}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring ReducedResultForkIdCleared:",
                        error
                    );
                }
            }
        );

        // Mirror DisputedForkRemoved events
        this.onChainProxy.on(
            this.onChainProxy.filters.DisputedForkRemoved(),
            async (channelId, forkId, index) => {
                try {
                    await this.localDiamond.removeDisputedFork(
                        channelId,
                        forkId,
                        index
                    );
                    console.log(
                        `Mirrored DisputedForkRemoved for channel ${channelId}, fork ${forkId}, index ${index}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring DisputedForkRemoved:",
                        error
                    );
                }
            }
        );

        // Mirror OnChainSlashedAdded events
        this.onChainProxy.on(
            this.onChainProxy.filters.OnChainSlashedAdded(),
            async (channelId, participant, timestamp) => {
                try {
                    await this.localDiamond.addOnChainSlash(
                        channelId,
                        participant,
                        timestamp
                    );
                    console.log(
                        `Mirrored OnChainSlashedAdded for channel ${channelId}, participant ${participant}`
                    );
                } catch (error) {
                    console.error(
                        "Error mirroring OnChainSlashedAdded:",
                        error
                    );
                }
            }
        );
    }
}

export default EventMirror;
