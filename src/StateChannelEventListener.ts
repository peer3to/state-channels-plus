import { BigNumberish, BytesLike } from "ethers";
import { AStateChannelManagerProxy } from "@typechain-types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";
import StateManager from "@/stateManager";
import P2pEventHooks from "@/P2pEventHooks";

//TODO - made a PR to ethers.js to fix Deferred Topic Filter

class StateChannelEventListener {
    stateManager: StateManager;
    stateChannelManagerContract: AStateChannelManagerProxy;
    p2pEventHooks: P2pEventHooks;
    filters: Record<string, any> = {};

    constructor(
        stateManager: StateManager,
        stateChannelManagerContract: AStateChannelManagerProxy,
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
            filterFactory: (channelId: BytesLike) =>
                this.stateChannelManagerContract.filters.SetState(channelId),
            handler: (logObj: any) => {
                const { encodedState, forkCnt, timestamp } = logObj.args;
                return this.stateManager.setState(
                    encodedState,
                    forkCnt,
                    timestamp
                );
            }
        },
        BlockCalldataPosted: {
            filterFactory: (channelId: BytesLike) =>
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    channelId
                ),
            handler: (logObj: any) => {
                console.log("BlockCalldataPosted EVENT !!!!!!!!!!!");
                this.p2pEventHooks.onPostedCalldata?.();
                const signedBlock = logObj.args
                    .signedBlock as SignedBlockStruct;
                const timestamp = logObj.args.timestamp as BigNumberish;
                this.stateManager.collectOnChainBlock(signedBlock, timestamp);
            }
        },
        DisputeUpdate: {
            filterFactory: (channelId: BytesLike) =>
                this.stateChannelManagerContract.filters.DisputeUpdated(
                    channelId
                ),
            handler: (logObj: any) => {
                this.stateManager.onDisputeUpdate(
                    logObj.args.dispute as DisputeStruct
                );
            }
        },
        DisputeCommited: {
            filterFactory: (channelId: BytesLike) =>
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
            filterFactory: (channelId: BytesLike) =>
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
        }
    };

    public async setChannelId(channelId: BytesLike) {
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
