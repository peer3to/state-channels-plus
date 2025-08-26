import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { ChannelId, Timestamp } from "@/types/types";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

class StateChannelEventListener {
    stateManager: StateManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    p2pEventHooks: P2pEventHooks;
    localDiamondContract: LocalDiamond;
    filters: Record<string, any> = {};

    constructor(
        stateManager: StateManager,
        stateChannelManagerContract: StateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks,
        localDiamondContract: LocalDiamond
    ) {
        this.stateManager = stateManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
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
        SetState: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.SetState(channelId),
            handler: (logObj: any) => {
                const { encodedState, forkId, timestamp } = logObj.args;
                return this.stateManager.setState(
                    encodedState,
                    forkId,
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
                console.log("BlockCalldataPosted EVENT !!!!!!!!!!!");
                this.p2pEventHooks.onPostedCalldata?.();
                const signedBlock = logObj.args
                    .signedBlock as SignedBlockStruct;
                const timestamp = logObj.args.timestamp as Timestamp;
                this.stateManager.collectOnChainBlock(signedBlock, timestamp);
            }
        },
        DisputeCommitted: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeCommitted(
                    channelId
                ),
            handler: (logObj: any) => {
                const encodedDispute = logObj.args.encodedDispute;
                const timestamp = Number(logObj.args.timestamp);
                return this.stateManager.onDisputeCommitted(
                    encodedDispute,
                    timestamp
                );
            }
        },

        JoinChannelProcessed: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.JoinChannelProcessed(
                    channelId
                ),
            handler: (logObj: any) => {
                const { joinChannelBlock, timestamp, totalDeposits } =
                    logObj.args;
                this.stateManager.onJoinChannel(
                    joinChannelBlock,
                    timestamp,
                    totalDeposits
                );
            }
        },
        StateSnapshotUpdated: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.StateSnapshotUpdated(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, stateSnapshot, timestamp } = logObj.args;
                this.localDiamondContract.onStateSnapshotUpdated(
                    channelId,
                    stateSnapshot,
                    timestamp
                );
            }
        },
        OnChainSlashAdded: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.OnChainSlashAdded(
                    channelId
                ),
            handler: (logObj: any) => {
                const { channelId, participant, timestamp } = logObj.args;
                this.localDiamondContract.onOnChainSlashAdded(
                    channelId,
                    participant,
                    timestamp
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
                this.localDiamondContract.onWithdrawalsUpdated(
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
                this.localDiamondContract.onChannelStorageCleared(
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
                this.localDiamondContract.onDisputeKilled(
                    channelId,
                    forkId,
                    disputer
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
                    reducedForkId,
                    reductionTimestamp,
                    forkGenesisTimestamp,
                    reducer
                } = logObj.args;
                const channelId = logObj.args.channelId;
                this.localDiamondContract.onDisputeReducedResultCommitted(
                    channelId,
                    forkId,
                    reducedForkId,
                    reductionTimestamp,
                    forkGenesisTimestamp,
                    reducer
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
