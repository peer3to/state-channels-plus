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
    setStateFilter: any;
    postedBlockCallDataFilter: any;
    disputeUpdateFilter: any;
    constructor(
        stateManager: StateManager,
        stateChannelManagerContract: AStateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks
    ) {
        this.stateManager = stateManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;

        // stateChannelManagerContract.off(stateChannelManagerContract.getEvent("GameCreated"));
    }
    //Mark resources for garbage collection
    public dispose() {
        // this.stateChannelManagerContract.removeAllListeners();
        if (this.setStateFilter)
            this.stateChannelManagerContract.off(this.setStateFilter);
        if (this.postedBlockCallDataFilter)
            this.stateChannelManagerContract.off(
                this.postedBlockCallDataFilter
            );
        if (this.disputeUpdateFilter)
            this.stateChannelManagerContract.off(this.disputeUpdateFilter);
    }
    public async setChannelId(channelId: BytesLike) {
        // --------- SetState event -------------
        if (this.setStateFilter)
            await this.stateChannelManagerContract.off(this.setStateFilter);
        this.setStateFilter =
            this.stateChannelManagerContract.filters.SetState(channelId);
        //TODO - this will change if ethers.js accepts my PR
        await this.stateChannelManagerContract.on(
            this.setStateFilter,
            async (logObj: any) => {
                let encodedState = logObj.args.encodedState;
                let forkCnt = logObj.args.forkCnt;
                let timestamp = logObj.args.timestamp; //TODO? - potentially sync clock to this too
                // console.log("Game created event");
                await this.stateManager.setState(
                    encodedState,
                    forkCnt,
                    timestamp
                );
            }
        );
        // --------- PostedBlockCalldata event -------------
        if (this.postedBlockCallDataFilter)
            await this.stateChannelManagerContract.off(
                this.postedBlockCallDataFilter
            );
        this.postedBlockCallDataFilter =
            this.stateChannelManagerContract.filters.BlockCalldataPosted(
                channelId
            );
        //TODO - this will change if ethers.js accepts my PR
        await this.stateChannelManagerContract.on(
            this.postedBlockCallDataFilter,
            async (logObj: any) => {
                console.log("BlockCalldataPosted EVENT !!!!!!!!!!!");
                this.p2pEventHooks.onPostedCalldata?.();
                let signedBlock = logObj.args.signedBlock as SignedBlockStruct;
                let timestamp = logObj.args.timestamp as BigNumberish;
                await this.stateManager.collectOnChainBlock(
                    signedBlock,
                    timestamp
                );
            }
        );
        // --------- DisputeUpdate event -------------
        if (this.disputeUpdateFilter)
            await this.stateChannelManagerContract.off(
                this.disputeUpdateFilter
            );
        this.disputeUpdateFilter =
            this.stateChannelManagerContract.filters.DisputeUpdated(channelId);
        //TODO - this will change if ethers.js accepts my PR
        await this.stateChannelManagerContract.on(
            this.disputeUpdateFilter,
            async (logObj) => {
                let dispute = logObj.args.dispute as DisputeStruct;
                await this.stateManager.onDisputeUpdate(dispute);
            }
        );
    }
}

export default StateChannelEventListener;
