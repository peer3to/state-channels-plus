import { StateChannelManagerProxy, LocalDiamond } from "../typechain-types";

export class EventMirror {
    constructor(
        private onChainProxy: StateChannelManagerProxy,
        private localDiamond: LocalDiamond
    ) {}

    public startMirroring(): void {
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        const eventConfigs = [
            { event: "ChannelSnapshotSet", method: "setChannelSnapshot" },
            {
                event: "BlockCalldataCommitmentSet",
                method: "setBlockCalldataCommitment"
            },
            { event: "OnChainJoinChannelSet", method: "setOnChainJoinChannel" },
            {
                event: "OnChainJoinChannelDeleted",
                method: "deleteOnChainJoinChannel"
            },
            {
                event: "LatestJoinChannelBlockHashSet",
                method: "setLatestJoinChannelBlockHash"
            },
            {
                event: "TotalOnChainWithdrawalsSet",
                method: "setTotalOnChainWithdrawals"
            },
            {
                event: "PendingParticipantAdded",
                method: "addPendingParticipant"
            },
            { event: "DisputeWindowCreated", method: "createDisputeWindow" },
            {
                event: "DisputeWindowCreationTimestampSet",
                method: "setDisputeWindowCreationTimestamp"
            },
            {
                event: "DisputeCommitmentsCleared",
                method: "clearDisputeCommitments"
            },
            {
                event: "DisputeCommitmentPushed",
                method: "pushDisputeCommitment"
            },
            {
                event: "DisputeCommitmentRemoved",
                method: "removeDisputeCommitment"
            },
            { event: "HasPostedSet", method: "setHasPosted" },
            { event: "DisputeWindowDeleted", method: "deleteDisputeWindow" },
            { event: "ReducedResultCommitted", method: "commitReducedResult" },
            {
                event: "ReducedResultForkIdCleared",
                method: "clearReducedResultForkId"
            },
            { event: "DisputedForkRemoved", method: "removeDisputedFork" },
            { event: "OnChainSlashedAdded", method: "addOnChainSlash" }
        ];

        // Set up event listeners using the configuration
        for (const config of eventConfigs) {
            const eventFilter = Reflect.get(
                this.onChainProxy.filters,
                config.event
            );
            const localMethod = Reflect.get(this.localDiamond, config.method);

            if (
                typeof eventFilter === "function" &&
                typeof localMethod === "function"
            ) {
                this.onChainProxy.on(
                    eventFilter(),
                    async (...args: unknown[]) => {
                        try {
                            await Reflect.apply(
                                localMethod,
                                this.localDiamond,
                                args
                            );
                        } catch (error) {
                            console.error(
                                `Error mirroring ${config.event}:`,
                                error
                            );
                        }
                    }
                );
            }
        }
    }
}

export default EventMirror;
