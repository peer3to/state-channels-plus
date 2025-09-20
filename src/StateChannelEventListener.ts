import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import {
    BlockConfirmationStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeStruct,
    DisputeAuditingDataStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { ChannelId, Timestamp, Address, Hash, ForkId } from "@/types/types";
import StateSnapshot from "@/models/StateSnapshot";
import Storage from "@/storage";
import { EventHandler } from "@/eventHandlers/EventHandler";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

/*
events:
- StateSnapshotUpdated (channelId, stateSnapshot, timestamp)
- BlockCalldataPosted (channelId, sender, signedBlock, timestamp)
- DisputeCommitted (channelId, dispute, disputeCreationTimestamp, isFinal, windowCreationTimestamp, DisputeAuditingData(optional))
- ChainSlashed(channelId, participant, timestamp)
- DisputeReducedResultCommitted(channelId, forkId, reducedForkId, reductionTimestamp, forkGenesisTimestamp, reducer)
- WithdrawalsUpdated(channelId, totalWithdrawals) (probably will be removed)
- ChannelStorageCleared(channelId, latestJoinChannelBlockHash)
- DisputeKilled(channelId, forkId, disputer)
- onDisputeCommittedWithAuditingData(channelId, dispute, disputeCreationTimestamp, isFinal, windowCreationTimestamp, DisputeAuditingData)
- JoinChannelProcessed(channelId, joinChannelBlock, timestamp, totalDeposits)


*/
class StateChannelEventListener {
    stateManager: StateManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    p2pEventHooks: P2pEventHooks;
    localDiamondContract: LocalDiamond;
    eventHandler: EventHandler;
    filters: Record<string, any> = {};

    constructor(
        stateManager: StateManager,
        stateChannelManagerContract: StateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks,
        localDiamondContract: LocalDiamond,
        storage: Storage
    ) {
        this.stateManager = stateManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.localDiamondContract = localDiamondContract;
        this.eventHandler = new EventHandler(
            storage,
            stateManager,
            stateChannelManagerContract,
            p2pEventHooks,
            localDiamondContract
        );
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

    public handleBlockCalldataPosted(
        channelId: ChannelId,
        commitmentHash: Hash,
        sender: Address,
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ): void {
        this.eventHandler.handleBlockCalldataPosted(
            channelId,
            commitmentHash,
            sender,
            signedBlock,
            timestamp
        );
    }

    public handleDisputeCommitted(
        channelId: ChannelId,
        dispute: DisputeStruct,
        disputeCreationTimestamp: Timestamp,
        isFinal: boolean,
        windowCreationTimestamp: Timestamp
    ): void {
        this.eventHandler.handleDisputeCommitted(
            channelId,
            dispute,
            disputeCreationTimestamp,
            isFinal,
            windowCreationTimestamp
        );
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
        StateSnapshotUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.StateSnapshotUpdated(
                    channelId
                ),
            handler: async (logObj: any) => {
                const { channelId, stateSnapshot, timestamp } = logObj.args;
                await this.eventHandler.handleStateSnapshotUpdated(
                    channelId,
                    stateSnapshot,
                    timestamp
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
                this.eventHandler.handleBlockCalldataPosted(
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
                this.eventHandler.handleDisputeCommitted(
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
                this.eventHandler.handleChainSlashed(
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
                const { forkId, reducedForkId, reductionTimestamp, reducer } =
                    logObj.args;
                const channelId = logObj.args.channelId;
                this.eventHandler.handleDisputeReducedResultCommitted(
                    channelId,
                    forkId,
                    reducedForkId,
                    reductionTimestamp,
                    reducer
                );
            }
        },
        // DisputeCommittedWithAuditingData: {
        //     filterFactory: (channelId: ChannelId) =>
        //         this.stateChannelManagerContract.filters.DisputeCommittedWithAuditingData(
        //             channelId
        //         ),
        //     handler: (logObj: any) => {
        //         const {
        //             channelId,
        //             dispute,
        //             disputeCreationTimestamp,
        //             isFinal,
        //             windowCreationTimestamp,
        //             disputeAuditingData
        //         } = logObj.args;
        //         // Note: onDisputeCommittedWithAuditingData not implemented on LocalDiamond
        //         // this.localDiamondContract.onDisputeCommittedWithAuditingData(
        //         //     channelId,
        //         //     dispute,
        //         //     disputeCreationTimestamp,
        //         //     isFinal,
        //         //     windowCreationTimestamp,
        //         //     disputeAuditingData
        //         // );
        //     }
        // },
        WithdrawalsUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.WithdrawalsUpdated(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, totalWithdrawals } = logObj.args;
                this.eventHandler.handleWithdrawalsUpdated(
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
                this.eventHandler.handleChannelStorageCleared(
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
                this.eventHandler.handleDisputeKilled(
                    channelId,
                    forkId,
                    disputer
                );
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
                this.eventHandler.handleJoinChannelProcessed(
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
