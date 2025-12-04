import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";

import { ChannelId } from "@/types/types";

import { EventHandler } from "@/eventHandlers/EventHandler";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

class StateChannelEventListener {
    stateChannelManagerContract: StateChannelManagerProxy;
    eventHandler: EventHandler;
    localDiamondContract: LocalDiamond;
    filters: Record<
        string,
        { filter: any; listener: (logObj: any) => Promise<void> }
    > = {};

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
        handler: (logObj: any) => Promise<void>
    ) {
        if (this.filters[key]) {
            await this.stateChannelManagerContract.off(
                this.filters[key].filter,
                this.filters[key].listener
            );
        }
        const filter = filterFactory();
        await this.stateChannelManagerContract.on(filter, handler);
        this.filters[key] = { filter, listener: handler };
    }

    //Mark resources for garbage collection
    public async dispose() {
        const unsubscribePromises = Object.values(this.filters).map(
            ({ filter, listener }) =>
                this.stateChannelManagerContract.off(filter, listener)
        );
        await Promise.all(unsubscribePromises);
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
                return this.eventHandler.onChannelOpened(
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
            handler: (logObj: any) => {
                const { channelId, stateSnapshot } = logObj.args;
                return this.eventHandler.onStateSnapshotUpdated(
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
                return this.eventHandler.onBlockCalldataPosted(
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
                    disputeConfirmation,
                    disputeCreationTimestamp,
                    isFinal,
                    windowCreationTimestamp
                } = logObj.args;

                return this.eventHandler.onDisputeCommitted(
                    channelId,
                    disputeConfirmation,
                    Number(disputeCreationTimestamp),
                    isFinal,
                    Number(windowCreationTimestamp)
                );
            }
        },
        ChainSlashed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.ChainSlashed(
                    channelId
                ),
            handler: async (logObj: any) => {
                const { channelId, participant, timestamp } = logObj.args;
                return this.eventHandler.onChainSlashed(
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
                return this.eventHandler.onDisputeReducedResultCommitted(
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
                return this.eventHandler.onDisputeCommitted(
                    channelId,
                    dispute,
                    Number(disputeCreationTimestamp),
                    isFinal,
                    Number(windowCreationTimestamp),
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
                return this.eventHandler.onWithdrawalsUpdated(
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
                const { channelId, latestInboundMessageBlockHash } =
                    logObj.args;
                return this.eventHandler.onChannelStorageCleared(
                    channelId,
                    latestInboundMessageBlockHash
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
                return this.eventHandler.onDisputeKilled(
                    channelId,
                    forkId,
                    disputer
                );
            }
        },

        InboundMessagesProcessed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.InboundMessagesProcessed(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, messageBlock } = logObj.args;
                return this.eventHandler.onInboundMessagesProcessed(
                    channelId,
                    messageBlock
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
