import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";

import { ChannelId } from "@/types/types";

import { EventHandler } from "@/eventHandlers/EventHandler";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

class StateChannelEventListener {
    stateChannelManagerContract: StateChannelManagerProxy;
    eventHandler: EventHandler;
    localDiamondContract: LocalDiamond;
    filters: Record<string, any> = {};

    constructor(
        stateChannelManagerContract: StateChannelManagerProxy,
        eventHandler: EventHandler,
        localDiamondContract: LocalDiamond
    ) {
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.eventHandler = eventHandler;
        this.localDiamondContract = localDiamondContract;
    }

    private async setListener(
        key: string,
        filterFactory: () => any,
        handler: (logObj: any) => Promise<void> | void
    ) {
        if (this.filters[key]) {
            await this.stateChannelManagerContract.off(this.filters[key]);
        }
        this.filters[key] = filterFactory();
        await this.stateChannelManagerContract.on(this.filters[key], handler);
    }

    //Mark resources for garbage collection
    public dispose() {
        Object.values(this.filters).forEach((filter) => {
            if (filter) {
                this.stateChannelManagerContract.off(filter);
            }
        });
        this.filters = {};
    }

    private readonly eventHandlers = {
        ChannelOpened: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChannelOpened(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, stateSnapshot, encodedState } = logObj.args;
                this.eventHandler.onChannelOpened(
                    channelId,
                    stateSnapshot,
                    encodedState
                );
            }
        },
        StateSnapshotUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.StateSnapshotUpdated(
                    channelId
                ),
            handler: async (logObj: any) => {
                const { channelId, stateSnapshot } = logObj.args;
                await this.eventHandler.onStateSnapshotUpdated(
                    channelId,
                    stateSnapshot
                );
            }
        },

        BlockCalldataPosted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    commitmentHash,
                    sender,
                    signedBlock,
                    timestamp
                } = logObj.args;
                this.eventHandler.onBlockCalldataPosted(
                    channelId,
                    commitmentHash,
                    sender,
                    signedBlock,
                    timestamp
                );
            }
        },
        DisputeCommitted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeCommitted(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    dispute,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp
                } = logObj.args;
                this.eventHandler.onDisputeCommitted(
                    channelId,
                    dispute,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp
                );
            }
        },
        ChainSlashed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChainSlashed(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, participant, timestamp } = logObj.args;
                this.eventHandler.onChainSlashed(
                    channelId,
                    participant,
                    timestamp
                );
            }
        },
        DisputeReducedResultCommitted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeReducedResultCommitted(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    forkId,
                    channelId,
                    reducedForkId,
                    reductionTimestamp,
                    reducer
                } = logObj.args;
                this.eventHandler.onDisputeReducedResultCommitted(
                    channelId,
                    forkId,
                    reducedForkId,
                    reductionTimestamp,
                    reducer
                );
            }
        },
        DisputeCommittedWithAuditingData: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeCommittedWithAuditingData(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    dispute,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp,
                    disputeAuditingData
                } = logObj.args;
                this.eventHandler.onDisputeCommitted(
                    channelId,
                    dispute,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp,
                    disputeAuditingData
                );
            }
        },
        WithdrawalsUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.WithdrawalsUpdated(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, totalWithdrawals } = logObj.args;
                this.eventHandler.onWithdrawalsUpdated(
                    channelId,
                    totalWithdrawals
                );
            }
        },
        ChannelStorageCleared: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChannelStorageCleared(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, latestJoinChannelBlockHash } = logObj.args;
                this.eventHandler.onChannelStorageCleared(
                    channelId,
                    latestJoinChannelBlockHash
                );
            }
        },
        DisputeKilled: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeKilled(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, forkId, disputer } = logObj.args;
                this.eventHandler.onDisputeKilled(channelId, forkId, disputer);
            }
        },

        JoinChannelProcessed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.JoinChannelProcessed(
                    channelId
                ),
            handler: (logObj: any) => {
                const {
                    channelId,
                    joinChannelBlock,
                    timestamp,
                    totalDeposits
                } = logObj.args;
                this.eventHandler.onJoinChannelProcessed(
                    channelId,
                    joinChannelBlock,
                    timestamp,
                    totalDeposits
                );
            }
        }
    };

    public async setChannelId(channelId: ChannelId) {
        await Promise.all(
            Object.entries(this.eventHandlers).map(
                ([key, { filterFactory, handler }]) =>
                    this.setListener(
                        key,
                        () => filterFactory(channelId),
                        handler
                    )
            )
        );
    }
}

export default StateChannelEventListener;
