import { StateChannelManagerProxy } from "@typechain-types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";
import { ChannelId, Timestamp } from "@/types/types";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

class StateChannelEventListener {
    stateManager: StateManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    p2pEventHooks: P2pEventHooks;
    filters: Record<string, any> = {};

    constructor(
        stateManager: StateManager,
        stateChannelManagerContract: StateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks
    ) {
        this.stateManager = stateManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
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
        DisputeCommited: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.DisputeCommited(
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
        OutputStateSnapshotVerified: {
            filterFactory: (channelId: ChannelId) =>
                this.stateChannelManagerContract.filters.OutputStateSnapshotVerified(
                    channelId
                ),
            handler: (logObj: any) => {
                const { outputStateSnapshot, disputeCommitment } = logObj.args;
                console.log("OutputStateSnapshotVerified EVENT ");
                this.stateManager.onOutputStateSnapshotVerified(
                    outputStateSnapshot,
                    disputeCommitment
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
